// CR-181 · s9 · luật thuần «ký trên tài liệu» theo lượt chạy: ai đang có lượt ký (BR-D1), bước Ký `ondoc` (Q1/Q2, BR-D3/C4),
// quy trình có bước ký trên tài liệu (BR-T2, Q3), lý do chặn Gửi duyệt (BR-C3). Không I/O.
import { ESIGN_NODE_ONDOC, type SignReadinessOut } from "@ai/contracts/pack-contracts";
import { signPartnerOf } from "./event-flow-steps.rules";
import type { SignTurn } from "./sign-turn.port";

export type OndocSigner = { kind: "user" | "group"; id: string };
/** Bước đang mở của lượt (đọc từ engine qua cổng lắp ráp). */
export type OpenSignStep = {
  runId: string;
  idx: number;
  stages: readonly unknown[];
  task: {
    userIds: readonly string[];
    groupId: string | null;
    escalatedGroupId: string | null;
    claimedBy: string | null;
    need: string | null;
  } | null;
  myGroups: readonly string[];
};

type St = {
  executor?: { kind?: unknown; tool_key?: unknown; event?: unknown } | null;
  after?: { kind?: unknown; evidence?: unknown; also_group_ids?: unknown } | null;
};
const asSt = (x: unknown): St => (typeof x === "object" && x !== null ? (x as St) : {});
/** Bước duyệt = khối Duyệt (`approve`) hoặc stage có cổng duyệt sau (`after.kind = review`, như engine đọc `evidenceModeOf`). */
const isReview = (s: St) => s.executor?.kind === "approve" || s.after?.kind === "review";
const isEvidenceReview = (s: St) => isReview(s) && s.after?.evidence === "opinion_plus";
const isSignWait = (s: St) =>
  s.executor?.kind === "wait_event" && s.executor.event === "esign.completed";

/** Người ký công ty của stage tool Ký số nếu «Ký qua» = `ondoc`; khác ⇒ null. */
export function ondocSignersOf(stage: unknown): OndocSigner[] | null {
  const e = signPartnerOf([stage]).esign;
  return e && e.provider === ESIGN_NODE_ONDOC ? e.signers : null;
}

/** Bước `idx` thuộc bước Ký `ondoc` (chính stage tool, hoặc stage chờ `esign.completed` ngay sau tool gần nhất) ⇒ người ký; khác ⇒ null. */
export function ondocStepAt(stages: readonly unknown[], idx: number): OndocSigner[] | null {
  const cur = stages[idx];
  const own = ondocSignersOf(cur);
  if (own) return own;
  if (!isSignWait(asSt(cur))) return null;
  for (let j = idx - 1; j >= 0; j--) {
    const s = asSt(stages[j]);
    if (s.executor?.kind === "tool" && s.executor.tool_key === "contracts-esign-send")
      return ondocSignersOf(stages[j]);
  }
  return null;
}

/** Người ký công ty của bước Ký `ondoc` đầu tiên trong quy trình (rỗng ⇒ không có). */
export const ondocSignersIn = (stages: readonly unknown[]): OndocSigner[] =>
  stages.map(ondocSignersOf).find((s) => s !== null) ?? [];

/** BR-T2 · Q3 · quy trình có bước ký trên tài liệu: bước Ký `ondoc` hoặc bước duyệt «ý kiến + chữ ký/tệp». */
export const needsOnDoc = (stages: readonly unknown[]): boolean =>
  stages.some((s) => ondocSignersOf(s) !== null || isEvidenceReview(asSt(s)));

/** Khoá người ký như `signerKey` của chỗ ký (`user:<id>` / `group:<id>`). */
export const ondocKeys = (signers: readonly OndocSigner[]): string[] =>
  signers.map((s) => `${s.kind}:${s.id.toLowerCase()}`);

const strs = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

/**
 * BR-D1 · lượt ký của `userId` theo bước đang mở: bước duyệt có bằng chứng + người được giao / đã nhận / thuộc Group duyệt, chuyển cấp
 * hoặc «cũng quyết» (Toàn quyền) ⇒ `approve`; bước Ký `ondoc` + người ký công ty (user, hoặc thành viên Group) ⇒ `sign`; còn lại ⇒ không.
 */
export function signTurnOf(s: OpenSignStep | null, userId: string): SignTurn {
  if (!s) return { allowed: false, reason: "NO_OPEN_STEP" };
  const st = asSt(s.stages[s.idx]);
  const mine = new Set(s.myGroups);
  if (isReview(st)) {
    if (!isEvidenceReview(st)) return { allowed: false, reason: "STEP_NO_SIGN" };
    const t = s.task;
    if (!t) return { allowed: false, reason: "NO_OPEN_STEP" };
    if (t.need === "one" && t.claimedBy && t.claimedBy !== userId)
      return { allowed: false, reason: "CLAIMED_BY_OTHER" };
    const groups = [t.groupId, t.escalatedGroupId, ...strs(st.after?.also_group_ids)];
    const ok =
      t.userIds.includes(userId) ||
      t.claimedBy === userId ||
      groups.some((g) => !!g && mine.has(g));
    return ok
      ? { allowed: true, step: "approve", run_id: s.runId }
      : { allowed: false, reason: "NOT_ASSIGNED" };
  }
  const signers = ondocStepAt(s.stages, s.idx);
  if (!signers) return { allowed: false, reason: "NO_SIGN_STEP" };
  const ok = signers.some((x) => (x.kind === "user" ? x.id === userId : mine.has(x.id)));
  return ok
    ? { allowed: true, step: "sign", run_id: s.runId }
    : { allowed: false, reason: "NOT_SIGNER" };
}

/** BR-T2 / BR-C3 · lý do chặn Gửi duyệt từ `signReadiness` (null ⇒ đủ). */
export function signBlockOf(r: SignReadinessOut): "sign_no_files" | "sign_missing_fields" | null {
  if (r.ready) return null;
  return r.missing.some((m) => m.code === "NO_SIGN_FILE") ? "sign_no_files" : "sign_missing_fields";
}

/** BR-D3 / BR-C4 / Q6 · bước Ký xong khi có ≥ 1 chỗ ký Bên A của người ký công ty và tất cả đã ký (Bên B không tính). */
export const ondocDone = (c: { total: number; open: number }): boolean =>
  c.total > 0 && c.open === 0;
