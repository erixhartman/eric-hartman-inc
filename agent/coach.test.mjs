// Tests for the Sunday coach, using a scripted model so nothing touches the network.
// Run with: node --test agent/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runCoach, sanitizeCheckin } from './coach.mjs'

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
    { calls: [{ name: 'get_running_summary', args: {} }, { name: 'get_reading_summary', args: {} }] },
    { calls: [{ name: 'get_previous_checkins', args: { count: 2 } }] },
    { calls: [{ name: 'post_checkin', args: good }] },
  ])
  const out = await runCoach({ data, previous: [], provider: model, log: quiet })
  assert.equal(out.headline, good.headline)
  assert.equal(out.running.status, 'minor')
  assert.equal(model.seen.length, 3)
  // The model saw real numbers from the tools on its third turn.
  const toolResults = model.seen[2].filter((t) => t.role === 'tool').map((t) => t.result)
  assert.ok(toolResults.some((r) => r.currentPhase), 'running summary was returned')
  assert.ok(toolResults.some((r) => typeof r.pagesNeededPerWeek === 'number'), 'reading summary was returned')
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
