// Tests for the Sunday coach, using a scripted model so nothing touches the network.
// Run with: node --test agent/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runCoach, sanitizeCheckin, providers } from './coach.mjs'

const data = JSON.parse(await readFile(new URL('../public/data.json', import.meta.url), 'utf8'))
const quiet = () => {}

/** A fake model that replays a list of turns, recording what it was shown. */
function scripted(turns) {
  const seen = []
  let i = 0
  return {
    seen,
    async step(transcript) {
      seen.push(transcript.map((t) => ({ ...t })))
      const turn = turns[Math.min(i++, turns.length - 1)]
      return { text: turn.text ?? '', calls: (turn.calls ?? []).map((c, n) => ({ id: `c${i}-${n}`, ...c })) }
    },
  }
}

const good = {
  headline: 'Short week, solid start',
  running: { status: 'minor', note: 'One 10-minute run. December asks for 30.' },
  reading: { status: 'good', note: 'Ahead of the pages needed this week.' },
  message: 'Two runs this week, and stretch the longer one to 15 minutes.',
  targets: { runs: 2, longestRunMinutes: 15, pages: 250 },
}

test('the agent looks things up, then posts once', async () => {
  const model = scripted([
    { calls: [{ name: 'get_week', args: {} }] },
    { calls: [{ name: 'post_checkin', args: good }] },
  ])
  const out = await runCoach({ data, previous: [{ weekOf: '2026-11-09', headline: 'Last week' }], provider: model, log: quiet })
  assert.equal(out.headline, good.headline)
  assert.equal(out.running.status, 'minor')
  assert.equal(model.seen.length, 2)
  // The model saw real numbers from the tool on its second turn.
  const week = model.seen[1].find((t) => t.role === 'tool').result
  assert.ok(week.running.currentPhase, 'running summary was returned')
  assert.equal(typeof week.reading.pagesNeededPerWeek, 'number', 'reading summary was returned')
  assert.equal(week.previousCheckins[0].headline, 'Last week', 'past check-ins were returned')
})

test('targets outside the limits are pulled back and reported', () => {
  const { checkin } = sanitizeCheckin({ ...good, targets: { runs: 12, longestRunMinutes: 120, pages: 5 } }, data)
  assert.equal(checkin.targets.runs, 6)
  assert.ok(checkin.targets.longestRunMinutes <= 15, 'long run capped near the longest so far')
  assert.ok(checkin.targets.pages > 5, 'pages raised to most of the needed pace')
  assert.equal(checkin.adjusted.length, 3)
})

test('a bad status is refused, and the agent can fix it', async () => {
  const model = scripted([
    { calls: [{ name: 'post_checkin', args: { ...good, running: { status: 'great', note: 'x' } } }] },
    { calls: [{ name: 'post_checkin', args: good }] },
  ])
  const out = await runCoach({ data, previous: [], provider: model, log: quiet })
  assert.equal(out.running.status, 'minor')
  const refusal = model.seen[1].findLast((t) => t.role === 'tool').result
  assert.match(refusal.error, /Not posted/)
})

test('a second post in the same run is ignored', async () => {
  const model = scripted([{ calls: [{ name: 'post_checkin', args: good }, { name: 'post_checkin', args: { ...good, headline: 'Second' } }] }])
  const out = await runCoach({ data, previous: [], provider: model, log: quiet })
  assert.equal(out.headline, good.headline)
})

test('an agent that never posts fails loudly', async () => {
  const model = scripted([{ text: 'All good!' }])
  await assert.rejects(runCoach({ data, previous: [], provider: model, log: quiet }), /didn't post/)
})

test('long text is trimmed', () => {
  const { checkin } = sanitizeCheckin({ ...good, headline: 'x'.repeat(200) }, data)
  assert.ok(checkin.headline.length <= 90)
})

test('Claude requests are shaped the way the Messages API expects', async () => {
  const bodies = []
  const replies = [
    { content: [{ type: 'text', text: 'Looking at the week.' }, { type: 'tool_use', id: 't1', name: 'get_week', input: {} }, { type: 'tool_use', id: 't2', name: 'get_week', input: {} }] },
    { content: [{ type: 'tool_use', id: 't3', name: 'post_checkin', input: good }] },
  ]
  const realFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(init.headers['x-api-key'], 'test-key')
    assert.ok(init.headers['anthropic-version'])
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify(replies[bodies.length - 1]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const out = await runCoach({ data, previous: [], provider: providers.anthropic, log: quiet })
    assert.equal(out.headline, good.headline)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.ANTHROPIC_API_KEY
  }
  const first = bodies[0]
  assert.equal(typeof first.system, 'string')
  assert.ok(first.tools.every((t) => t.name && t.input_schema?.type === 'object'))
  // Second request: assistant tool_use blocks, then one user turn holding a tool_result for each.
  const [user1, assistant, results] = bodies[1].messages
  assert.equal(user1.role, 'user')
  assert.deepEqual(assistant.content.filter((b) => b.type === 'tool_use').map((b) => b.id), ['t1', 't2'])
  assert.equal(results.role, 'user')
  assert.deepEqual(results.content.map((b) => [b.type, b.tool_use_id]), [['tool_result', 't1'], ['tool_result', 't2']])
  assert.equal(bodies[1].messages.length, 3)
})

test('Ollama requests carry the tools and send results back by tool name', async () => {
  const http = await import('node:http')
  const bodies = []
  const replies = [
    { message: { role: 'assistant', content: '<think>hmm</think>', tool_calls: [{ function: { name: 'get_week', arguments: {} } }] } },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'post_checkin', arguments: JSON.stringify(good) } }] } },
  ]
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/api/chat')
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      bodies.push(JSON.parse(body))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(replies[bodies.length - 1]))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`
  const log = console.log
  console.log = () => {}
  try {
    const out = await runCoach({ data, previous: [], provider: providers.ollama, log: quiet })
    assert.equal(out.headline, good.headline, 'string arguments are parsed too')
  } finally {
    console.log = log
    server.close()
    delete process.env.OLLAMA_HOST
  }
  assert.equal(bodies[0].stream, false)
  assert.equal(bodies[0].think, false)
  assert.match(bodies[0].messages[0].content, /no_think/)
  assert.ok(bodies[0].tools.every((t) => t.type === 'function' && t.function.name))
  const msgs = bodies[1].messages
  const assistant = msgs.find((m) => m.role === 'assistant')
  assert.equal(assistant.content, '', 'hidden reasoning is stripped before it goes back')
  const toolMsg = msgs.find((m) => m.role === 'tool')
  assert.equal(toolMsg.tool_name, 'get_week')
  assert.ok(JSON.parse(toolMsg.content).running.currentPhase)
})
