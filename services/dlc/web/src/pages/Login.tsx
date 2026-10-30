import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { Background, Logo } from '@/components/dlc'
import { login } from '@/lib/oidc'

/** Design 30: a frosted glass card on a pale blue page. Sign-in itself happens on Keycloak. */
export function Login({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await login()
    } catch {
      setBusy(false)
    }
  }
  return (
    <div className="relative flex min-h-screen flex-col">
      <Background />
      <header className="relative z-10 flex items-center px-6 py-5 md:px-10">
        <Logo />
      </header>
      <main className="relative z-10 grid flex-1 place-items-center px-5 pb-10">
        <div className="glass-hi w-full max-w-[440px] px-9 pb-8 pt-9">
          <div className="mb-4 flex justify-center">
            <div
              className="grid h-14 w-14 place-items-center rounded-[18px]"
              style={{ background: 'rgba(77,141,255,.12)', border: '1px solid rgba(77,141,255,.25)' }}
            >
              <LogIn size={24} color="#1f6fe5" />
            </div>
          </div>
          <h1 className="title-navy text-center text-[30px]">Welcome back</h1>
          <p className="mb-6 mt-1.5 text-center text-[14px]" style={{ color: 'var(--muted-ink)' }}>
            Sign in to follow your delivery runs.
          </p>
          <button className="btn-primary h-[50px] w-full text-[14.5px]" disabled={busy} onClick={go}>
            {busy ? 'Opening sign-in…' : 'Sign in'}
          </button>
          {error && <p className="mt-4 text-center text-[12.5px] text-[var(--red)]">{error}</p>}
          <p className="mt-5 text-center text-[12px]" style={{ color: 'var(--muted-ink)' }}>
            You are redirected to your organisation's sign-in page and back here.
          </p>
        </div>
      </main>
      <footer className="relative z-10 flex justify-center pb-6 text-[12px]" style={{ color: 'var(--muted-ink)' }}>
        <span className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--green)' }}>
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--green)', boxShadow: '0 0 0 3px rgba(22,163,90,.2)' }} />
          Secure sign-in
        </span>
      </footer>
    </div>
  )
}
