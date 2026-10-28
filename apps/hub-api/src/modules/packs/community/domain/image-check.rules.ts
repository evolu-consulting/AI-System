// COM-C11a · nghiep-vu §7: luật thuần cho kết quả kiểm ảnh NCC (logo/tên/SĐT in trên ảnh). Không mạng, không DB.
// Trạng thái: clean = đã kiểm, không thấy gì; suspect = có dấu hiệu lộ; unknown = chưa kiểm được (hết giờ/không model/đầu ra hỏng).
// `unknown` KHÔNG chặn: chỉ cảnh báo/không kết luận (lộ là cảnh báo, không chặn — tasks.md C11).
import { type ContactKind, normalizeText, scanContacts } from "./mask.rules";

export type LeakKind = ContactKind | "logo";
export type LeakStatus = "clean" | "suspect" | "unknown";
export type LeakFinding = { kind: LeakKind; text?: string; confidence: number };
export type ImageCheckResult = { status: LeakStatus; findings: LeakFinding[] };
export type ImageCheckContext = { otherCompanies?: readonly string[] };

/** Logo/tên do model nêu dưới ngưỡng này bị bỏ (nhiễu); hit xác định từ scanContacts luôn confidence 1. */
export const MIN_MODEL_CONFIDENCE = 0.5;
const MAX_MODEL_ITEMS = 20;
export const UNKNOWN_RESULT: ImageCheckResult = { status: "unknown", findings: [] };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Lấy JSON đầu ra model (chịu được rào ```json). null nếu không đọc được. */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  const s = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return asRecord(JSON.parse(s.slice(a, b + 1)));
  } catch {
    return null;
  }
}

const items = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.slice(0, MAX_MODEL_ITEMS).flatMap((x) => {
        const r = asRecord(x);
        return r ? [r] : [];
      })
    : [];
const confOf = (r: Record<string, unknown>): number =>
  typeof r.confidence === "number" ? clamp01(r.confidence) : 0;

/** Logo + tên công ty do model phán đoán (qua ngưỡng). */
function modelJudgements(j: Record<string, unknown>): LeakFinding[] {
  const out: LeakFinding[] = [];
  for (const l of items(j.logos)) {
    if (confOf(l) < MIN_MODEL_CONFIDENCE) continue;
    const text = typeof l.description === "string" ? { text: l.description.slice(0, 200) } : {};
    out.push({ kind: "logo", ...text, confidence: confOf(l) });
  }
  for (const co of items(j.companies)) {
    const name = typeof co.name === "string" ? co.name.trim() : "";
    if (confOf(co) < MIN_MODEL_CONFIDENCE || name === "") continue;
    out.push({ kind: "company_name", text: name.slice(0, 200), confidence: confOf(co) });
  }
  return out;
}

/**
 * Đầu ra model dạng `{ text: string, logos: [{description?, confidence}], companies: [{name, confidence}] }`
 * → kết quả. Chữ OCR chạy qua scanContacts (xác định, confidence 1); logo/tên do model phán đoán (có ngưỡng).
 * Đầu ra không đọc được ⇒ unknown.
 */
export function mapModelOutput(raw: string, ctx: ImageCheckContext = {}): ImageCheckResult {
  const j = parseModelJson(raw);
  if (!j || typeof j.text !== "string") return UNKNOWN_RESULT;
  let text: string;
  try {
    text = normalizeText(j.text);
  } catch {
    return UNKNOWN_RESULT; // quá trần độ dài ⇒ không kết luận
  }
  const sc = ctx.otherCompanies ? { otherCompanies: ctx.otherCompanies } : {};
  const findings: LeakFinding[] = scanContacts(text, sc).map((h) => ({
    kind: h.kind,
    text: text.slice(h.start, h.end),
    confidence: 1,
  }));
  findings.push(...modelJudgements(j));
  return { status: findings.length > 0 ? "suspect" : "clean", findings };
}
