// Every URL is relative: the python server owns page and API on one origin,
// and vite's dev proxy forwards /api during development.
//
// Signed-in mode: once the server has users, every call carries the person's
// token. It lives in localStorage (a per-viewer convenience; the server is the
// authority on who may do what). A 401 sends the page to the sign-in screen.

import { useEffect, useState } from 'react'
import type { User, UserRole } from '@/lib/types'
import { accessToken } from '@/lib/oidc'

const KEY = 'sdlc.token'

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    /* private window: the token lasts for this page only */
  }
}

/** A link opened in a new tab (reports) cannot send a header, so the token rides in the query. */
export function withToken(path: string): string {
  const t = accessToken() || getToken()
  return t ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t) : path
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const t = accessToken() || getToken()
  if (t) headers.Authorization = 'Bearer ' + t
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (res.status === 401) window.dispatchEvent(new Event('sdlc:signin'))
  if (!res.ok) throw new ApiError((data && (data.error || data.detail)) || res.statusText, res.status)
  return data as T
}

export const api = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => call<T>('PUT', p, b),
  del: <T>(p: string) => call<T>('DELETE', p),
}

const RANK: Record<UserRole, number> = { viewer: 0, member: 1, lead: 2, admin: 3 }

export function can(user: User | null, role: UserRole): boolean {
  return !!user && RANK[user.role] >= RANK[role]
}

let cached: { user: User; openMode: boolean } | null = null
const listeners = new Set<() => void>()

export function refreshMe() {
  return api
    .get<{ user: User; openMode: boolean }>('/me')
    .then((d) => {
      cached = d
      listeners.forEach((f) => f())
      return d
    })
    .catch(() => null)
}

/** The signed-in person (in open mode: 'local', admin). */
export function useMe(): { user: User | null; openMode: boolean } {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    if (!cached) refreshMe()
    return () => {
      listeners.delete(f)
    }
  }, [])
  return { user: cached?.user || null, openMode: !!cached?.openMode }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
