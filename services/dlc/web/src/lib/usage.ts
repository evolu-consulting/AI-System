// Token and money formatting for the usage figures. shortCount is RITA's
// (RITA/src/lib/token-count.ts) so both tools print a count the same way.
import type { Usage } from '@/lib/types'

export function shortCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return round(n / 1000) + 'k'
  return round(n / 1000000) + 'm'
}

/** One decimal while it still says something, none once it does not. */
function round(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return '$' + usd.toFixed(2)
}

export function usageTitle(u: Usage): string {
  return (
    `${u.tokens.toLocaleString()} tokens in ${u.calls} agent calls\n` +
    `input ${u.input.toLocaleString()} · output ${u.output.toLocaleString()}\n` +
    `cache write ${u.cacheWrite.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()}\n` +
    `$${u.costUsd.toFixed(4)} at each model's list price`
  )
}
