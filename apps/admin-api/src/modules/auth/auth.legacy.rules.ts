// N5B-FR-02, N5B-FR-04 · luật thuần cho hash legacy (scrypt mgmt-app do importer N5 lưu) — spec N5b §2, §7.
// Dạng lưu: `$scrypt-legacy$ln=<log2 N>,r=<r>,p=<p>$<salt hex>$<dk hex 64 byte>`. Không I/O, không node:*.

export const LEGACY_PREFIX = "$scrypt-legacy$";
/** Hạn chót nhận hash legacy (6 tháng sau go-live N5); env `LEGACY_HASH_SUNSET` ghi đè. 00:00 UTC. */
export const DEFAULT_LEGACY_SUNSET = new Date("2027-04-19T00:00:00.000Z");

const MAX_LN = 17;
const MAX_R = 8;
const MAX_P = 2;
const SLACK = 1024 * 1024;
const memOf = (n: number, r: number, p: number) => 128 * n * r + 128 * r * p + SLACK;
/** Trần bộ nhớ một lần verify (≈ 129 MiB ở ln=17,r=8,p=2) — chặn DoS bằng hash tham số lớn. */
export const LEGACY_MAXMEM = memOf(2 ** MAX_LN, MAX_R, MAX_P);

/** Tham số chặt: số không có 0 đầu, salt 8..64 byte, dk đúng 64 byte, hex thường. */
const LEGACY_RE =
  /^\$scrypt-legacy\$ln=([1-9]\d?),r=([1-9]\d?),p=([1-9]\d?)\$((?:[0-9a-f]{2}){8,64})\$([0-9a-f]{128})$/;

export type LegacyParams = {
  N: number;
  r: number;
  p: number;
  saltHex: string;
  dkHex: string;
  maxmem: number;
};

export const isLegacyHash = (h: string): boolean => h.startsWith(LEGACY_PREFIX);

/** null khi hỏng hoặc vượt trần (`ln ≤ 17`, `r ≤ 8`, `p ≤ 2`, `maxmem ≤ LEGACY_MAXMEM`). */
export function parseLegacyHash(h: string): LegacyParams | null {
  const m = LEGACY_RE.exec(h);
  if (!m) return null;
  const [ln, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ln > MAX_LN || r > MAX_R || p > MAX_P) return null;
  const N = 2 ** ln;
  const maxmem = memOf(N, r, p);
  if (maxmem > LEGACY_MAXMEM) return null;
  return { N, r, p, saltHex: m[4] as string, dkHex: m[5] as string, maxmem };
}

/** Legacy còn được nhận khi `now < sunset`. */
export const legacyActive = (now: Date, sunset: Date): boolean => now.getTime() < sunset.getTime();
