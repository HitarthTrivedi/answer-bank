// Fetch wrapper: bearer auth, one silent refresh on 401, JSON/error normalization.
const KEY_A = 'ab_access'
const KEY_R = 'ab_refresh'

export const tokens = {
  get access() { return localStorage.getItem(KEY_A) || '' },
  get refresh() { return localStorage.getItem(KEY_R) || '' },
  set({ access_token, refresh_token }) {
    if (access_token) localStorage.setItem(KEY_A, access_token)
    if (refresh_token) localStorage.setItem(KEY_R, refresh_token)
  },
  clear() { localStorage.removeItem(KEY_A); localStorage.removeItem(KEY_R) },
}

async function tryRefresh() {
  if (!tokens.refresh) return false
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh }),
  })
  if (!res.ok) return false
  tokens.set(await res.json())
  return true
}

async function request(path, opts = {}, canRetry = true) {
  const headers = { ...(opts.headers || {}) }
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`
  const res = await fetch('/api' + path, { ...opts, headers })

  // never treat a 401 from the auth endpoints themselves as an expired session —
  // a wrong password must surface as "Invalid email or password", not a refresh loop
  if (res.status === 401 && canRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return request(path, opts, false)
    tokens.clear()
    if (!location.pathname.startsWith('/auth')) location.assign('/auth')
    throw new Error('Session expired — sign in again')
  }
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch { /* not json */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res
}

const json = (body) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  get: (p) => request(p).then((r) => r.json()),
  post: (p, body) => request(p, { method: 'POST', ...(body !== undefined ? json(body) : {}) }).then((r) => r.json()),
  put: (p, body) => request(p, { method: 'PUT', ...json(body) }).then((r) => r.json()),
  del: (p) => request(p, { method: 'DELETE' }).then((r) => r.json()),
  postForm: (p, formData) => request(p, { method: 'POST', body: formData }).then((r) => r.json()),
  blob: (p) => request(p).then((r) => r.blob()),
}
