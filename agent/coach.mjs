// The Sunday coach: a small agent that reviews Eric's week and posts a check-in.
//
// It runs in GitHub Actions every Sunday. The model gets tools, not a prompt
// stuffed with data: it decides what to look up, reads past check-ins for
// continuity, and then acts by posting a check-in with next week's targets.
// The code, not the model, enforces the limits on what it can post.
//
//   node agent/coach.mjs            run for real (writes public/coach.json)
//   node agent/coach.mjs --dry-run  print the check-in without saving it
//
// Environment:
//   COACH_PROVIDER  ollama (default: a free open model running inside the
//                   GitHub Action) or anthropic (Claude, needs a paid key)
//   COACH_MODEL     model id; defaults per provider below
//   OLLAMA_HOST     where Ollama is listening (default http://127.0.0.1:11434)
//   ANTHROPIC_API_KEY  only for the anthropic provider
//   COACH_DATE      pretend today is this date (YYYY-MM-DD), for testing
//   COACH_MOCK      path to a scripted-model file, for tests (no network)

import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import * as M from '../src/model.ts'

const DATA_PATH = new URL('../public/data.json', import.meta.url)
const OUT_PATH = new URL('../public/coach.json', import.meta.url)
const MAX_STEPS = 8
const KEEP_UPDATES = 30

const PROVIDER = process.env.COACH_PROVIDER || 'ollama'
const MODEL = process.env.COACH_MODEL || (PROVIDER === 'anthropic' ? 'claude-haiku-5-5' : 'qwen3:4b')
const DRY_RUN = process.argv.includes('--dry-run')
const NOW = process.env.COACH_DATE || M.today()

// ---------- facts the tools hand to the model ----------

const round1 = (n) => Math.round(n * 10) / 10

function runningSummary(data) {
  const phases = M.trainingPhases(data.runs, NOW)
  const phase = phases.find((p) => p.active) ?? phases[phases.length - 1]
  const weeks = M.weeklyTotals(data, 4, NOW)
  const longest = data.runs.reduce((a, r) => (r.minutes > (a?.minutes ?? -1) ? r : a), null)
  const thisWeek = weeks[weeks.length - 1]
  const runs = [...data.runs].sort((a, b) => b.date.localeCompare(a.date))
  return {
    today: NOW,
    daysToRaceDay: M.daysBetween(NOW, M.RACE_DAY),
    raceDay: M.RACE_DAY,
    currentPhase: { name: phase.key.replace('p', 'Phase '), when: phase.when, plan: phase.plan, status: phase.status, progress: Math.round(phase.done * 100) + '%' },
    longestRun: longest ? { minutes: longest.minutes, km: longest.km, date: longest.date } : null,
    thisWeek: { from: thisWeek.start, runs: thisWeek.runs, km: round1(thisWeek.km) },
    lastFourWeeks: weeks.map((w) => ({ weekOf: w.start, runs: w.runs, km: round1(w.km) })),
    recentRuns: runs.slice(0, 8).map((r) => ({ date: r.date, km: r.km, minutes: r.minutes, where: r.where, ...(r.note ? { note: r.note } : {}) })),
  }
}

function readingSummary(data) {
  const s = M.readingStats(data.books, data.startDate, NOW)
  const weeks = M.weeklyTotals(data, 4, NOW)
  const thisWeek = weeks[weeks.length - 1]
  return {
    today: NOW,
    daysToOpeningDay: s.daysLeft,
    openingDay: M.OPENING_DAY,
    booksFinished: `${s.finished} of ${data.books.length}`,
    pagesRead: s.read,
    pagesTotal: s.total,
    pagesNeededPerDay: Math.ceil(s.needPerDay),
    pagesNeededPerWeek: Math.ceil(s.needPerDay * 7),
    thisWeek: { from: thisWeek.start, pages: thisWeek.pages },
    lastFourWeeks: weeks.map((w) => ({ weekOf: w.start, pages: w.pages })),
    inProgress: data.books.filter((b) => b.page > 0 && b.page < b.pages).map((b) => ({ title: b.title, page: b.page, pages: b.pages })),
    note: 'Page counts are estimates until checked against the physical editions.',
  }
}

