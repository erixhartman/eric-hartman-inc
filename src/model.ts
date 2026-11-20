export interface Run {
  id: string
  date: string // YYYY-MM-DD, local
  km: number
  minutes: number
  where: 'treadmill' | 'outside' | 'race'
  note?: string
}

export interface Book {
  id: number
  title: string
  author: string
  pages: number
  page: number
}

/** One reading session: pages read in a book on a day. Logged on each save so progress has a history. */
export interface ReadingEntry {
  date: string
  bookId: number
  pages: number
}

export interface Data {
  updatedAt: string
  startDate: string
  runs: Run[]
  books: Book[]
  reading?: ReadingEntry[]
}

export const RACE_DAY = '2027-05-02' // Toronto Marathon (half), Sunday May 2, 2027
export const OPENING_DAY = '2027-03-25' // Blue Jays at Yankees, MLB Opening Day 2027
export const HALF_KM = 21.1

// ---------- dates (all local, day precision) ----------
export const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const today = () => iso(new Date())
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
export const weekStart = (d: string) => {
  const x = parse(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return iso(x)
}
export const addDays = (d: string, n: number) => {
  const x = parse(d)
  x.setDate(x.getDate() + n)
  return iso(x)
}
export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  parse(d).toLocaleDateString('en-CA', opts)

export const pace = (r: Run) => {
  if (!r.km || !r.minutes) return '—'
  const secs = Math.round((r.minutes * 60) / r.km)
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}/km`
}

// ---------- KR1: training plan ----------
export interface Phase {
  key: string
  when: string
  plan: string
  status: string
  done: number // 0–1
  active: boolean
  future: boolean
}

export function trainingPhases(runs: Run[], now = today()): Phase[] {
  const year = Number(RACE_DAY.slice(0, 4))
  const janStart = `${year}-01-01`
  const aprStart = `${year}-04-01`

  // Phase 1: build to a 30-minute run by the end of December
  const longestMinutes = Math.max(0, ...runs.map((r) => r.minutes))
  const p1Done = Math.min(1, longestMinutes / 30)

  // Phase 2: Jan–Mar, at least 5 runs of 6 km+ every week
  const weeks: string[] = []
  for (let w = weekStart(janStart); w < aprStart; w = addDays(w, 7)) weeks.push(w)
  const elapsedWeeks = weeks.filter((w) => addDays(w, 6) < now)
  const hitWeeks = elapsedWeeks.filter((w) => runs.filter((r) => r.km >= 6 && r.date >= w && r.date <= addDays(w, 6)).length >= 5)
  const p2Done = weeks.length ? hitWeeks.length / weeks.length : 0

  // Phase 3: Apr–race day, at least five 10 km runs
  const tens = runs.filter((r) => r.km >= 10 && r.date >= aprStart && r.date <= RACE_DAY).length
  const p3Done = Math.min(1, tens / 5)

  return [
    {
      key: 'p1', when: 'December', plan: 'Build up to running 30 minutes on the treadmill',
      status: longestMinutes >= 30 ? 'Done' : longestMinutes ? `Longest run so far: ${Math.round(longestMinutes)} min` : 'No runs logged yet',
      done: p1Done, active: now < janStart, future: false,
    },
    {
      key: 'p2', when: 'January to March', plan: 'Run at least 6 km, at least 5 times a week',
      status: now < janStart ? `Starts ${fmtDate(janStart)}` : `${hitWeeks.length} of ${elapsedWeeks.length} completed weeks on plan`,
      done: p2Done, active: now >= janStart && now < aprStart, future: now < janStart,
    },
    {
      key: 'p3', when: 'April to race day', plan: 'Keep up 5 runs a week, including at least five 10 km runs',
      status: now < aprStart ? `Starts ${fmtDate(aprStart)}` : `${tens} of 5 ten-kilometre runs`,
      done: p3Done, active: now >= aprStart && now <= RACE_DAY, future: now < aprStart,
    },
  ]
}

// ---------- KR2: books ----------
export function readingStats(books: Book[], startDate: string, now = today()) {
  const total = books.reduce((s, b) => s + b.pages, 0)
  const read = books.reduce((s, b) => s + Math.min(b.page, b.pages), 0)
  const finished = books.filter((b) => b.page >= b.pages).length
  const daysLeft = Math.max(0, daysBetween(now, OPENING_DAY))
  const daysIn = Math.max(1, daysBetween(startDate, now))
  const needPerDay = daysLeft ? (total - read) / daysLeft : 0
  const actualPerDay = read / daysIn
  return { total, read, finished, daysLeft, needPerDay, actualPerDay, daysIn }
}

// ---------- momentum ----------
export interface Day {
  date: string
  km: number
  pages: number
}

export function dailyActivity(data: Data, days: number, now = today()): Day[] {
  const out: Day[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(now, -i)
    out.push({
      date,
      km: data.runs.filter((r) => r.date === date).reduce((s, r) => s + r.km, 0),
      pages: (data.reading ?? []).filter((e) => e.date === date).reduce((s, e) => s + e.pages, 0),
    })
  }
  return out
}

export interface Week {
  start: string
  runs: number
  km: number
  pages: number
}

export function weeklyTotals(data: Data, weeks: number, now = today()): Week[] {
  const thisWeek = weekStart(now)
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisWeek, -7 * (weeks - 1 - i))
    const end = addDays(start, 6)
    const rs = data.runs.filter((r) => r.date >= start && r.date <= end)
    return {
      start,
      runs: rs.length,
      km: rs.reduce((s, r) => s + r.km, 0),
      pages: (data.reading ?? []).filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.pages, 0),
    }
  })
}

/** Every week from the week of the post to race week, with day-level activity and milestones. */
export function seasonWeeks(data: Data, now = today()) {
  // Start at whichever comes first: the post, or the earliest logged activity.
  const earliest = [data.startDate, ...data.runs.map((r) => r.date), ...(data.reading ?? []).map((e) => e.date)].sort()[0]
  const first = weekStart(earliest)
  const last = weekStart(RACE_DAY)
  const marks: Record<string, string> = {
    [weekStart(data.startDate)]: 'Posted',
    [weekStart(`${RACE_DAY.slice(0, 4)}-01-01`)]: 'Phase 2',
    [weekStart(OPENING_DAY)]: 'Opening Day',
    [weekStart(`${RACE_DAY.slice(0, 4)}-04-01`)]: 'Phase 3',
    [last]: 'Race',
  }
  const weeks = []
  for (let w = first; w <= last; w = addDays(w, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(w, i)
      return {
        date,
        future: date > now,
        km: data.runs.filter((r) => r.date === date).reduce((s, r) => s + r.km, 0),
        pages: (data.reading ?? []).filter((e) => e.date === date).reduce((s, e) => s + e.pages, 0),
      }
    })
    weeks.push({
      start: w,
      days,
      km: days.reduce((s, d) => s + d.km, 0),
      pages: days.reduce((s, d) => s + d.pages, 0),
      marks: marks[w] ? [marks[w]] : [],
    })
  }
  return weeks
}

/**
 * Order books the way they were actually read: finished books by the date they
 * were finished, then books in progress by the date they were started, then
 * unstarted books in list order. Dates come from the reading log; a book with
 * progress but no log entries sorts after the dated ones in its group, by list
 * number, and same-day ties also fall back to list number.
 */
export function bookOrder(books: Book[], reading: ReadingEntry[] = []): Book[] {
  const first = new Map<number, string>()
  const last = new Map<number, string>()
  for (const r of reading) {
    if (r.pages <= 0) continue
    if (!first.has(r.bookId) || r.date < first.get(r.bookId)!) first.set(r.bookId, r.date)
    if (!last.has(r.bookId) || r.date > last.get(r.bookId)!) last.set(r.bookId, r.date)
  }
  const group = (b: Book) => (b.page >= b.pages ? 0 : b.page > 0 ? 1 : 2)
  const key = (b: Book) => {
    const g = group(b)
    if (g === 0) return last.get(b.id) ?? '9999'
    if (g === 1) return first.get(b.id) ?? '9999'
    return ''
  }
  return [...books].sort((a, b) => group(a) - group(b) || key(a).localeCompare(key(b)) || a.id - b.id)
}
