// Saving = committing public/data.json to the repo with the owner's GitHub token.
// Anyone can read the site; only someone holding a token with write access to
// this repo can change it. Each save is a commit, so the history is the audit log.
import type { Data } from './model'

export const REPO = 'erixhartman/eric-hartman-inc'
const PATH = 'public/data.json'
const API = `https://api.github.com/repos/${REPO}`

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem('gh-token') || ''
    } catch {
      return ''
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem('gh-token', t)
    } catch {
      /* private mode: token lasts for this visit only */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem('gh-token')
    } catch {
      /* nothing to clear */
    }
  },
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

/** Checks the token can write to this repo. Returns an error message, or '' if fine. */
export async function checkToken(token: string) {
  const res = await fetch(API, { headers: headers(token) })
  if (res.status === 401) return "GitHub didn't accept that token. Check you copied all of it."
  if (res.status === 404) return `That token can't see ${REPO}. Give it access to this repository.`
  if (!res.ok) return `GitHub returned an error (${res.status}). Try again in a minute.`
  const repo = await res.json()
  if (!repo.permissions?.push) return 'That token can read the repo but not write to it. Set Contents to "Read and write".'
  return ''
}

const toBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/** Fetch the latest committed data straight from GitHub (fresher than the deployed copy). */
export async function loadFromGitHub(token: string): Promise<{ data: Data; sha: string }> {
  const res = await fetch(`${API}/contents/${PATH}?ref=main`, { headers: headers(token), cache: 'no-store' })
  if (!res.ok) throw new Error(`Couldn't load the data file (${res.status}).`)
  const json = await res.json()
  const text = new TextDecoder().decode(Uint8Array.from(atob(json.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)))
  return { data: JSON.parse(text), sha: json.sha }
}

export async function saveToGitHub(token: string, data: Data, sha: string, message: string) {
  const body = JSON.stringify({
    message,
    content: toBase64(JSON.stringify(data, null, 2) + '\n'),
    sha,
    branch: 'main',
  })
  const res = await fetch(`${API}/contents/${PATH}`, { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body })
  if (res.status === 409) throw new Error('The data changed somewhere else since you loaded it. Reload the page and try again.')
  if (!res.ok) throw new Error(`Save failed (${res.status}). Nothing was changed.`)
  const json = await res.json()
  return { sha: json.content.sha as string, commitUrl: json.commit.html_url as string }
}
