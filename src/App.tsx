import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  type Book, type Data, type ReadingEntry, type Run, HALF_KM, OPENING_DAY, RACE_DAY,
  bookOrder, dailyActivity, daysBetween, fmtDate, fmtDuration, pace, readingStats, seasonWeeks, today, trainingPhases, weekStart, weeklyTotals,
} from './model'
import { Admin } from './Admin'
import { ServiceUpdate, type CoachUpdate } from './Coach'
import { ActivityStrip, SeasonGrid, Spark } from './Momentum'

// Visual reference: a Toronto subway line diagram. Line 1 (yellow) is the half
// marathon, Line 2 (green) is the book list. Stops passed are filled in.

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function Roundel({ n }: { n: 1 | 2 }) {
  return <span className={`roundel line-${n}`} aria-hidden="true">{n}</span>
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [coach, setCoach] = useState<CoachUpdate[]>([])
  const editing = useHash() === '#edit'

  useEffect(() => {
    fetch('/data.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError("The progress data didn't load. Refresh to try again."))
    // The coach's check-ins are optional: no file yet means no service update.
    fetch('/coach.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { updates: [] }))
      .then((j) => setCoach(Array.isArray(j.updates) ? j.updates : []))
      .catch(() => setCoach([]))
  }, [])

  return (
    <>
      <a className="skip" href="#top" onClick={(e) => { e.preventDefault(); document.getElementById('top')?.focus() }}>Skip to content</a>
      <header className="site-header">
        <div className="signbar">
          <a className="brand" href="#top">
            <Roundel n={1} />
            <Roundel n={2} />
            <span>Eric Hartman Inc.</span>
          </a>
          <nav aria-label="Sections">
            <a href="#kr1">Line 1</a>
            <a href="#kr2">Line 2</a>
            <a href="#season">The record</a>
            {coach.length > 0 && <a href="#coach">Service update</a>}
            {editing ? <a className="nav-cta" href="#">Done editing</a> : null}
          </nav>
        </div>
      </header>
      <main className="shell" id="top" tabIndex={-1}>
        {error && <p className="empty">{error}</p>}
        {!data && !error && <p className="empty">Loading the arrival boards…</p>}
        {data && (
          <>
            {editing && <Admin data={data} onChange={setData} />}
            <Report data={data} coach={coach} />
          </>
        )}
      </main>
      <footer className="footer">
        <div className="shell footer-inner">
          <p>
            Updated {data ? new Date(data.updatedAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '…'}.
            Race day is the Toronto Marathon half on May 2, 2027. Opening Day assumes there’s no lockout. Line colours borrowed from the subway with love; not affiliated with the TTC.
          </p>
          <p>
            <a href="https://eric-hartman-portfolio.vercel.app/">Eric Hartman</a>
            {!editing && <> <span className="sep" aria-hidden="true">/</span> <a href="#edit">Owner sign-in</a></>}
          </p>
        </div>
      </footer>
    </>
  )
}

function Report({ data, coach }: { data: Data; coach: CoachUpdate[] }) {
  const now = today()
  const runs = useMemo(() => [...data.runs].sort((a, b) => b.date.localeCompare(a.date)), [data.runs])
  const toRace = Math.max(0, daysBetween(now, RACE_DAY))
  const toOpener = Math.max(0, daysBetween(now, OPENING_DAY))
  const reading = readingStats(data.books, data.startDate, now)
  const days = dailyActivity(data, 28, now)
  const weeks = weeklyTotals(data, 8, now)

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">FY2027 roadmap</p>
          <h1>Improve long-term health and performance.</h1>
          <p className="hero-tagline">
            Two lines, one rider. Shareholders asked for public accountability, so this board shows every stop, including the missed ones.
          </p>
        </div>
        <aside className="hero-aside" aria-label="Countdowns and recent activity">
          <div className="board">
            <span className="board-name"><span className="dot line-1" aria-hidden="true" />Race day</span>
            <span className="board-time line-1-text">{toRace} days</span>
          </div>
          <div className="board">
            <span className="board-name"><span className="dot line-2" aria-hidden="true" />Opening Day</span>
            <span className="board-time line-2-text">{toOpener} days</span>
          </div>
          <p className="board-sub">Toronto Half Marathon, {fmtDate(RACE_DAY, { weekday: 'short', month: 'short', day: 'numeric' })}. Jays at Yankees, {fmtDate(OPENING_DAY, { weekday: 'short', month: 'short', day: 'numeric' })}.</p>
          <ActivityStrip days={days} />
        </aside>
      </section>

      <Line1 data={data} runs={runs} now={now} weeks={weeks} />
      <Line2 books={data.books} log={data.reading ?? []} stats={reading} weeks={weeks} />
      <Season data={data} now={now} />
      <ServiceUpdate updates={coach} />
    </>
  )
}

function Stat({ value, unit, label, spark }: { value: string; unit?: string; label: string; spark?: ReactNode }) {
  return (
    <div className="stat">
      <strong>{value}{unit && <small> {unit}</small>}</strong>
      <span>{label}</span>
      {spark && <div className="stat-spark">{spark}<span className="spark-note">Last 8 weeks</span></div>}
    </div>
  )
}

type StopState = 'done' | 'next' | 'ahead'

function Station({ pos, state, children, className = '' }: { pos: number; state: StopState; children: ReactNode; className?: string }) {
  return (
    <li className={`station ${state} ${className}`} style={{ '--pos': `${pos}%` } as CSSProperties}>
      <span className="stop" aria-hidden="true" />
      <span className="station-label">{children}</span>
    </li>
  )
}

// ---------- Line 1: the half marathon ----------
function Line1({ data, runs, now, weeks }: { data: Data; runs: Run[]; now: string; weeks: ReturnType<typeof weeklyTotals> }) {
  const phases = trainingPhases(runs, now)
  const active = phases.find((p) => p.active)
  const longest = Math.max(0, ...runs.map((r) => r.km))
  const thisWeek = runs.filter((r) => r.date >= weekStart(now))
  const totalKm = runs.reduce((s, r) => s + r.km, 0)
  const raceRun = runs.find((r) => r.where === 'race')
  const year = RACE_DAY.slice(0, 4)
  const range = `the last 8 weeks, from the week of ${fmtDate(weeks[0].start)}`

  const stops = [
    { date: data.startDate, when: fmtDate(data.startDate), what: 'Roadmap posted' },
    { date: `${Number(year) - 1}-12-01`, when: 'December', what: 'Run 30 minutes' },
    { date: `${year}-01-01`, when: 'January', what: '6 km, 5 times a week' },
    { date: `${year}-04-01`, when: 'April', what: 'Five 10 km runs' },
    { date: RACE_DAY, when: fmtDate(RACE_DAY), what: 'Race day' },
  ]
  // Stations are evenly spaced; "you are here" sits between them by date.
  const seg = stops.findIndex((_stop, i) => i === stops.length - 1 || now < stops[i + 1].date)
  const segFrac = seg >= stops.length - 1 ? 0 : Math.max(0, daysBetween(stops[seg].date, now)) / Math.max(1, daysBetween(stops[seg].date, stops[seg + 1].date))
  const here = Math.min(100, ((seg + segFrac) / (stops.length - 1)) * 100)
  const stateOf = (i: number): StopState => (stops[i].date <= now ? 'done' : i === seg + 1 ? 'next' : 'ahead')

  const status = raceRun
    ? 'Race run. Results are in the log.'
    : active
      ? `Now: ${active.plan.charAt(0).toLowerCase() + active.plan.slice(1)}. ${active.status}.`
      : 'Race week.'

  const [showAll, setShowAll] = useState(false)
  const LOG_LIMIT = 8
  const shown = showAll ? runs : runs.slice(0, LOG_LIMIT)

  return (
    <section className="section line-section" id="kr1">
      <div className="line-head">
        <Roundel n={1} />
        <div>
          <p className="kicker">Key result 1</p>
          <h2>Run the Toronto Half Marathon in May</h2>
          <p className="line-status">{status}</p>
        </div>
      </div>

      <div className="diagram">
        <ol className="track line-1" aria-label="Training plan stops">
          {/* Lists may only hold list items, so the rail and marker sit in items that don't affect layout. */}
          <li className="deco" aria-hidden="true">
            <span className="rail" />
            <span className="rail-done" style={{ '--pos': `${here}%` } as CSSProperties} />
          </li>
          <li className="deco"><span className="here" style={{ '--pos': `${here}%` } as CSSProperties}>You are here</span></li>
          {stops.map((s, i) => (
            <Station key={s.what} pos={(i / (stops.length - 1)) * 100} state={stateOf(i)}>
              <strong>{s.when}</strong>
              <span>{s.what}</span>
            </Station>
          ))}
        </ol>
      </div>

      <div className="stats">
        <Stat value={raceRun ? 'Done' : longest.toFixed(1)} unit={raceRun ? '' : 'km'} label={raceRun ? `Finished in ${fmtDuration(raceRun.minutes)}` : `longest run, of ${HALF_KM} km on race day`} />
        <Stat value={String(thisWeek.length)} label={`runs this week (${thisWeek.reduce((s, r) => s + r.km, 0).toFixed(1)} km)`}
          spark={<Spark values={weeks.map((w) => w.runs)} target={5} label={`Runs per week over ${range}. Dashed line: the plan's 5 a week.`} />} />
        <Stat value={totalKm.toFixed(0)} unit="km" label={`run since the post, across ${runs.length} run${runs.length === 1 ? '' : 's'}`}
          spark={<Spark values={weeks.map((w) => w.km)} label={`Kilometres per week over ${range}: ${weeks.map((w) => w.km.toFixed(0)).join(', ')}`} />} />
      </div>


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
                  <td className="num">{fmtDuration(r.minutes)}</td>
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

// ---------- Line 2: the book list ----------
function readingSummary(stats: ReturnType<typeof readingStats>) {
  const onPace = stats.actualPerDay >= stats.needPerDay
  if (stats.read === 0) return 'Nothing read yet.'
  if (stats.daysIn < 7) return `${stats.read.toLocaleString('en-CA')} pages read so far.`
  return `Reading ${stats.actualPerDay.toFixed(0)} pages a day. ${onPace ? 'On pace.' : 'Behind pace.'}`
}

function Line2({ books, log, stats, weeks }: { books: Book[]; log: ReadingEntry[]; stats: ReturnType<typeof readingStats>; weeks: ReturnType<typeof weeklyTotals> }) {
  // Left to right in the order things actually happened: finished (by finish date), in progress (by start date), then the rest.
  const ordered = bookOrder(books, log)
  const stateOf = (b: Book): StopState => (b.page >= b.pages ? 'done' : b.page > 0 ? 'next' : 'ahead')
  const range = `the last 8 weeks, from the week of ${fmtDate(weeks[0].start)}`

  return (
    <section className="section line-section" id="kr2">
      <div className="line-head">
        <Roundel n={2} />
        <div>
          <p className="kicker">Key result 2</p>
          <h2>Finish the 12 books a very well-read friend lent me, by Opening Day</h2>
          <p className="line-status">{readingSummary(stats)}</p>
        </div>
      </div>

      <div className="diagram">
        <ol className="track line-2 books-track" aria-label="The book list, finished books first">
          <li className="deco" aria-hidden="true"><span className="rail" /></li>
          {ordered.map((b, i) => (
            <Station key={b.id} pos={(i / (ordered.length - 1)) * 100} state={stateOf(b)} className="book-stop">
              <strong>{b.title}</strong>
              <span className="stop-detail">{b.page >= b.pages ? 'Finished' : b.page > 0 ? `Page ${b.page} of ${b.pages}` : 'Not started'}</span>
            </Station>
          ))}
        </ol>
      </div>

      <div className="stats">
        <Stat value={`${stats.finished}`} unit="/ 12" label="books finished" />
        <Stat value={`${Math.round((stats.read / stats.total) * 100)}`} unit="%" label={`of ${stats.total.toLocaleString('en-CA')} pages read`}
          spark={<Spark values={weeks.map((w) => w.pages)} target={stats.needPerDay * 7} label={`Pages per week over ${range}. Dashed line: the weekly pace needed.`} />} />
        <Stat value={String(Math.ceil(stats.needPerDay))} label="pages a day needed by Opening Day" />
      </div>

      <ol className="books">
        {ordered.map((b) => {
          const p = Math.min(1, b.page / b.pages)
          return (
            <li key={b.id} className={`book ${stateOf(b)}`}>
              <span className="book-n">{b.id}</span>
              <span className="book-title">
                <strong>{b.title}</strong>
                <span>{b.author}</span>
              </span>
              <span className="book-progress">
                <span className="bar line-2" role="img" aria-label={`${Math.round(p * 100)}% read`}><span style={{ width: `${p * 100}%` }} /></span>
                <span className="book-state">{p >= 1 ? 'Finished' : p > 0 ? `Reading now, page ${b.page} of ${b.pages}` : 'Not started'}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="muted small-note">Numbers are the order in the original list. Page counts are estimates until checked against the physical editions.</p>
    </section>
  )
}

function Season({ data, now }: { data: Data; now: string }) {
  const weeks = seasonWeeks(data, now)
  const done = weeks.filter((w) => w.days.some((d) => !d.future))
  const activeWeeks = done.filter((w) => w.km > 0 || w.pages > 0).length
  return (
    <section className="section" id="season">
      <div className="line-head">
        <span className="roundel record" aria-hidden="true"><span /></span>
        <div>
          <p className="kicker">The record</p>
          <h2>The full season, one week per row</h2>
          <p className="line-status">
            From the post to race day. {done.length ? `Active in ${activeWeeks} of ${done.length} week${done.length === 1 ? '' : 's'} so far.` : ''} Empty rows are still to come.
          </p>
        </div>
      </div>
      <SeasonGrid weeks={weeks} />
    </section>
  )
}
