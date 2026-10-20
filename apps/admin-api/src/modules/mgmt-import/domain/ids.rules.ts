// I1 · khoá idempotent của importer mgmt-app: mọi hàng đích có id uuid v5 TẤT ĐỊNH từ (nguồn, loại, id mgmt) ⇒ chạy lại
// cùng nguồn ⇒ cùng id ⇒ `ON CONFLICT DO NOTHING` (không nhân đôi, chạy tiếp được sau khi đứt giữa chừng). Thuần: SHA-1 viết
// tay (lớp domain không import `node:crypto` — review C, luật ca-domain-builtin-only / rules-must-be-pure).

/** Namespace riêng của I1 (uuid v4 cố định, sinh một lần). */
export const I1_NAMESPACE = "5d0c6f0e-8f39-4c39-9a51-4a1f3f7e2b10";

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

/** Đệm theo FIPS 180-4: 0x80, 0…, độ dài bit 64-bit big-endian. */
function pad(msg: Uint8Array): DataView {
  const len = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 8, Math.floor((msg.length * 8) / 2 ** 32));
  view.setUint32(len - 4, (msg.length * 8) >>> 0);
  return view;
}

/** Hàm f và hằng k của vòng `i` (4 nhóm 20 vòng). */
function fk(i: number, b: number, c: number, d: number): [number, number] {
  if (i < 20) return [(b & c) | (~b & d), 0x5a827999];
  if (i < 40) return [b ^ c ^ d, 0x6ed9eba1];
  if (i < 60) return [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
  return [b ^ c ^ d, 0xca62c1d6];
}

function round(h: number[], w: number[]): void {
  let [a, b, c, d, e] = h as [number, number, number, number, number];
  for (let i = 0; i < 80; i++) {
    const [f, k] = fk(i, b, c, d);
    const t = (rotl(a, 5) + f + e + k + (w[i] as number)) | 0;
    [e, d, c, b, a] = [d, c, rotl(b, 30), a, t];
  }
  for (const [i, v] of [a, b, c, d, e].entries()) h[i] = ((h[i] as number) + v) | 0;
}

/** SHA-1 (FIPS 180-4) ⇒ 20 byte. */
export function sha1(msg: Uint8Array): Uint8Array {
  const view = pad(msg);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++)
      w[i] = rotl(
        (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number),
        1,
      );
    round(h, w);
  }
  const out = new DataView(new ArrayBuffer(20));
  for (const [i, v] of h.entries()) out.setUint32(i * 4, v >>> 0);
  return new Uint8Array(out.buffer);
}

const hexOf = (uuid: string): Uint8Array =>
  Uint8Array.from((uuid.replace(/-/g, "").match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** uuid v5 (RFC 9562 §5.5) của `name` trong `ns`. */
export function uuidV5(name: string, ns: string = I1_NAMESPACE): string {
  const nb = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nb.length);
  input.set(hexOf(ns));
  input.set(nb, 16);
  const b = sha1(input).subarray(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const s = toHex(b);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Id đích của bản ghi mgmt `(kind, mgmtId)` trong nguồn `source` (vd `mgmt-prod`). */
export const targetId = (source: string, kind: string, mgmtId: string): string =>
  uuidV5(`${source}\u0000${kind}\u0000${mgmtId}`);
