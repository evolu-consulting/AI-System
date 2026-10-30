import { useEffect, useState } from 'react'
import { BOX, Button } from '@/components/ui'
import { api, refreshMe, setToken } from '@/lib/api'
import { completeLogin, loadConfig, onAuthChange, resume, signedIn } from '@/lib/oidc'
import { useRoute } from '@/lib/route'
import type { User } from '@/lib/types'
import { Admin } from '@/pages/Admin'
import type { AdminSection } from '@/pages/Admin'
import { StepChat } from '@/pages/StepChat'
import { DlcHome } from '@/pages/DlcHome'
import { DlcNode } from '@/pages/DlcNode'
import { DlcRun } from '@/pages/DlcRun'
import { Login } from '@/pages/Login'

const SECTIONS: AdminSection[] = ['agents', 'groups', 'workflows', 'templates', 'users', 'settings', 'claude', 'queue', 'sidecars', 'processes', 'audit']

type Gate = { state: 'loading' } | { state: 'login'; error?: string } | { state: 'ready'; auth: boolean }

/** Sign-in gate: when the server says sign-in is on, nothing renders until Keycloak has signed the person in. */
export default function App() {
  const [gate, setGate] = useState<Gate>({ state: 'loading' })
  useEffect(() => {
    let live = true
    ;(async () => {
      const cfg = await loadConfig().catch(() => null)
      if (!cfg || !cfg.auth.enabled) return live && setGate({ state: 'ready', auth: false })
      try {
        await completeLogin()
      } catch (e) {
        return live && setGate({ state: 'login', error: String((e as Error).message) })
      }
      resume()
      if (live) setGate(signedIn() ? { state: 'ready', auth: true } : { state: 'login' })
    })()
    const off = onAuthChange(() => {
      if (!signedIn()) setGate({ state: 'login', error: 'Your session ended. Please sign in again.' })
    })
    return () => {
      live = false
      off()
    }
  }, [])
  if (gate.state === 'loading') return <div className="grid h-screen place-items-center text-[13px]" style={{ color: 'var(--muted-ink)' }}>Loading…</div>
  if (gate.state === 'login') return <Login error={gate.error} />
  return <Routed auth={gate.auth} />
}

function Routed({ auth }: { auth: boolean }) {
  const parts = useRoute()
  const [signin, setSignin] = useState(false)
  useEffect(() => {
    const on = () => setSignin(true)
    window.addEventListener('sdlc:signin', on)
    return () => window.removeEventListener('sdlc:signin', on)
  }, [])
  if (signin && !auth) return <SignIn onDone={() => setSignin(false)} />
  let page
  if (parts[0] === 'run' && parts[1] && parts[2] === 'node' && parts[3]) {
    return <DlcNode runId={decodeURIComponent(parts[1])} nodeId={decodeURIComponent(parts[3])} />
  } else if (parts[0] === 'run' && parts[1]) {
    return <DlcRun runId={decodeURIComponent(parts[1])} />
  } else if (parts[0] === 'runs' && parts[2] === 'steps') {
    page = <StepChat runId={Number(parts[1])} pos={Number(parts[3]) || 1} />
  } else if (parts[0] === 'admin' || parts[0] === 'classic') {
    const section = (SECTIONS.includes(parts[1] as AdminSection) ? parts[1] : 'workflows') as AdminSection
    page = <Admin section={section} id={parts[2]} />
  } else {
    return <DlcHome />
  }
  // Admin (process steps, agents, workflows, users, settings, Claude token) keeps its own layout.
  return <div className="h-screen overflow-y-auto bg-background text-foreground">{page}</div>
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [token, setTok] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    try {
      const out = await api.post<{ user: User }>('/login', { token: token.trim() })
      setToken(token.trim())
      await refreshMe()
      setErr('')
      onDone()
      void out
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  return (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-card p-6">
        <h1 className="text-[18px] font-semibold">Sign in to KH SDLC</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Paste the token an admin gave you (created with <code>python sdlc.py user NAME</code> or in Admin → Users).
        </p>
        <input
          autoFocus
          type="password"
          className={BOX + ' mt-4'}
          value={token}
          onChange={(e) => setTok(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && token.trim() && submit()}
          placeholder="token"
        />
        {err && <p className="mt-2 text-[12px] text-red-300">{err}</p>}
        <Button tone="primary" className="mt-4 w-full" disabled={!token.trim()} onClick={submit}>
          Sign in
        </Button>
      </div>
    </div>
  )
}
