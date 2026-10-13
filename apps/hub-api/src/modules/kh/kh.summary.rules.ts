// HUB-FR-133 · K1-AC05 · K1-AC07 · CR-073 · plan K1 §2.5, §3.5 · spec §3.0 (`/vector/add`), §3.4, §4 `snapshot.kh`: luật
// thuần ghi `## Tóm tắt` vào KnowledgeHub — trích + cắt nội dung, subject/id ổn định, body, đích chốt lúc start. Không I/O.
import { KH_BUDGET_CHARS, KH_SUMMARY_SECTION, KH_SUMMARY_WORDS } from "@ai/contracts/hub-admin";
import { normSection, sectionMap } from "../processes/runs/template.rules";

const SUBJECT_MAX = 128;

/** Giữ `n` từ đầu (từ = chuỗi không khoảng trắng), giữ nguyên xuống dòng giữa các từ; trim. */
export function clipWords(s: string, n: number): string {
  let end = 0;
  let count = 0;
  for (const m of s.matchAll(/\S+/g)) {
    if (count >= n) break;
    end = (m.index ?? 0) + m[0].length;
    count++;
  }
  return s.slice(0, end).trim();
}

/** Mục `## Tóm tắt` (heading cấp 2, so như kiểm template) ⇒ ≤ 200 từ ⇒ ≤ 4000 ký tự; không có / rỗng ⇒ null. */
export function summaryForWorklog(content: string): string | null {
  const body = sectionMap(content).get(normSection(KH_SUMMARY_SECTION));
  if (body === undefined || body.trim() === "") return null;
  const text = clipWords(body, KH_SUMMARY_WORDS).slice(0, KH_BUDGET_CHARS).trim();
  return text === "" ? null : text;
}

/** `<process.key>/<stage.key>` cắt 128. */
export function worklogSubject(processKey: string, stageKey: string): string {
  return `${processKey}/${stageKey}`.slice(0, SUBJECT_MAX);
}

/** Q32 · id cố định ⇒ ghi lại = ghi đè (idempotent). */
export function worklogVectorId(
  processRunId: string,
  stageRunId: string,
  outputVersion: number,
): string {
  return `kw-${processRunId}-${stageRunId}-v${outputVersion}`;
}

/** Body `POST /vector/add` (spec §3.0). */
export function khWorklogBody(w: {
  id: string;
  project: string;
  subject: string;
  text: string;
  ts: string;
}): Record<string, unknown> {
  return {
    id: w.id,
    text: w.text,
    scope: "log",
    metadata: {
      scope: "log",
      project: w.project,
      subject: w.subject,
      topic: w.subject,
      ts: w.ts,
      source: "ai-hub",
    },
  };
}

/** Thêm "Tóm tắt" vào `required_sections` khi `needed` (không trùng, so chuẩn hoá). */
export function ensureSummary(required: readonly string[], needed: boolean): string[] {
  const has = required.some((r) => normSection(r) === normSection(KH_SUMMARY_SECTION));
  return needed && !has ? [...required, KH_SUMMARY_SECTION] : [...required];
}

export type SnapshotKhStage = { connection_id: string; name: string; project: string } | null;

/** Q8 · `targets[i]` buộc null khi stage không phải executor `agent` đơn; mọi phần tử null ⇒ null (không `snapshot.kh`). */
export function planKhSnapshot(
  stages: readonly { executor: { kind: string } }[],
  targets: readonly SnapshotKhStage[],
): { stages: SnapshotKhStage[] } | null {
  const out = stages.map((s, i) => (s.executor.kind === "agent" ? (targets[i] ?? null) : null));
  return out.some((t) => t !== null) ? { stages: out } : null;
}

/** Bộ gửi: có đích ∧ kết nối còn dùng được lúc gửi (sai ⇒ `skipped`). */
export function shouldWriteSummary(
  st: SnapshotKhStage,
  live: { connectionUsable: boolean },
): boolean {
  return st !== null && live.connectionUsable;
}
