# The Sunday coach

A small AI agent that reviews my week every Sunday and posts a check-in on [Eric Hartman Inc.](https://eric-hartman-inc.vercel.app/#coach), styled as a subway service update.

## What it does

Every Sunday evening, GitHub Actions runs `coach.mjs`. The model gets tools instead of a prompt stuffed with data, and works through them itself:

1. **Looks things up.** The first turn is always `get_week`, the way you'd force a first tool on a hosted API, because small models otherwise write before they read. It returns this week's runs and pages, the current phase of the training plan, the pace needed for race day and Opening Day, and its own last two check-ins, plus plain comparisons (my reading pace against the pace needed, and last week's targets against what I did) so it doesn't have to do the maths. It uses the same goal logic as the site (`src/model.ts`), so the coach and the page always agree.
2. **Acts.** `post_checkin` publishes a status for each goal (good service, minor delays or major delays), a short note, and next week's targets. The workflow commits it to `public/coach.json`, and Vercel redeploys the site.

## Guardrails

The code, not the model, decides what can be posted:

- Statuses must be one of the three allowed values, and text is trimmed to set lengths.
- Running targets are capped: at most 6 runs, and a longest run no more than a quarter (or 5 minutes) longer than my longest so far.
- Reading targets stay between 80% and 200% of the pages needed per week.
- Anything outside those limits is pulled back and recorded in `adjusted`, and the model is told what changed.
- The headline has to be a real sentence, and each note has to cite at least one number from the facts. Vague posts are sent back with the reason.
- It gets four turns, then two structured-output tries. If it still hasn't produced a valid check-in, the run fails instead of publishing something half-done.

## Cost

$0, with no account or key. The model ([Qwen2.5 7B](https://ollama.com/library/qwen2.5)) runs on the GitHub Actions machine itself through [Ollama](https://ollama.com), and Actions minutes are free on a public repo. The download is cached between weeks. A run takes a few minutes on the runner's CPU.

A small model on a CPU needs more structure than a big hosted one, so the coach gives it some: the lookup always comes first, the facts include ready-made comparisons, each note has to cite a real number, and if it still hasn't posted after four turns, a last step uses Ollama's structured output to force a reply in the check-in's exact shape. The guardrails check that too.

Claude is still available as an option: set `COACH_PROVIDER: anthropic` and add an `ANTHROPIC_API_KEY` secret. That costs money and isn't the default.

## Running it

- **On a schedule:** Sundays at 23:15 UTC (6:15 pm in Toronto in winter).
- **On demand:** the "Run workflow" button on the Actions tab, or edit `agent/RUN` and push. If `agent/RUN` starts with `dry-run`, the check-in is printed in the log but not published.
- **Locally, without saving:** start Ollama, `ollama pull qwen2.5:7b`, then `node agent/coach.mjs --dry-run`
- **Tests:** `node --test agent/coach.test.mjs` runs the loop, the guardrails, the fallback and the shape of the Ollama and Claude requests against scripted fakes, with no network. The workflow runs them before every check-in.

Re-running in the same week replaces that week's check-in. The last 30 are kept.