// ---------- guardrails: what a check-in may contain ----------

const STATUSES = ['good', 'minor', 'major']
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const trimTo = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** Validate and bound a proposed check-in. Returns the saved shape plus notes on anything adjusted. */
export function sanitizeCheckin(input, data) {
  const adjusted = []
  const errors = []
  const run = runningSummary(data)
  const read = readingSummary(data)

  for (const key of ['running', 'reading']) {
    if (!STATUSES.includes(input?.[key]?.status)) errors.push(`${key}.status must be one of ${STATUSES.join(', ')}`)
    if (!input?.[key]?.note) errors.push(`${key}.note is required`)
  }
  if (!input?.headline) errors.push('headline is required')
  if (errors.length) return { errors }

  const t = input.targets ?? {}
  const longest = run.longestRun?.minutes ?? 0
  const bounds = {
    runs: [1, 6],
    // Never ask for a long run more than a quarter longer (or 5 minutes longer) than the longest so far.
    longestRunMinutes: [10, Math.max(15, Math.round(Math.max(longest * 1.25, longest + 5)))],
    // Reading: at least most of the needed pace, at most double it.
    pages: [Math.ceil(read.pagesNeededPerWeek * 0.8), Math.ceil(read.pagesNeededPerWeek * 2)],
  }
  const targets = {}
  for (const [k, [lo, hi]] of Object.entries(bounds)) {
    const want = Math.round(Number(t[k]))
    const got = Number.isFinite(want) ? clamp(want, lo, hi) : lo
    if (got !== want) adjusted.push(`${k}: asked for ${Number.isFinite(want) ? want : 'nothing'}, set to ${got} (allowed ${lo} to ${hi})`)
    targets[k] = got
  }

  return {
    checkin: {
      headline: trimTo(input.headline, 90),
      running: { status: input.running.status, note: trimTo(input.running.note, 260) },
      reading: { status: input.reading.status, note: trimTo(input.reading.note, 260) },
      message: trimTo(input.message ?? '', 600),
      targets,
      adjusted,
    },
  }
}

// ---------- tools ----------

const TOOLS = [
  {
    name: 'get_running_summary',
    description: "Eric's half-marathon training: today's date, days to race day, the current phase of the plan and progress on it, the longest run, this week's and the last four weeks' runs, and recent runs.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_reading_summary',
    description: "Eric's 12-book goal: days to Opening Day, pages read and needed, the pace needed per day and per week, this week's and the last four weeks' pages, and books in progress.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_previous_checkins',
    description: 'Your most recent weekly check-ins, newest first, so this week can follow on from last week. Empty on the first run.',
    parameters: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 4 } }, additionalProperties: false },
  },
  {
    name: 'post_checkin',
    description: "Publish this week's check-in on the public tracker and set next week's targets. Call exactly once, last. Targets outside safe limits are adjusted, and the result says so.",
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One line, at most 90 characters, summing up the week.' },
        running: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: STATUSES, description: 'good: on plan. minor: a little behind, recoverable this week. major: clearly behind plan.' },
            note: { type: 'string', description: 'One or two short sentences with the key numbers.' },
          },
          required: ['status', 'note'],
          additionalProperties: false,
        },
        reading: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: STATUSES },
            note: { type: 'string', description: 'One or two short sentences with the key numbers.' },
          },
          required: ['status', 'note'],
          additionalProperties: false,
        },
        message: { type: 'string', description: 'A short note to Eric about the coming week, at most three sentences.' },
        targets: {
          type: 'object',
          properties: {
            runs: { type: 'integer', description: 'Runs to aim for next week.' },
            longestRunMinutes: { type: 'integer', description: 'Length of the longest run to aim for next week, in minutes.' },
            pages: { type: 'integer', description: 'Pages to aim for next week.' },
          },
          required: ['runs', 'longestRunMinutes', 'pages'],
          additionalProperties: false,
        },
      },
      required: ['headline', 'running', 'reading', 'message', 'targets'],
      additionalProperties: false,
    },
  },
]

