import { useEffect, useState, type FormEvent } from 'react'
import { type Data, type ReadingEntry, type Run, fmtDate, today } from './model'
import { REPO, checkToken, loadFromGitHub, saveToGitHub, tokenStore } from './github'

export function Admin({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const [token, setToken] = useState(tokenStore.get())
  const [sha, setSha] = useState('')
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string; link?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    loadFromGitHub(token)
      .then(({ data: fresh, sha }) => {
        setSha(sha)
        onChange(fresh)
      })
      .catch((e) => setStatus({ kind: 'error', text: e.message }))
  }, [token])

  if (!token) return <Connect onConnected={(t) => { tokenStore.set(t); setToken(t) }} />

  const commit = async (next: Data, message: string) => {
    setBusy(true)
    setStatus(null)
    try {
      const stamped = { ...next, updatedAt: new Date().toISOString() }
      const res = await saveToGitHub(token, stamped, sha, message)
      setSha(res.sha)
      onChange(stamped)
      setStatus({ kind: 'info', text: 'Saved. The public page updates in about a minute.', link: res.commitUrl })
      return true
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin" aria-label="Update progress">
      <div className="admin-head">
        <h2>Update progress</h2>
        <button type="button" className="button secondary small" onClick={() => { tokenStore.clear(); setToken('') }}>Sign out</button>
      </div>
      {status && (
        <p className={`admin-status ${status.kind}`} role="status">
          {status.text} {status.link && <a href={status.link} target="_blank" rel="noreferrer">View commit</a>}
        </p>
      )}
      <div className="admin-grid">
        <LogRun busy={busy || !sha} onSave={(run) => commit({ ...data, runs: [...data.runs, run] }, `Log ${run.km} km run (${run.date})`)} />
        <Books data={data} busy={busy || !sha} onSave={(books, msg, sessions) => commit({ ...data, books, reading: [...(data.reading ?? []), ...sessions] }, msg)} />
      </div>
      {data.runs.length > 0 && (
        <details className="admin-runs">
          <summary>Edit logged runs ({data.runs.length})</summary>
          <ul>
            {[...data.runs].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
              <li key={r.id}>
                <span>{fmtDate(r.date)} · {r.km} km · {r.minutes} min</span>
                <button type="button" className="link-button" disabled={busy} onClick={() => commit({ ...data, runs: data.runs.filter((x) => x.id !== r.id) }, `Remove run from ${r.date}`)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Connect({ onConnected }: { onConnected: (t: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setChecking(true)
    setError('')
    const problem = await checkToken(value.trim()).catch(() => 'Couldn’t reach GitHub. Check your connection.')
    setChecking(false)
    if (problem) setError(problem)
    else onConnected(value.trim())
  }
  return (
    <section className="admin" aria-label="Owner sign-in">
      <h2>Owner sign-in</h2>
      <p className="muted">
        Updates are saved to the <code>{REPO}</code> repository on GitHub, so only a token with write access to it can change anything here. The token stays in this browser.
      </p>
      <form className="connect" onSubmit={submit}>
        <label>
          <span>GitHub token</span>
          <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="github_pat_…" required />
        </label>
        <button className="button primary" type="submit" disabled={checking || !value.trim()}>{checking ? 'Checking…' : 'Sign in'}</button>
      </form>
      {error && <p className="admin-status error" role="alert">{error}</p>}
    </section>
  )
}

function LogRun({ busy, onSave }: { busy: boolean; onSave: (r: Run) => Promise<boolean> }) {
  const [date, setDate] = useState(today())
  const [km, setKm] = useState('')
  const [minutes, setMinutes] = useState('')
  const [where, setWhere] = useState<Run['where']>('treadmill')
  const [note, setNote] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const run: Run = { id: crypto.randomUUID(), date, km: Math.round(parseFloat(km) * 100) / 100, minutes: parseFloat(minutes), where, note: note.trim() || undefined }
    if (!(run.km > 0) || !(run.minutes > 0)) return
    if (await onSave(run)) {
      setKm('')
      setMinutes('')
      setNote('')
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Log a run</h3>
      <div className="fields">
        <label><span>Date</span><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></label>
        <label><span>Distance (km)</span><input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="5.0" required /></label>
        <label><span>Time (minutes)</span><input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="30" required /></label>
        <label>
          <span>Where</span>
          <select value={where} onChange={(e) => setWhere(e.target.value as Run['where'])}>
            <option value="treadmill">Treadmill</option>
            <option value="outside">Outside</option>
            <option value="race">Race day</option>
          </select>
        </label>
        <label className="wide"><span>Note (optional, public)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Felt good after the first 10 minutes" /></label>
      </div>
      <button className="button primary" type="submit" disabled={busy}>Save run</button>
    </form>
  )
}

function Books({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (books: Data['books'], msg: string, sessions: ReadingEntry[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(data.books.map((b) => [b.id, { page: String(b.page), pages: String(b.pages) }])))
  useEffect(() => {
    setDraft(Object.fromEntries(data.books.map((b) => [b.id, { page: String(b.page), pages: String(b.pages) }])))
  }, [data.books])

  const [readOn, setReadOn] = useState(today())
  const changed = data.books.filter((b) => String(b.page) !== draft[b.id]?.page || String(b.pages) !== draft[b.id]?.pages)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const books = data.books.map((b) => {
      const d = draft[b.id]
      const pages = Math.max(1, parseInt(d.pages) || b.pages)
      return { ...b, pages, page: Math.min(pages, Math.max(0, parseInt(d.page) || 0)) }
    })
    // Log pages moved forward as a reading session on the chosen day, so the site can show momentum.
    const sessions = books
      .map((b) => ({ date: readOn, bookId: b.id, pages: b.page - (data.books.find((o) => o.id === b.id)?.page ?? 0) }))
      .filter((s) => s.pages > 0)
    const first = books.find((b) => changed.some((c) => c.id === b.id))
    const msg = changed.length === 1 && first ? `Reading: ${first.title}, page ${first.page} of ${first.pages}` : `Reading update (${changed.length} books)`
    await onSave(books, msg, sessions)
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Reading progress</h3>
      <p className="muted small-text">Current page, and the page count of your edition (the defaults are estimates).</p>
      <label className="read-on"><span>Read on</span><input type="date" value={readOn} max={today()} onChange={(e) => setReadOn(e.target.value)} /></label>
      <ol className="book-edit">
        {data.books.map((b) => (
          <li key={b.id}>
            <span className="be-title">{b.title}</span>
            <input aria-label={`${b.title}: current page`} inputMode="numeric" value={draft[b.id]?.page ?? ''} onChange={(e) => setDraft({ ...draft, [b.id]: { ...draft[b.id], page: e.target.value } })} />
            <span className="be-of">of</span>
            <input aria-label={`${b.title}: total pages`} inputMode="numeric" value={draft[b.id]?.pages ?? ''} onChange={(e) => setDraft({ ...draft, [b.id]: { ...draft[b.id], pages: e.target.value } })} />
          </li>
        ))}
      </ol>
      <button className="button primary" type="submit" disabled={busy || changed.length === 0}>
        {changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'No changes'}
      </button>
    </form>
  )
}
