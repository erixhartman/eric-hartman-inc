import { addDays, fmtDate } from './model'

export type Status = 'good' | 'minor' | 'major'

export interface CoachUpdate {
  weekOf: string
  date: string
  createdAt: string
  model: string
  headline: string
  running: { status: Status; note: string }
  reading: { status: Status; note: string }
  message: string
  targets: { runs: number; longestRunMinutes: number; pages: number }
  adjusted: string[]
}

const STATUS: Record<Status, { label: string; mark: string }> = {
  good: { label: 'Good service', mark: '✓' },
  minor: { label: 'Minor delays', mark: '!' },
  major: { label: 'Major delays', mark: '!!' },
}

const AGENT_URL = 'https://github.com/erixhartman/eric-hartman-inc/tree/main/agent'

function LineStatus({ n, name, status, note }: { n: 1 | 2; name: string; status: Status; note: string }) {
  const s = STATUS[status] ?? STATUS.minor
  return (
    <div className="svc-line">
      <span className={`roundel line-${n}`} aria-hidden="true">{n}</span>
      <div className="svc-text">
        <span className="svc-head">
          <span className="svc-name">{name}</span>
          <span className={`svc-status ${status}`}><span className="svc-mark" aria-hidden="true">{s.mark}</span>{s.label}</span>
        </span>
        <span className="svc-note">{note}</span>
      </div>
    </div>
  )
}

/** The Sunday coach's latest check-in, styled as a subway service update. */
export function ServiceUpdate({ updates }: { updates: CoachUpdate[] }) {
  const latest = updates[0]
  if (!latest) return null
  const nextWeek = addDays(latest.weekOf, 7)
  const earlier = updates.slice(1)

  return (
    <section className="section service" id="coach" aria-labelledby="svc-title">
      <div className="svc-top">
        <div>
          <p className="kicker">Sunday coach, week of {fmtDate(latest.weekOf)}</p>
          <h2 id="svc-title">Service update</h2>
        </div>
        <p className="svc-headline">{latest.headline}</p>
      </div>

      <div className="svc-board">
        <LineStatus n={1} name="Line 1, half marathon" status={latest.running.status} note={latest.running.note} />
        <LineStatus n={2} name="Line 2, 12 books" status={latest.reading.status} note={latest.reading.note} />
      </div>

      <div className="svc-bottom">
        <div className="svc-targets" aria-label={`Targets for the week of ${fmtDate(nextWeek)}`}>
          <span className="svc-targets-title">Targets, week of {fmtDate(nextWeek)}</span>
          <span><strong>{latest.targets.runs}</strong> runs</span>
          <span><strong>{latest.targets.longestRunMinutes}</strong> min longest run</span>
          <span><strong>{latest.targets.pages}</strong> pages</span>
        </div>
      </div>

      <p className="small-note muted">
        Written by an AI agent that reviews the logs every Sunday and sets the next week's targets, within limits enforced in code. Model: {latest.model}. <a href={AGENT_URL}>How it works</a>
      </p>

      {earlier.length > 0 && (
        <details className="svc-earlier">
          <summary>Earlier updates ({earlier.length})</summary>
          <ul>
            {earlier.map((u) => (
              <li key={u.weekOf}>
                <span className="muted">Week of {fmtDate(u.weekOf)}</span>
                <span>{u.headline}</span>
                <span className="muted">Line 1: {STATUS[u.running.status]?.label}. Line 2: {STATUS[u.reading.status]?.label}.</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