const SYSTEM = `You are the Sunday coach for Eric Hartman Inc., a public, tongue-in-cheek tracker of Eric's two personal goals for the year: run the Toronto Half Marathon on May 2, 2027, and read 12 borrowed books by Blue Jays Opening Day, March 25, 2027.

Every Sunday you review the week and post a check-in on the tracker. Anyone can read it, Eric included.

How to work:
1. Call get_running_summary and get_reading_summary.
2. Call get_previous_checkins to see what you said last week and whether he hit the targets you set.
3. Decide a status for each goal and next week's targets, then call post_checkin exactly once.

Rules:
- Use only numbers that came from the tools. Never invent runs, pages, dates or paces.
- Base running targets on the current phase of the plan. Build gradually; don't jump far past what he has already done.
- Base reading targets on the pages needed per week, nudging up if he's behind.
- No medical or injury advice. If a run note mentions pain or injury, say to take it easy and check with a professional, and don't raise targets.
- Write like a direct, upbeat coach, in plain Canadian English. Short sentences, contractions, no emoji, no em dashes, no hype. Don't open by negating something ("this isn't X, it's Y").`

// ---------- providers ----------

async function postJSON(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const text = await res.text()
  const where = `${url} (status ${res.status}${res.redirected ? `, redirected to ${res.url}` : ''}, ${res.headers.get('content-type') || 'no content type'})`
  if (!res.ok) throw new Error(`${where}: ${text.slice(0, 400)}`)
  try { return JSON.parse(text) } catch { throw new Error(`${where} did not return JSON: ${text.slice(0, 200)}`) }
}

/** POST to a local server with no timeout: a model on a CPU can take minutes to answer. */
function postLocalJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = JSON.stringify(body)
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { text += c })
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${url} answered ${res.statusCode}: ${text.slice(0, 400)}`))
        try { resolve(JSON.parse(text)) } catch { reject(new Error(`${url} did not return JSON: ${text.slice(0, 200)}`)) }
      })
    })
    req.setTimeout(0)
    req.on('error', reject)
    req.end(payload)
  })
}

/** Each provider takes the running transcript and returns { text, calls: [{id, name, args}] }. */
export const providers = {
  // Ollama: an open model running on the same machine. Free, no key, no account.
  ollama: {
    async step(transcript) {
      // "/no_think" switches Qwen3's hidden reasoning off from the prompt side too.
      const messages = [{ role: 'system', content: SYSTEM + '\n\n/no_think' }]
      for (const t of transcript) {
        if (t.role === 'user') messages.push({ role: 'user', content: t.text })
        if (t.role === 'assistant') messages.push({ role: 'assistant', content: t.text || '', ...(t.calls.length ? { tool_calls: t.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}) })
        if (t.role === 'tool') messages.push({ role: 'tool', tool_name: t.name, content: JSON.stringify(t.result) })
      }
      const started = Date.now()
      const json = await postLocalJSON(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/chat`, {
        model: MODEL,
        messages,
        tools: TOOLS.map((t) => ({ type: 'function', function: t })),
        stream: false,
        think: false, // skip the long hidden reasoning; it's slow on a CPU
        options: { temperature: 0.2, num_ctx: 12288, num_predict: 700 },
      })
      const msg = json.message ?? {}
      const text = String(msg.content ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()
      console.log(`  model: ${((Date.now() - started) / 1000).toFixed(0)}s, ${json.prompt_eval_count ?? '?'} tokens in, ${json.eval_count ?? '?'} out, ${msg.tool_calls?.length ?? 0} tool calls${text ? `, said: ${text.slice(0, 120)}` : ''}`)
      return {
        text,
        calls: (msg.tool_calls ?? []).map((c, i) => ({
          id: `call_${Date.now()}_${i}`,
          name: c.function?.name,
          args: typeof c.function?.arguments === 'string' ? safeParse(c.function.arguments) : (c.function?.arguments ?? {}),
        })),
      }
    },
  },

  // Claude, through the Anthropic Messages API (paid).
  anthropic: {
    async step(transcript) {
      const key = process.env.ANTHROPIC_API_KEY
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set.')
      const messages = []
      for (const t of transcript) {
        if (t.role === 'user') messages.push({ role: 'user', content: t.text })
        if (t.role === 'assistant') messages.push({ role: 'assistant', content: [...(t.text ? [{ type: 'text', text: t.text }] : []), ...t.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] })
        if (t.role === 'tool') {
          const block = { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(t.result) }
          const last = messages[messages.length - 1]
          if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block)
          else messages.push({ role: 'user', content: [block] })
        }
      }
      const json = await postJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages,
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      })
      return {
        text: (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
        calls: (json.content ?? []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
      }
    },
  },
}

