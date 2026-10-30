import { Ban, Bell, Check, CornerUpLeft, Flag, Hourglass, Loader2, MessageSquare, Minus, Pause, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { api, setToken, useMe } from '@/lib/api'
import { cn } from '@/lib/cn'
import { go } from '@/lib/route'
import type { Lane, Notice, Rag, Status } from '@/lib/types'

type Tone = 'default' | 'primary' | 'teal' | 'ghost' | 'danger' | 'good'

const TONES: Record<Tone, string> = {
  default: 'border border-[rgba(77,141,255,0.14)] bg-[var(--row)] font-semibold text-[var(--blue)] hover:bg-[rgba(77,141,255,0.08)]',
  primary: 'bg-gradient-to-r from-[#4d8dff] to-[#4d8dff] font-bold text-white shadow-[0_8px_20px_rgba(77,141,255,0.3)] hover:brightness-105',
  teal: 'bg-[var(--cyan)] font-semibold text-white hover:brightness-105',
  ghost: 'text-[var(--muted-ink)] hover:bg-[rgba(77,141,255,0.08)] hover:text-[var(--blue)]',
  danger: 'border border-red-500/25 bg-red-500/10 font-semibold text-[var(--red)] hover:bg-red-500/15',
  good: 'border border-green-400/25 bg-green-500/10 font-semibold text-[var(--green)] hover:bg-green-500/15',
}

export function Button({ tone = 'default', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        TONES[tone],
        className,
      )}
    />
  )
}

export const BOX =
  'h-9 w-full rounded-xl border border-[rgba(77,141,255,0.14)] bg-[var(--row)] px-3 text-[13px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted-ink)]/70 focus:border-[var(--blue)] focus:bg-[var(--row)] focus:shadow-[0_0_0_4px_rgba(77,141,255,0.12)]'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-start gap-x-4 py-2">
      <label className="pt-2 text-[13px] font-bold text-[var(--navy)]">{label}</label>
      <div>
        {children}
        {hint && <p className="mt-1 text-[11.5px] text-[var(--muted-ink)]">{hint}</p>}
      </div>
    </div>
  )
}

export function Chip({ children, onRemove, tone = 'default' }: { children: ReactNode; onRemove?: () => void; tone?: 'default' | 'lead' }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border pl-3 text-[12px]',
        onRemove ? 'pr-1' : 'pr-3',
        tone === 'lead' ? 'border-sky-400/40 bg-sky-500/15 font-semibold text-sky-300' : 'border-[var(--line2)] bg-[var(--row)] text-foreground',
      )}
    >
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="grid size-5 cursor-pointer place-items-center rounded-full border border-current/30 opacity-70 hover:bg-black/5 hover:opacity-100"
          title="Remove"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[rgba(77,141,255,0.1)]">
      <div className="h-full rounded-full bg-gradient-to-r from-[#4d8dff] to-[#4d8dff] transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export const STATUS_TEXT: Record<Status, string> = {
  pending: 'Pending',
  running: 'In progress',
  waiting_human: 'Waiting for you',
  awaiting_approval: 'Waiting for sign-off',
  done: 'Done',
  rework: 'Sent back for rework',
  failed: 'Failed',
  skipped: 'Skipped',
  paused: 'Paused',
  cancelled: 'Cancelled',
}

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const c = cn('size-3.5 shrink-0', className)
  if (status === 'done') return <Check className={cn(c, 'text-[var(--green)]')} />
  if (status === 'running') return <Loader2 className={cn(c, 'animate-spin text-[var(--blue)]')} />
  if (status === 'waiting_human') return <MessageSquare className={cn(c, 'text-[var(--amber)]')} />
  if (status === 'awaiting_approval') return <Flag className={cn(c, 'text-purple-300')} />
  if (status === 'rework') return <CornerUpLeft className={cn(c, 'text-orange-500')} />
  if (status === 'failed') return <X className={cn(c, 'text-[var(--red)]')} />
  if (status === 'paused') return <Pause className={cn(c, 'text-[var(--amber)]')} />
  if (status === 'cancelled') return <Ban className={cn(c, 'text-muted-foreground')} />
  if (status === 'skipped') return <Minus className={cn(c, 'text-muted-foreground')} />
  return <Hourglass className={cn(c, 'text-muted-foreground')} />
}

const RAG_COLOR: Record<Rag, string> = { green: 'bg-[var(--green)]', amber: 'bg-[var(--amber)]', red: 'bg-[var(--red)]' }

export function RagDot({ rag, reasons, label }: { rag?: Rag; reasons?: string[]; label?: boolean }) {
  if (!rag) return null
  return (
    <span className="inline-flex items-center gap-1.5" title={(reasons || []).join('\n') || 'no problems'}>
      <span className={cn('inline-block size-2.5 rounded-full', RAG_COLOR[rag])} />
      {label && <span className="text-[12px] font-semibold uppercase">{rag}</span>}
    </span>
  )
}

