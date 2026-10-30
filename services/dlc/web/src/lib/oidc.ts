// Keycloak sign-in for the default frontend: OIDC Authorization Code + PKCE (S256), public client.
//
// The server tells the page whether sign-in is on (/api/fe/config). Tokens live in sessionStorage
// (per tab, cleared when the tab closes) and are refreshed a minute before they expire.
//
// Plain-http origins (a VPS reached by IP and port) are NOT a secure context, so crypto.subtle
// does not exist there; the SHA-256 below is the fallback for the PKCE challenge.

export interface AuthInfo {
  enabled: boolean
  issuer: string
  client_id: string
  audience?: string
}

export interface FeConfig {
  version: string
  auth: AuthInfo
  public_url: string
  engine: boolean
}

interface Tokens {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_at: number // epoch ms
}

const KEY = 'dlc.oidc.tokens'
const PKCE_KEY = 'dlc.oidc.pkce'

let cfg: FeConfig | null = null
let endpoints: { auth: string; token: string; logout: string } | null = null
let refreshTimer: number | undefined
const listeners = new Set<() => void>()

function store(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function read(): Tokens | null {
  try {
    const raw = store()?.getItem(KEY)
    return raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    return null
  }
}

function write(t: Tokens | null) {
  try {
    if (t) store()?.setItem(KEY, JSON.stringify(t))
    else store()?.removeItem(KEY)
  } catch {
    /* storage blocked: the token lasts for this page only */
  }
  memory = t
  listeners.forEach((f) => f())
}

let memory: Tokens | null = null

export function onAuthChange(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export async function loadConfig(): Promise<FeConfig> {
  if (cfg) return cfg
  const res = await fetch('/api/fe/config')
  cfg = (await res.json()) as FeConfig
  return cfg
}

export function config(): FeConfig | null {
  return cfg
}

async function discover(): Promise<{ auth: string; token: string; logout: string }> {
  if (endpoints) return endpoints
  const iss = (cfg?.auth.issuer || '').replace(/\/$/, '')
  try {
    const r = await fetch(iss + '/.well-known/openid-configuration')
    const d = await r.json()
    endpoints = { auth: d.authorization_endpoint, token: d.token_endpoint, logout: d.end_session_endpoint || '' }
  } catch {
    endpoints = {
      auth: iss + '/protocol/openid-connect/auth',
      token: iss + '/protocol/openid-connect/token',
      logout: iss + '/protocol/openid-connect/logout',
    }
  }
  return endpoints
}

function redirectUri(): string {
  return window.location.origin + window.location.pathname
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(n = 48): string {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return b64url(a)
}

// ---- SHA-256 (fallback when crypto.subtle is missing) ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256(data: Uint8Array): Uint8Array {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const l = data.length
  const n = ((l + 9 + 63) >> 6) << 6
  const m = new Uint8Array(n)
  m.set(data)
  m[l] = 0x80
  const bits = l * 8
  const dv = new DataView(m.buffer)
  dv.setUint32(n - 4, bits >>> 0)
  dv.setUint32(n - 8, Math.floor(bits / 0x100000000))
  const w = new Uint32Array(64)
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  H.forEach((v, i) => odv.setUint32(i * 4, v))
  return out
}

async function challenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier)
  if (window.crypto?.subtle) {
    try {
      return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    } catch {
      /* fall through */
    }
  }
  return b64url(sha256(bytes))
}

/** Redirect to Keycloak's sign-in page. */
export async function login(): Promise<void> {
  const ep = await discover()
  const verifier = randomString(48)
  const state = randomString(16)
  store()?.setItem(PKCE_KEY, JSON.stringify({ verifier, state, back: window.location.hash }))
  const q = new URLSearchParams({
    client_id: cfg!.auth.client_id,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(ep.auth + '?' + q.toString())
}

function save(d: Record<string, unknown>) {
  const t: Tokens = {
    access_token: String(d.access_token),
    refresh_token: d.refresh_token ? String(d.refresh_token) : undefined,
    id_token: d.id_token ? String(d.id_token) : read()?.id_token,
    expires_at: Date.now() + Number(d.expires_in || 300) * 1000,
  }
  write(t)
  schedule(t)
}

function schedule(t: Tokens) {
  window.clearTimeout(refreshTimer)
  const wait = Math.max(5000, t.expires_at - Date.now() - 60000)
  refreshTimer = window.setTimeout(() => void refresh(), wait)
}

export async function refresh(): Promise<boolean> {
  const t = read()
  if (!t?.refresh_token) return false
  const ep = await discover()
  try {
    const r = await fetch(ep.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg!.auth.client_id, refresh_token: t.refresh_token }),
    })
    if (!r.ok) throw new Error(String(r.status))
    save(await r.json())
    return true
  } catch {
    write(null)
    return false
  }
}

/** Finish the redirect (?code=&state=) if this page load is one. Returns true when signed in now. */
export async function completeLogin(): Promise<boolean> {
  const u = new URL(window.location.href)
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  if (!code) return false
  const saved = JSON.parse(store()?.getItem(PKCE_KEY) || '{}')
  store()?.removeItem(PKCE_KEY)
  const clean = u.origin + u.pathname + (saved.back || '')
  if (!saved.verifier || saved.state !== state) {
    window.history.replaceState(null, '', clean)
    throw new Error('sign-in state mismatch, please sign in again')
  }
  const ep = await discover()
  const r = await fetch(ep.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg!.auth.client_id,
      code,
      redirect_uri: redirectUri(),
      code_verifier: saved.verifier,
    }),
  })
  window.history.replaceState(null, '', clean)
  if (!r.ok) throw new Error('sign-in failed (' + r.status + ')')
  save(await r.json())
  return true
}

/** The current access token ('' when signed out or when sign-in is off). */
export function accessToken(): string {
  const t = memory || read()
  if (!t) return ''
  if (t.expires_at < Date.now()) return ''
  return t.access_token
}

export function signedIn(): boolean {
  return !!accessToken() || !!read()?.refresh_token
}

/** Resume the refresh timer after a page reload. */
export function resume() {
  const t = read()
  if (t) {
    memory = t
    if (t.expires_at - Date.now() < 60000) void refresh()
    else schedule(t)
  }
}

export interface Profile {
  name: string
  email: string
  roles: string[]
}

export function profile(): Profile | null {
  const tok = accessToken() || read()?.access_token || ''
  if (!tok) return null
  try {
    const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const roles: string[] = [...(p.realm_access?.roles || [])]
    Object.values(p.resource_access || {}).forEach((b) => roles.push(...(((b as { roles?: string[] }).roles) || [])))
    return { name: p.preferred_username || p.name || p.email || p.sub, email: p.email || '', roles }
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  const t = read()
  write(null)
  window.clearTimeout(refreshTimer)
  const ep = await discover()
  if (ep.logout) {
    const q = new URLSearchParams({ client_id: cfg!.auth.client_id, post_logout_redirect_uri: redirectUri() })
    if (t?.id_token) q.set('id_token_hint', t.id_token)
    window.location.assign(ep.logout + '?' + q.toString())
  } else {
    window.location.reload()
  }
}
