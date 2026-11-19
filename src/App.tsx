import { useEffect, useMemo, useState } from 'react'
import {
  type Book, type Data, type Run, HALF_KM, OPENING_DAY, RACE_DAY,
  addDays, daysBetween, fmtDate, pace, readingStats, today, trainingPhases, weekStart,
} from './model'
import { Admin } from './Admin'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const editing = useHash() === '#edit'

  useEffect(() => {
    fetch('/data.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError("The progress data didn't load. Refresh to try again."))
  }, [])

  return (
    <>
      <div className="noise" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top">Eric Hartman Inc<span>.</span></a>
        <nav aria-label="Sections">
          <a href="#kr1">Half marathon</a>
          <a href="#kr2">Book list</a>
          {editing ? <a className="nav-cta" href="#">Done editing</a> : null}
        </nav>
      </header>
      <main className="shell" id="top">
        {error && <p className="empty">{error}</p>}
        {!data && !error && <p className="empty">Loading the quarterly numbers…</p>}
        {data && (
          <>
            {editing && <Admin data={data} onChange={setData} />}
            <Report data={data} />
          </>
        )}
      </main>
      <footer className="shell footer">
        <p>
          Updated {data ? new Date(data.updatedAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '…'}.
          Race day is the Toronto Marathon half on May 2, 2027. Opening Day assumes there’s no lockout.
        </p>
        <p>
          <a href="https://eric-hartman-portfolio.vercel.app/">Eric Hartman</a>
          {!editing && <> <span className="sep" aria-hidden="true">/</span> <a href="#edit">Owner sign-in</a></>}
        </p>
      </footer>
    </>
  )
}

function Report({ data }: { data: Data }) {
  const now = today()
  const runs = useMemo(() => [...data.runs].sort((a, b) => b.date.localeCompare(a.date)), [data.runs])
  const toRace = Math.max(0, daysBetween(now, RACE_DAY))
  const toOpener = Math.max(0, daysBetween(now, OPENING_DAY))
  const longest = Math.max(0, ...runs.map((r) => r.km))
  const thisWeek = runs.filter((r) => r.date >= weekStart(now))
  const totalKm = runs.reduce((s, r) => s + r.km, 0)
  const reading = readingStats(data.books, data.startDate, now)
  const raceRun = runs.find((r) => r.where === 'race')

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">FY2027 roadmap</p>
          <h1>Improve long-term health and performance.</h1>
          <p className="hero-tagline">
            Two key results, a limited budget, and stakeholders with a history of changing requirements. Shareholders asked for public accountability, so here are the numbers, including where we fall short.
          </p>
        </div>
        <aside className="hero-aside" aria-label="Countdowns">
          <div className="countdown">
            <strong>{toRace}</strong>
            <span>days to race day<br /><em>Toronto Half Marathon, {fmtDate(RACE_DAY, { weekday: 'short', month: 'short', day: 'numeric' })}</em></span>
          </div>
          <div className="countdown">
            <strong>{toOpener}</strong>
            <span>days to Opening Day<br /><em>Jays at Yankees, {fmtDate(OPENING_DAY, { weekday: 'short', month: 'short', day: 'numeric' })}</em></span>
          </div>
        </aside>
      </section>

      <section className="metrics" aria-label="Key numbers">
        <Metric value={raceRun ? 'Done' : `${longest.toFixed(1)}`} unit={raceRun ? '' : 'km'} label={raceRun ? `Finished the half in ${Math.floor(raceRun.minutes / 60)}:${String(Math.round(raceRun.minutes % 60)).padStart(2, '0')}` : `longest run, of ${HALF_KM} on race day`} />
        <Metric value={String(thisWeek.length)} label={`runs this week, ${thisWeek.reduce((s, r) => s + r.km, 0).toFixed(1)} km`} />
        <Metric value={totalKm.toFixed(0)} unit="km" label={`run since the post, across ${runs.length} run${runs.length === 1 ? '' : 's'}`} />
        <Metric value={`${reading.finished}`} unit="/ 12" label="books finished" />
        <Metric value={`${Math.round((reading.read / reading.total) * 100)}`} unit="%" label={`of ${reading.total.toLocaleString('en-CA')} pages read`} />
        <Metric value={reading.needPerDay.toFixed(0)} label={`pages a day needed to finish by Opening Day`} />
      </section>

      <KR1 runs={runs} now={now} longest={longest} />
      <KR2 books={data.books} stats={reading} />
    </>
  )
}

function Metric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="metric">
      <strong>{value}{unit && <small> {unit}</small>}</strong>
      <span>{label}</span>
    </div>
  )
}

