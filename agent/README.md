# The Sunday coach

A small AI agent that reviews my week every Sunday and posts a check-in on [Eric Hartman Inc.](https://eric-hartman-inc.vercel.app/#coach), styled as a subway service update.

## What it does

Every Sunday evening, GitHub Actions runs `coach.mjs`. The model gets tools instead of a prompt stuffed with data, and works through them itself:

1. **Looks things up.** `get_week` returns this week's runs and pages, the current phase of the training plan, the pace needed for race day and Opening Day, and its own last two check-ins, so it can see whether I hit the targets it set. It uses the same goal logic as the site (`src/model.ts`), so the coach and the page always agree.
2. **Acts.** `post_checkin` publishes a status for each goal (good service, minor delays or major delays), a short note, and next week's targets. The workflow commits it to `public/coach.json`, and Vercel redeploys the site.

## Guardrails

The code, not the model, decides what can be posted:

- Statuses must be one of the three allowed values, and text is trimmed to set lengths.
- Running targets are capped: at most 6 runs, and a longest run no more than a quarter (or 5 minutes) longer than my longest so far.
- Reading targets stay between 80% and 200% of the pages needed per week.
- Anything outside those limits is pulled back and recorded in `adjusted`, and the model is told what changed.
- It gets 8 steps. If it hasn't posted by then, the run fails instead of publishing something half-done.

## Cost

It runs on Claude Haiku 5.5 through the Anthropic API. At $0.10 per million input tokens and $0.50 per million output tokens, a weekly check-in should cost a fraction of a cent (an estimate, not a measured figure). GitHub Actions is free on a public repo.

It needs an `ANTHROPIC_API_KEY` repository secret. Without one, the workflow still runs, logs that it's skipping, and posts nothing.

(It was first built for GitHub Models' free tier, which turned out to have been retired on July 30, 2026.)

## Running it

- **On a schedule:** Sundays at 23:15 UTC (6:15 pm in Toronto in winter).
- **On demand:** the "Run workflow" button on the Actions tab, or edit `agent/RUN` and push.
- **Locally, without saving:** `ANTHROPIC_API_KEY=... node agent/coach.mjs --dry-run`
- **Tests:** `node --test agent/coach.test.mjs` runs the loop, the guardrails and the shape of the Claude requests against scripted fakes, with no network. The workflow runs them before every check-in.

Re-running in the same week replaces that week's check-in. The last 30 are kept.
