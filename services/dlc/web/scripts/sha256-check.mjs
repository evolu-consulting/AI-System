// Checks the PKCE SHA-256 fallback in src/lib/oidc.ts against Node's crypto (run: node scripts/sha256-check.mjs).
import { createHash, randomBytes } from 'node:crypto'
const { sha256 } = await import('../src/lib/oidc.ts')
let bad = 0
const cases = [Buffer.from(''), Buffer.from('abc'), Buffer.alloc(55, 1), Buffer.alloc(56, 2), Buffer.alloc(64, 3), Buffer.alloc(1000, 7)]
for (let i = 0; i < 50; i++) cases.push(randomBytes(i * 13))
for (const c of cases) {
  const a = Buffer.from(sha256(new Uint8Array(c))).toString('hex')
  const b = createHash('sha256').update(c).digest('hex')
  if (a !== b) { bad++; console.error('mismatch len', c.length) }
}
console.log(bad ? `FAIL ${bad}` : `ok ${cases.length} cases`)
process.exit(bad ? 1 : 0)
