import { type Day, fmtDate } from './model'

// Intensity buckets: 0 = nothing, 1–3 = light to heavy.
const runLevel = (km: number) => (km <= 0 ? 0 : km < 3 ? 1 : km < 6 ? 2 : 3)
const readLevel = (pages: number) => (pages <= 0 ? 0 : pages < 20 ? 1 : pages < 50 ? 2 : 3)

/** A: the last 28 days as two lanes of squares, so streaks and lulls are visible at a glance. */
export function ActivityStrip({ days }: { days: Day[] }) {
  const active = days.filter((d) => d.km > 0 || d.pages > 0).length
  const lanes: { label: string; level: (d: Day) => number; tip: (d: Day) => string }[] = [
    { label: 'Run', level: (d) => runLevel(d.km), tip: (d) => (d.km ? `${d.km.toFixed(1)} km` : 'no run') },
    { label: 'Read', level: (d) => readLevel(d.pages), tip: (d) => (d.pages ? `${d.pages} pages` : 'no reading') },
  ]
  return (
    <div className="strip" role="img" aria-label={`Active on ${active} of the last ${days.length} days`}>
      {lanes.map((lane) => (
        <div className="strip-lane" key={lane.label}>
          <span className="strip-label">{lane.label}</span>
          <div className="strip-days" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
            {days.map((d) => (
              <span key={d.date} className={`sq l${lane.level(d)}`} title={`${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${lane.tip(d)}`} />
            ))}
          </div>
        </div>
      ))}
      <div className="strip-foot">
        <span>{fmtDate(days[0].date)}</span>
        <span className="strip-count">Active {active} of the last {days.length} days</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/** B: a small trend line for a stat tile. `target` draws a dashed reference line. */
export function Spark({ values, target, label }: { values: number[]; target?: number; label: string }) {
  const W = 160
  const H = 36
  const max = Math.max(1, target ?? 0, ...values)
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (W - 6)
  const y = (v: number) => H - 4 - (v / max) * (H - 8)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = values[values.length - 1] ?? 0
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {target !== undefined && <line className="spark-target" x1="0" x2={W} y1={y(target)} y2={y(target)} />}
      <path className="spark-line" d={d} />
      <circle className="spark-dot" cx={x(values.length - 1)} cy={y(last)} r="3" />
    </svg>
  )
}