export function LaneTag({ lane }: { lane: Lane }) {
  return (
    <span
      className={cn(
        'rounded px-1 text-[9px] font-semibold uppercase tracking-wider',
        lane === 'pm' ? 'bg-purple-500/15 text-purple-300' : 'bg-[rgba(77,141,255,0.12)] text-[var(--blue)]',
      )}
      title={lane === 'pm' ? 'Project manager step' : 'Developer step'}
    >
      {lane}
    </span>
  )
}

export function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,31,75,0.28)] p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={cn('max-h-[90vh] w-full overflow-y-auto rounded-[18px] border border-[var(--line2)] bg-[var(--head)] p-5 shadow-[0_30px_80px_rgba(77,141,255,0.2)] backdrop-blur-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="title-navy text-[17px]">{title}</h3>
          <button className="cursor-pointer text-[var(--muted-ink)] hover:text-[var(--blue)]" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Label({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block text-[12px] font-semibold text-[var(--muted-ink)]', className)}>
      {text}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const NAV: [string, string][] = [
  ['', 'Projects'],
  ['admin', 'Admin'],
]

/** The top bar every page shares: where you are, who you are, what needs you. */
export function TopBar({ here }: { here: string }) {
  const { user, openMode } = useMe()
  return (
    <div className="glass relative z-10 mx-3 mt-3 flex items-center gap-1 px-4 py-2 text-[13px]">
      <button className="mr-4 cursor-pointer text-[17px] font-extrabold tracking-tight text-[var(--navy)]" onClick={() => go('')}>AI DLC</button>
      {NAV.map(([path, label]) => (
        <button
          key={path}
          onClick={() => go(path)}
          className={cn(
            'cursor-pointer rounded-xl px-3.5 py-1.5 font-semibold',
            here === path.split('/')[0] ? 'bg-[var(--head)] font-bold text-[var(--blue)] shadow-[0_4px_12px_rgba(77,141,255,0.12)]' : 'text-[var(--ink)] hover:text-[var(--blue)]',
          )}
        >
          {label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-3">
        <Bell_ />
        {user && (
          <span className="text-[12px] text-[var(--muted-ink)]" title={openMode ? 'Open mode: no users exist, everyone is admin' : user.email}>
            {user.name} · {user.role}
            {!openMode && (
              <button
                className="ml-2 cursor-pointer underline-offset-2 hover:underline"
                onClick={() => {
                  setToken('')
                  window.location.reload()
                }}
              >
                sign out
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function Bell_() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ unread: number; items: Notice[] }>({ unread: 0, items: [] })
  const load = useCallback(() => {
    api
      .get<{ unread: number; items: Notice[] }>('/notifications')
      .then(setData)
      .catch(() => {
        /* the next tick tries again */
      })
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])
  return (
    <div className="relative">
      <button className="relative cursor-pointer rounded-xl p-1.5 text-[var(--muted-ink)] hover:bg-[rgba(77,141,255,0.08)] hover:text-[var(--blue)]" onClick={() => setOpen((o) => !o)} title="Notifications">
        <Bell className="size-4" />
        {data.unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[var(--red)] px-1 text-[10px] font-semibold text-white">
            {data.unread > 99 ? '99+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-[420px] overflow-y-auto rounded-[18px] border border-[var(--line2)] bg-[var(--head)] shadow-[0_20px_50px_rgba(77,141,255,0.2)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-[rgba(77,141,255,0.08)] px-3 py-2 text-[12px]">
            <b>Notifications</b>
            <button className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => api.post('/notifications/read').then(load)}>
              Mark all read
            </button>
          </div>
          {data.items.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">Nothing yet.</p>}
          {data.items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                api.post('/notifications/read', { ids: [n.id] }).then(load)
                setOpen(false)
                if (n.runId) go(`runs/${n.runId}/steps/${n.stepPos || 1}`)
              }}
              className={cn('block w-full cursor-pointer border-b border-[rgba(77,141,255,0.08)] px-3 py-2 text-left text-[12px] hover:bg-[rgba(77,141,255,0.08)]', !n.read && 'bg-[rgba(77,141,255,0.05)]')}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {!n.read && <span className="size-1.5 rounded-full bg-[var(--blue)]" />}
                <span className={cn(n.level >= 3 ? 'text-[var(--red)]' : n.level === 2 ? 'text-[var(--amber)]' : '')}>{n.kind}</span>
                <span className="ml-auto normal-case">{new Date(n.ts).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 text-foreground/90">{n.text}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Avatar({ name, human }: { name: string; human?: boolean }) {
  const initials = human
    ? name && name !== 'User'
      ? name.slice(0, 2).toUpperCase()
      : 'User'
    : name
        .replace(/agent/i, '')
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 3)
        .toUpperCase() || 'AI'
  return (
    <div
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-full border-2 text-[12px] font-semibold',
        human ? 'border-[var(--line2)] bg-gradient-to-br from-[var(--row)] to-[var(--head)] text-[var(--blue)]' : 'border-[var(--line2)] bg-[var(--row)] text-[var(--navy)]',
      )}
      title={name}
    >
      {initials}
    </div>
  )
}
