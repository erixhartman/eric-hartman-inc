import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type Book, type Data, type Run, HALF_KM, OPENING_DAY, RACE_DAY,
  dailyActivity, daysBetween, fmtDate, pace, readingStats, seasonWeeks, today, trainingPhases, weekStart, weeklyTotals,
} from './model'
import { Admin } from './Admin'
import { ActivityStrip, SeasonGrid, Spark } from './Momentum'

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
          <a href="#season">The record</a>
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
  const days = dailyActivity(data, 28, now)
  const weeks = weeklyTotals(data, 8, now)
  const range = `the last 8 weeks, from the week of ${fmtDate(weeks[0].start)}`
  const activePhase = trainingPhases(runs, now).find((p) => p.active)
  const kr1Status = raceRun
    ? 'Race run. Results are in the log below.'
    : activePhase
      ? `Now: ${activePhase.plan.charAt(0).toLowerCase() + activePhase.plan.slice(1)}. ${activePhase.status}.`
      : 'Race week.'

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">FY2027 roadmap</p>
          <h1>Improve long-term health and performance.</h1>
          <p className="hero-tagline">
            Shareholders asked for public accountability. Here’s how it’s going, including where I fall short.
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
          <ActivityStrip days={days} />
        </aside>
      </section>

      <section className="scorecard" aria-label="Scorecard">
        <div className="kr-group">
          <div className="kr-head">
            <p className="kicker">KR1</p>
            <h2 className="kr-title">Half marathon</h2>
            <p className="kr-status">{kr1Status}</p>
            <a className="kr-link" href="#kr1">Training plan and run log</a>
          </div>
          <div className="kr-tiles">
            <Metric value={raceRun ? 'Done' : `${longest.toFixed(1)}`} unit={raceRun ? '' : 'km'} label={raceRun ? `Finished in ${Math.floor(raceRun.minutes / 60)}:${String(Math.round(raceRun.minutes % 60)).padStart(2, '0')}` : `longest run, of ${HALF_KM} km on race day`} />
            <Metric value={String(thisWeek.length)} label={`runs this week (${thisWeek.reduce((s, r) => s + r.km, 0).toFixed(1)} km)`}
              spark={<Spark values={weeks.map((w) => w.runs)} target={5} label={`Runs per week over ${range}. Dashed line: the plan's 5 a week.`} />} />
            <Metric value={totalKm.toFixed(0)} unit="km" label="run since the post"
              spark={<Spark values={weeks.map((w) => w.km)} label={`Kilometres per week over ${range}: ${weeks.map((w) => w.km.toFixed(0)).join(', ')}`} />} />
          </div>
        </div>
        <div className="kr-group">
          <div className="kr-head">
            <p className="kicker">KR2</p>
            <h2 className="kr-title">Book list</h2>
            <p className="kr-status">{readingSummary(reading)}</p>
            <a className="kr-link" href="#kr2">All 12 books</a>
          </div>
          <div className="kr-tiles">
            <Metric value={`${reading.finished}`} unit="/ 12" label="books finished" />
            <Metric value={`${Math.round((reading.read / reading.total) * 100)}`} unit="%" label={`of ${reading.total.toLocaleString('en-CA')} pages read`}
              spark={<Spark values={weeks.map((w) => w.pages)} target={reading.needPerDay * 7} label={`Pages per week over ${range}. Dashed line: the weekly pace needed.`} />} />
            <Metric value={String(Math.ceil(reading.needPerDay))} label="pages a day needed by Opening Day" />
          </div>
        </div>
      </section>

      <KR1 runs={runs} now={now} longest={longest} />
      <KR2 books={data.books} stats={reading} />
      <Season data={data} now={now} />
    </>
  )
}

function Metric({ value, unit, label, spark }: { value: string; unit?: string; label: string; spark?: ReactNode }) {
  return (
    <div className="metric">
      <strong>{value}{unit && <small> {unit}</small>}</strong>
      <span>{label}</span>
      {spark && <div className="metric-spark">{spark}<span className="spark-note">Last 8 weeks</span></div>}
    </div>
  )
}

function KR1({ runs, now, longest }: { runs: Run[]; now: string; longest: number }) {
  const phases = trainingPhases(runs, now)
  const [showAll, setShowAll] = useState(false)
  const LOG_LIMIT = 8
  const shown = showAll ? runs : runs.slice(0, LOG_LIMIT)

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

      <div className="log">
        <h3>Run log{runs.length > 0 && <span className="log-count"> {runs.length} run{runs.length === 1 ? '' : 's'}</span>}</h3>
        {runs.length ? (
          <table>
            <thead><tr><th>Date</th><th className="num">Distance</th><th className="num">Time</th><th className="num hide-s">Pace</th><th className="hide-s">Where</th></tr></thead>
            <tbody>
              {shown.map((r) => (
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
        {runs.length > LOG_LIMIT && (
          <button type="button" className="button secondary small log-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show recent runs only' : `Show all ${runs.length} runs`}
          </button>
        )}
      </div>
    </section>
  )
}

function readingSummary(stats: ReturnType<typeof readingStats>) {
  const onPace = stats.actualPerDay >= stats.needPerDay
  if (stats.read === 0) return `Nothing read yet. Finishing on time means about ${Math.ceil(stats.needPerDay)} pages a day until Opening Day.`
  if (stats.daysIn < 7) return `${stats.read.toLocaleString('en-CA')} pages read so far. Finishing on time means about ${Math.ceil(stats.needPerDay)} pages a day until Opening Day.`
  return `Reading ${stats.actualPerDay.toFixed(0)} pages a day against the ${stats.needPerDay.toFixed(0)} needed. ${onPace ? 'On pace.' : 'Behind pace.'}`
}

function KR2({ books, stats }: { books: Book[]; stats: ReturnType<typeof readingStats> }) {
  const summary = readingSummary(stats)
  const rank = (b: Book) => (b.page > 0 && b.page < b.pages ? 0 : b.page >= b.pages ? 1 : 2)
  const ordered = [...books].sort((a, b) => rank(a) - rank(b) || a.id - b.id)
  return (
    <section className="section" id="kr2">
      <div className="section-heading">
        <p className="kicker">KR2</p>
        <h2>Finish the 12 books a very well-read friend lent me, by Opening Day.</h2>
        <p>{summary}</p>
      </div>
      <ol className="books">
        {ordered.map((b) => {
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
                <span className="book-state">{p >= 1 ? 'Finished' : p > 0 ? `Reading now, page ${b.page} of ${b.pages}` : 'Not started'}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Season({ data, now }: { data: Data; now: string }) {
  const weeks = seasonWeeks(data, now)
  const done = weeks.filter((w) => w.days.some((d) => !d.future))
  const activeWeeks = done.filter((w) => w.km > 0 || w.pages > 0).length
  return (
    <section className="section" id="season">
      <div className="section-heading">
        <p className="kicker">The record</p>
        <h2>The full season, one week per row.</h2>
        <p>
          From the LinkedIn post to race day. {done.length ? `Active in ${activeWeeks} of ${done.length} week${done.length === 1 ? '' : 's'} so far.` : ''} Empty rows are still to come.
        </p>
      </div>
      <SeasonGrid weeks={weeks} />
    </section>
  )
}
