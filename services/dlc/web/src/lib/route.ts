import { useEffect, useState } from 'react'

// Hash routes: #/ home, #/runs/:id/steps/:pos chat, #/admin/:section/:id admin.
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => setParts(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export function go(path: string) {
  window.location.hash = '#/' + path.replace(/^\//, '')
}

// The page the person came from, so Back returns there (Home with its open projects and scroll) and not to a
// fixed parent page.
let previous = ''
let current = typeof window === 'undefined' ? '' : window.location.hash
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    previous = current
    current = window.location.hash
  })
}

/** The route the person came from ('' when the page was opened directly), without the leading "#/". */
export function cameFrom(): string {
  return previous.replace(/^#\/?/, '')
}

/** Back to the page the person came from; `fallback` when the page was opened directly. */
export function goBack(fallback: string) {
  if (previous) window.history.back()
  else go(fallback)
}

/** Move without a new history entry (switching between the steps of one run): Back still leaves the run. */
export function goReplace(path: string) {
  window.location.replace('#/' + path.replace(/^\//, ''))
}
