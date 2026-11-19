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

export interface Data {
  updatedAt: string
  startDate: string
  runs: Run[]
  books: Book[]
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