// ---------- the loop ----------

export async function runCoach({ data, previous, provider, log = console.log }) {
  const transcript = [{ role: 'user', text: `Today is ${NOW}. Do this week's check-in.` }]
  let posted = null

  for (let step = 1; step <= MAX_STEPS && !posted; step++) {
    const { text, calls } = await provider.step(transcript)
    transcript.push({ role: 'assistant', text, calls })
    if (!calls.length) {
      transcript.push({ role: 'user', text: 'Please finish by calling post_checkin.' })
      log(`step ${step}: no tool call, nudging`)
      continue
    }
    for (const call of calls) {
      let result
      if (call.name === 'get_running_summary') result = runningSummary(data)
      else if (call.name === 'get_reading_summary') result = readingSummary(data)
      else if (call.name === 'get_previous_checkins') result = previous.slice(0, clamp(Number(call.args.count) || 2, 1, 4))
      else if (call.name === 'post_checkin') {
        if (posted) result = { error: 'Already posted this week.' }
        else {
          const { checkin, errors } = sanitizeCheckin(call.args, data)
          if (errors) result = { error: 'Not posted. Fix and call again.', problems: errors }
          else { posted = checkin; result = { posted: true, targets: checkin.targets, adjusted: checkin.adjusted } }
        }
      } else result = { error: `No tool called ${call.name}.` }
      log(`step ${step}: ${call.name}${result?.error ? ' -> ' + result.error : ''}`)
      transcript.push({ role: 'tool', id: call.id, name: call.name, result })
    }
  }
  if (!posted) throw new Error(`The coach didn't post a check-in within ${MAX_STEPS} steps.`)
  return posted
}

function safeParse(s) {
  try { return JSON.parse(s || '{}') } catch { return { __unparseable: String(s) } }
}

async function main() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'))
  let store = { updates: [] }
  try { store = JSON.parse(await readFile(OUT_PATH, 'utf8')) } catch { /* first run */ }
  const weekOf = M.weekStart(NOW)
  const previous = store.updates.filter((u) => u.weekOf !== weekOf)

  let provider = providers[PROVIDER]
  if (process.env.COACH_MOCK) provider = (await import(pathToFileURL(process.env.COACH_MOCK).href)).default
  if (!provider) throw new Error(`Unknown COACH_PROVIDER "${PROVIDER}". Use ollama or anthropic.`)

  console.log(`Sunday coach: ${NOW}, ${PROVIDER} ${MODEL}${DRY_RUN ? ' (dry run)' : ''}`)
  const checkin = await runCoach({ data, previous, provider })
  const update = { weekOf, date: NOW, createdAt: new Date().toISOString(), model: process.env.COACH_MOCK ? 'mock' : MODEL, ...checkin }

  console.log(JSON.stringify(update, null, 2))
  if (DRY_RUN) return
  // Re-running in the same week replaces that week's check-in.
  store.updates = [update, ...previous].slice(0, KEEP_UPDATES)
  await writeFile(OUT_PATH, JSON.stringify(store, null, 2) + '\n')
  console.log('Saved public/coach.json')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1) })
}