function KR1({ runs, now, longest }: { runs: Run[]; now: string; longest: number }) {
  const phases = trainingPhases(runs, now)
  const active = phases.find((p) => p.active)

  // Last 12 weeks of runs, oldest first
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(weekStart(now), -7 * (11 - i)))
  const perWeek = weeks.map((w) => {
    const rs = runs.filter((r) => r.date >= w && r.date <= addDays(w, 6))
    return { w, count: rs.length, km: rs.reduce((s, r) => s + r.km, 0) }
  })
  const [sel, setSel] = useState<number | null>(null)
  const maxCount = Math.max(5, ...perWeek.map((p) => p.count))

  const summary = runs.length === 0
    ? 'No runs logged yet. The December phase is about getting to 30 minutes without stopping.'
    : longest >= HALF_KM
      ? 'Already covered the full race distance in training.'
      : `Longest run is ${longest.toFixed(1)} km, ${(HALF_KM - longest).toFixed(1)} km short of race distance.`

  return (
    <section className="section" id="kr1">
      <div className="section-heading">
        <p className="kicker">KR1</p>
        <h2>Run the Toronto Half Marathon in May.</h2>
        <p>{summary}</p>
      </div>

      <ol className="phases">
        {phases.map((p) => (
          <li key={p.key} className={`phase ${p.active ? 'active' : ''} ${p.future ? 'future' : ''}`}>
            <div className="phase-when">{p.when}{p.active && <span className="now-tag">Now</span>}</div>
            <div className="phase-plan">{p.plan}</div>
            <div className="phase-status">{p.status}</div>
            <div className="bar" role="img" aria-label={`${Math.round(p.done * 100)}% complete`}>
              <span style={{ width: `${p.done * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>

      <div className="chart-block">
        <div className="chart-head">
          <h3>Runs per week</h3>
          <p>The last 12 weeks. The dashed line is the plan’s 5 runs a week{active?.key === 'p1' ? ', which starts in January' : ''}.</p>
        </div>
        <svg className="weeks" viewBox="0 0 600 170" role="img" aria-label="Runs per week, last 12 weeks">
          {[0, 5].map((v) => (
            <g key={v}>
              <line className={v ? 'target' : 'base'} x1="34" x2="596" y1={150 - (v / maxCount) * 130} y2={150 - (v / maxCount) * 130} />
              <text x="26" y={150 - (v / maxCount) * 130} dy="0.32em" textAnchor="end">{v}</text>
            </g>
          ))}
          {perWeek.map((p, i) => {
            const slot = 562 / 12
            const x = 34 + i * slot + slot * 0.18
            const h = (p.count / maxCount) * 130
            return (
              <g key={p.w} onClick={() => setSel(sel === i ? null : i)} onMouseEnter={() => setSel(i)}>
                <rect className="hit" x={34 + i * slot} y="10" width={slot} height="150" />
                {p.count > 0 && <path className={`wbar ${sel !== null && sel !== i ? 'dim' : ''}`} d={`M${x},150V${150 - h + 4}Q${x},${150 - h} ${x + 4},${150 - h}H${x + slot * 0.64 - 4}Q${x + slot * 0.64},${150 - h} ${x + slot * 0.64},${150 - h + 4}V150Z`} />}
                {(i % 3 === 2 || i === 11) && <text x={34 + i * slot + slot / 2} y="166" textAnchor="middle">{fmtDate(p.w)}</text>}
              </g>
            )
          })}
        </svg>
        <p className="chart-tip">
          {sel !== null
            ? `Week of ${fmtDate(perWeek[sel].w)}: ${perWeek[sel].count} run${perWeek[sel].count === 1 ? '' : 's'}, ${perWeek[sel].km.toFixed(1)} km`
            : 'Tap a week for details.'}
        </p>
      </div>

      <div className="log">
        <h3>Run log</h3>
        {runs.length ? (
          <table>
            <thead><tr><th>Date</th><th className="num">Distance</th><th className="num">Time</th><th className="num hide-s">Pace</th><th className="hide-s">Where</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}{r.note && <span className="note">{r.note}</span>}</td>
                  <td className="num">{r.km.toFixed(1)} km</td>
                  <td className="num">{Math.round(r.minutes)} min</td>
                  <td className="num hide-s">{pace(r)}</td>
                  <td className="hide-s">{r.where === 'race' ? 'Race' : r.where === 'treadmill' ? 'Treadmill' : 'Outside'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">First run incoming. Check back soon.</p>
        )}
      </div>
    </section>
  )
}

function KR2({ books, stats }: { books: Book[]; stats: ReturnType<typeof readingStats> }) {
  const onPace = stats.actualPerDay >= stats.needPerDay
  const summary = stats.read === 0
    ? `Nothing read yet. Finishing on time means about ${Math.ceil(stats.needPerDay)} pages a day until Opening Day.`
    : stats.daysIn < 7
      ? `${stats.read.toLocaleString('en-CA')} pages read so far. Finishing on time means about ${Math.ceil(stats.needPerDay)} pages a day until Opening Day.`
      : `Reading ${stats.actualPerDay.toFixed(0)} pages a day against the ${stats.needPerDay.toFixed(0)} needed. ${onPace ? 'On pace.' : 'Behind pace.'}`
  return (
    <section className="section" id="kr2">
      <div className="section-heading">
        <p className="kicker">KR2</p>
        <h2>Finish the 12 books a very well-read friend lent me, by Opening Day.</h2>
        <p>{summary}</p>
      </div>
      <ol className="books">
        {books.map((b) => {
          const p = Math.min(1, b.page / b.pages)
          return (
            <li key={b.id} className={`book ${p >= 1 ? 'finished' : p > 0 ? 'reading' : ''}`}>
              <span className="book-n">{b.id}</span>
              <span className="book-title">
                <strong>{b.title}</strong>
                <span>{b.author}</span>
              </span>
              <span className="book-progress">
                <span className="bar" role="img" aria-label={`${Math.round(p * 100)}% read`}><span style={{ width: `${p * 100}%` }} /></span>
                <span className="book-state">{p >= 1 ? 'Finished' : p > 0 ? `Page ${b.page} of ${b.pages}` : 'Not started'}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
