// gap-a1 · use case trang chi tiết HĐ (lớp 2): lịch sử, giao người phụ trách, sửa hoa hồng %, tóm tắt bằng AI. Quyền `write` do route
// chặn trước; ở đây chỉ luật nghiệp vụ. AI gọi NGOÀI tx (không giữ khoá trong lúc chờ model).
import type { AiSummary, HistoryItem } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  buildSummaryPrompt,
  parseSummary,
  SUMMARY_FEATURE,
  SUMMARY_MAX_TOKENS,
} from "../domain/summary-prompt.rules";
import type { AiComplete } from "./ai.ports";

export type SummarySource = {
  status: string;
  title: string;
  text: string | null;
  hasSummary: boolean;
};
export type CommissionLock = {
  version: number;
  updated_at: string;
  deal: string | null;
  status: string;
  commission_pct: number | null;
  /** CR-097 K1 · HĐ đã khoá ⇒ hoa hồng (điều khoản tiền) chỉ đọc. Vắng (fake cũ) ⇒ chưa khoá. */
  locked?: boolean;
};

export type ManageRepo = {
  history(id: string, limit: number): Promise<HistoryItem[] | null>;
  setOwner(
    id: string,
    owner: string | null,
    actor: string,
  ): Promise<{ kind: "ok" } | { kind: "not_found" }>;
  lockCommission(id: string): Promise<CommissionLock | null>;
  saveCommission(
    id: string,
    expected: number,
    from: number | null,
    to: number | null,
    actor: string,
  ): Promise<{ version: number; updated_at: string }>;
  summarySource(id: string): Promise<SummarySource | null>;
  saveSummary(id: string, summary: AiSummary, actor: string): Promise<boolean>;
};
export type ManageUow = PackUow<{ manage: ManageRepo }>;

/** Trạng thái HĐ chưa/không còn đọc xong ⇒ không sửa hoa hồng / không tóm tắt. */
const UNREADY = new Set(["extracting", "extract_failed"]);

export type OwnerResult = { kind: "ok" } | { kind: "not_found" } | { kind: "owner_invalid" };
export type AssignOwner = (who: PackWho, id: string, owner: string | null) => Promise<OwnerResult>;
export const assignOwner =
  (d: {
    uow: ManageUow;
    assignable: (who: PackWho, userId: string) => Promise<boolean>;
  }): AssignOwner =>
  async (who, id, owner) => {
    if (owner !== null && !(await d.assignable(who, owner))) return { kind: "owner_invalid" };
    return d.uow.tenant(who, (r) => r.manage.setOwner(id, owner, who.userId));
  };

export type CommissionResult =
  | { kind: "ok"; version: number; commission_pct: number | null }
  | { kind: "not_found" }
  | { kind: "not_allowed" }
  | { kind: "locked" }
  | { kind: "stale"; current: { version: number }; updated_at: string };
export type EditCommission = (
  who: PackWho,
  id: string,
  input: { version: number; commission_pct: number | null },
) => Promise<CommissionResult>;
export const editCommission =
  (d: { uow: ManageUow }): EditCommission =>
  (who, id, input) =>
    d.uow.tenant(who, async (r): Promise<CommissionResult> => {
      const c = await r.manage.lockCommission(id);
      if (!c) return { kind: "not_found" };
      if (c.deal !== "referral" || UNREADY.has(c.status)) return { kind: "not_allowed" };
      if (c.locked === true) return { kind: "locked" };
      if (c.version !== input.version)
        return { kind: "stale", current: { version: c.version }, updated_at: c.updated_at };
      const s = await r.manage.saveCommission(
        id,
        c.version,
        c.commission_pct,
        input.commission_pct,
        who.userId,
      );
      return { kind: "ok", version: s.version, commission_pct: input.commission_pct };
    });

export type SummaryResult =
  | { kind: "ok"; summary: AiSummary }
  | { kind: "not_found" }
  | { kind: "not_allowed" }
  | { kind: "ai_cap" }
  | { kind: "unavailable" };
export type Summarize = (who: PackWho, id: string) => Promise<SummaryResult>;

/** Một lời gọi model (usage + trần token do AI client chung ghi/chặn) → tóm tắt đã parse strict, hoặc kết quả lỗi. */
async function ask(
  d: { ai: AiComplete; model: string; timeoutMs?: number },
  who: PackWho,
  p: { system: string; prompt: string },
): Promise<AiSummary | { kind: "ai_cap" | "unavailable" }> {
  const out = await d.ai.complete({
    tenantId: who.tenantId,
    userId: who.userId,
    feature: SUMMARY_FEATURE,
    model: d.model,
    system: p.system,
    prompt: p.prompt,
    maxTokens: SUMMARY_MAX_TOKENS,
    signal: AbortSignal.timeout(d.timeoutMs ?? 120_000),
  });
  if (!out.ok) return { kind: out.code === "CAP_EXCEEDED" ? "ai_cap" : "unavailable" };
  return parseSummary(out.text) ?? { kind: "unavailable" };
}
export const summarize =
  (d: {
    uow: ManageUow;
    ai: AiComplete;
    model: string;
    nonce?: () => string;
    timeoutMs?: number;
  }): Summarize =>
  async (who, id) => {
    const src = await d.uow.tenant(who, (r) => r.manage.summarySource(id));
    if (!src) return { kind: "not_found" };
    if (src.hasSummary || UNREADY.has(src.status) || !src.text?.trim())
      return { kind: "not_allowed" };
    const p = buildSummaryPrompt({
      text: src.text,
      title: src.title,
      nonce: (d.nonce ?? (() => crypto.randomUUID().replace(/-/g, "")))(),
    });
    const summary = await ask(d, who, p);
    if ("kind" in summary) return summary;
    const saved = await d.uow.tenant(who, (r) => r.manage.saveSummary(id, summary, who.userId));
    // Có người khác vừa tạo tóm tắt trong lúc chờ AI ⇒ giữ bản đó.
    return saved ? { kind: "ok", summary } : { kind: "not_allowed" };
  };

export type GetHistory = (who: PackWho, id: string, limit: number) => Promise<HistoryItem[] | null>;
export const getHistory =
  (d: { uow: ManageUow }): GetHistory =>
  (who, id, limit) =>
    d.uow.tenant(who, (r) => r.manage.history(id, limit));
