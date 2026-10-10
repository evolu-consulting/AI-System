// HUB-FR-114 · HUB-FR-110 · D7 · D8 · PF1 · luật nhóm agent (plan §1 D7/D8, plan-contract §7).
// Thuần: kế hoạch trưởng nhóm, ghép mục theo sở hữu, render theo template, tóm tắt cắt cứng, chọn thành viên làm lại,
// gộp câu hỏi khi song song. Mục = heading cấp 2 (`## <tên>`, so không phân biệt hoa thường + trim). Không log nội dung.

export type TeamMember = { key: string; sections: readonly string[] };
export type LeadStep = { member: string; sections: string[]; instruction: string };
export type LeadPlan =
  | { ok: true; steps: LeadStep[] }
  | { ok: false; reason: "json" | "empty" | "too_many" | "unknown_member" };

const HEADING = /^##(?!#)\s*(.+?)\s*$/;
const norm = (s: string): string => s.trim().toLowerCase();

/** Mục `## <tên>` của văn bản thành viên (theo thứ tự, thân trim). */
function parseSections(md: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ name: cur.name, body: cur.lines.join("\n").trim() });
  };
  for (const line of md.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      cur = { name: m[1] ?? "", lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  flush();
  return out;
}

/** D7 · kế hoạch trưởng nhóm: mảng JSON `{member, sections, instruction}`; ≤ `maxSteps` bước, member hợp lệ. */
export function parseLeadPlan(
  raw: string,
  members: readonly TeamMember[],
  maxSteps: number,
): LeadPlan {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "json" };
  }
  if (!Array.isArray(arr)) return { ok: false, reason: "json" };
  if (arr.length === 0) return { ok: false, reason: "empty" };
  if (arr.length > maxSteps) return { ok: false, reason: "too_many" };
  const keys = new Set(members.map((m) => m.key));
  const steps: LeadStep[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: "json" };
    const s = raw as Record<string, unknown>;
    if (typeof s.member !== "string" || !keys.has(s.member))
      return { ok: false, reason: "unknown_member" };
    steps.push({
      member: s.member,
      sections: Array.isArray(s.sections) ? s.sections.map(String) : [],
      instruction: typeof s.instruction === "string" ? s.instruction : "",
    });
  }
  return { ok: true, steps };
}

/** D7 · ghép mục thành viên vào bản hiện tại: chỉ mục sở hữu; mục lạ ⇒ `foreign`, giữ bản cũ. `changed` = có đổi. */
export function assembleSections(
  current: ReadonlyMap<string, string>,
  memberMd: string,
  owned: readonly string[],
): { next: Map<string, string>; changed: boolean; foreign: string[] } {
  const next = new Map(current);
  const ownedByNorm = new Map(owned.map((o) => [norm(o), o]));
  const foreign: string[] = [];
  let changed = false;
  for (const { name, body } of parseSections(memberMd)) {
    const canon = ownedByNorm.get(norm(name));
    if (!canon) {
      foreign.push(name);
      continue;
    }
    if (next.get(canon) !== body) {
      next.set(canon, body);
      changed = true;
    }
  }
  return { next, changed, foreign };
}

/** D7 · render tài liệu theo thứ tự mục của template (bỏ qua mục không có nội dung map). */
export function renderDoc(template: string, sections: ReadonlyMap<string, string>): string {
  const byNorm = new Map<string, string>();
  for (const [k, v] of sections) byNorm.set(norm(k), v);
  const parts: string[] = [];
  for (const { name } of parseSections(template)) {
    const body = byNorm.get(norm(name)) ?? "";
    parts.push(`## ${name}\n${body}`.trimEnd());
  }
  return `${parts.join("\n\n")}\n`;
}

/** D7 · tóm tắt thành viên cắt cứng ≈ 4 ký tự/token. */
export function clipSummary(text: string, maxTokens: number): string {
  const max = maxTokens * 4;
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** D8 · thành viên làm lại: theo `sections` người duyệt; vắng ⇒ tên mục xuất hiện trong góp ý; không khớp ⇒ cả nhóm. */
export function redoMembers(
  members: readonly TeamMember[],
  q: { sections?: readonly string[]; feedback: string },
): string[] {
  if (q.sections && q.sections.length > 0) {
    const want = new Set(q.sections.map(norm));
    const hit = members.filter((m) => m.sections.some((s) => want.has(norm(s))));
    if (hit.length > 0) return hit.map((m) => m.key);
  }
  const fb = q.feedback.toLowerCase();
  const byFeedback = members.filter((m) => m.sections.some((s) => fb.includes(norm(s))));
  if (byFeedback.length > 0) return byFeedback.map((m) => m.key);
  return members.map((m) => m.key);
}

/** HUB-FR-110 · gộp nhiều câu hỏi (nhóm song song) thành một câu kèm vai; `choices` gộp rỗng (trả văn bản). */
export function mergeQuestions(qs: readonly { member: string; role: string; question: string }[]): {
  question: string;
  choices: string[];
} {
  const question = qs.map((q) => `[${q.role}] ${q.question}`).join("\n");
  return { question, choices: [] };
}
