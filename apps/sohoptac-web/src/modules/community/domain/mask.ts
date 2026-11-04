// D4 · dò + che liên hệ (SĐT, email, link, MST, tên công ty khác). Chỉ dùng trong adapter mock; C3 cài thật ở server.
import type { ContentHit } from "@ai/contracts/community";

type Kind = ContentHit["kind"];
const PATTERNS: [Kind, RegExp][] = [
  ["taxId", /(?:MST|mã số thuế)[:\s]*\d{10}(?:-\d{3})?/gi],
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["link", /(?:https?:\/\/|www\.|zalo\.me\/|fb\.com\/|facebook\.com\/)\S+/gi],
  ["phone", /(?<![\d])(?:\+?84|0)(?:[ .-]?\d){8,10}(?!\d)/g],
];

export type MaskContext = { ownOrgName: string; otherOrgNames: string[] };

/** Khoảng bị che trong `text` (không chồng nhau, sắp tăng). Tên công ty của chính đối tác không che. */
export function detectHits(
  text: string,
  field: ContentHit["field"],
  ctx: MaskContext,
): ContentHit[] {
  const raw: ContentHit[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      raw.push({ field, kind, start: m.index, end: m.index + m[0].length });
    }
  }
  const lower = text.toLowerCase();
  for (const name of ctx.otherOrgNames) {
    if (!name || name.toLowerCase() === ctx.ownOrgName.toLowerCase()) continue;
    const n = name.toLowerCase();
    for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, i + n.length)) {
      raw.push({ field, kind: "company", start: i, end: i + n.length });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ContentHit[] = [];
  for (const h of raw) {
    const last = out[out.length - 1];
    if (!last || h.start >= last.end) out.push(h);
  }
  return out;
}

const MASK_TEXT: Record<Kind, string> = {
  phone: "[SỐ ĐIỆN THOẠI]",
  email: "[EMAIL]",
  link: "[LIÊN KẾT]",
  taxId: "[MÃ SỐ THUẾ]",
  company: "[TÊN CÔNG TY]",
};

export function applyMask(text: string, hits: ContentHit[]): string {
  let out = "";
  let pos = 0;
  for (const h of hits) {
    out += text.slice(pos, h.start) + MASK_TEXT[h.kind];
    pos = h.end;
  }
  return out + text.slice(pos);
}
