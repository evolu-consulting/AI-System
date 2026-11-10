// Luật thuần cho góp ý từ bản mẫu: phiên bản (băm), lược đồ file góp ý, kiểm bản cũ, đoạn «Quyết định từ bản mẫu».
import { z } from "zod";
import type { Prototype } from "./schema";

/** Băm FNV-1a 32 bit của nội dung đã chuẩn hoá → 8 ký tự hex. Đổi nội dung bản mẫu ⇒ đổi phiên bản. */
export function protoVersion(p: Prototype): string {
  const s = JSON.stringify(p);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const protoId = (p: Prototype): string =>
  p.id ??
  p.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const feedbackSchema = z.object({
  prototype: z.object({ id: z.string(), title: z.string(), version: z.string().min(1) }),
  exportedAt: z.string(),
  answers: z.array(z.object({ id: z.string(), question: z.string(), answer: z.string() })),
  unanswered: z.array(z.object({ id: z.string(), question: z.string() })).default([]),
  screens: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      verdict: z.enum(["ok", "fix", "none"]),
      note: z.string().default(""),
    }),
  ),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** Lỗi nếu góp ý xuất từ phiên bản khác bản mẫu hiện tại. */
export function staleError(fb: Feedback, p: Prototype): string | null {
  const now = protoVersion(p);
  return fb.prototype.version === now
    ? null
    : `Góp ý cũ: xuất từ bản mẫu phiên bản ${fb.prototype.version}, bản mẫu hiện tại là ${now}. Cho người duyệt xem lại bản mới rồi xuất lại.`;
}

const list = (xs: string[]): string[] => (xs.length ? xs : ["- (không có)"]);

/** Đoạn markdown nối vào spec.md/tasks.md. Có dấu để không nối hai lần cùng một góp ý. */
export function marker(fb: Feedback): string {
  return `<!-- bản-mẫu-góp-ý:${fb.prototype.version}:${fb.exportedAt} -->`;
}

export function decisionSection(fb: Feedback, date: string): string {
  const fix = fb.screens.filter((s) => s.verdict === "fix");
  const ok = fb.screens.filter((s) => s.verdict === "ok");
  const noteOnly = fb.screens.filter((s) => s.verdict === "none" && s.note);
  const lines = [
    `## Quyết định từ bản mẫu (${date})`,
    marker(fb),
    `Bản mẫu «${fb.prototype.title}», phiên bản ${fb.prototype.version}.`,
    "",
    "### Câu đã chốt",
    ...list(fb.answers.map((a) => `- ${a.question} → **${a.answer}**`)),
    "",
    "### Câu chưa chốt",
    ...list(fb.unanswered.map((a) => `- ${a.question}`)),
    "",
    "### Màn hình cần sửa",
    ...list(fix.map((s) => `- «${s.title}»${s.note ? `: ${s.note}` : ""}`)),
  ];
  if (noteOnly.length)
    lines.push("", "### Ghi chú thêm", ...noteOnly.map((s) => `- «${s.title}»: ${s.note}`));
  lines.push("", "### Màn hình đúng ý", ...list(ok.map((s) => `- «${s.title}»`)), "");
  return lines.join("\n");
}

/** Trả về nội dung mới của tệp, hoặc null nếu góp ý này đã được nối rồi. */
export function appendDecision(existing: string, fb: Feedback, date: string): string | null {
  if (existing.includes(marker(fb))) return null;
  const base = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
  return `${base}${base ? "\n" : ""}${decisionSection(fb, date)}`;
}
