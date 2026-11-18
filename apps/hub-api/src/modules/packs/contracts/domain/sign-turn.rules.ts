// CR-181 · s9 · luật thuần «ký trên tài liệu» theo lượt chạy: ai đang có lượt ký (BR-D1), bước Ký `ondoc` (Q1/Q2, BR-D3/C4),
// quy trình có bước ký trên tài liệu (BR-T2, Q3), lý do chặn Gửi duyệt (BR-C3). Không I/O.
import { ESIGN_NODE_ONDOC, type SignReadinessOut } from "@ai/contracts/pack-contracts";
import { signPartnerOf } from "./event-flow-steps.rules";
import type { SignBehalf, SignTurn } from "./sign-turn.port";

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
    /** CR-184 · người gọi có việc này nhờ uỷ quyền `approve` ⇒ id người vắng. */
    behalfOf?: string | null;
  } | null;
  myGroups: readonly string[];
  /** CR-184 · uỷ quyền còn hiệu lực giao cho người gọi (loại + Group của người vắng). */
  delegations?: readonly { userId: string; groups: readonly string[]; kinds: readonly string[] }[];
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
 * CR-184 · người vắng A mà `userId` làm thay ở bước Ký `ondoc`: uỷ quyền còn hiệu lực có loại `esign`, và A là người ký công ty
 * (đích danh, hoặc thành viên Group người ký). Không có loại `esign` ⇒ không có. Bỏ chính mình.
 */
export function behalfOfSigners(
  signers: readonly OndocSigner[],
  delegations: readonly { userId: string; groups: readonly string[]; kinds: readonly string[] }[],
  userId: string,
): SignBehalf[] {
  return delegations
    .filter(
      (d) =>
        d.userId !== userId &&
        d.kinds.includes("esign") &&
        signers.some((x) => (x.kind === "user" ? x.id === d.userId : d.groups.includes(x.id))),
    )
    .map((d) => ({ user_id: d.userId, groups: [...d.groups] }));
}

/**
 * CR-184 · «thay ai» của MỘT bản ký. `direct` = khoá người ký (`user:<id>` / `group:<id>`) mà CHÍNH người gọi có (không tính uỷ quyền).
 * Ô của người gọi tự có ⇒ bỏ qua (ký cho mình); ô của người vắng (đích danh, hoặc qua Group của họ) ⇒ người đó; dấu tự do (không ô) ⇒
 * chỉ khi người gọi không tự là người ký nào ⇒ người vắng đầu tiên; còn lại ⇒ null.
 */
export function onBehalfOfVersion(
  behalf: readonly SignBehalf[],
  fields: readonly { signer_kind: string; signer_ref: string }[],
  direct: ReadonlySet<string>,
): string | null {
  for (const f of fields) {
    const ref = f.signer_ref.toLowerCase();
    if (direct.has(`${f.signer_kind}:${ref}`)) continue;
    const hit =
      f.signer_kind === "user"
        ? behalf.find((b) => b.user_id.toLowerCase() === ref)
        : behalf.find((b) => b.groups.some((g) => g.toLowerCase() === ref));
    if (hit) return hit.user_id;
  }
  return fields.length === 0 && direct.size === 0 ? (behalf[0]?.user_id ?? null) : null;
}

/** Bước duyệt có bằng chứng: người được giao / đã nhận / thuộc Group duyệt, chuyển cấp, «cũng quyết» ⇒ `approve`. */
function approveTurn(s: OpenSignStep, st: St, userId: string): SignTurn {
  if (!isEvidenceReview(st)) return { allowed: false, reason: "STEP_NO_SIGN" };
  const t = s.task;
  if (!t) return { allowed: false, reason: "NO_OPEN_STEP" };
  if (t.need === "one" && t.claimedBy && t.claimedBy !== userId)
    return { allowed: false, reason: "CLAIMED_BY_OTHER" };
  // `after.also_group_ids` = Group «cũng quyết» của stage, là Group «Toàn quyền» của gói: cùng luật `assertMayDecide` /
  // `decidesByOverride` (processes/gates/gates.helpers.ts — «prod-fix2 · Group "cũng quyết" của stage (vd "Toàn quyền" của gói)»).
  const mine = new Set(s.myGroups);
  const groups = [t.groupId, t.escalatedGroupId, ...strs(st.after?.also_group_ids)];
  const ok =
    t.userIds.includes(userId) || t.claimedBy === userId || groups.some((g) => !!g && mine.has(g));
  if (!ok) return { allowed: false, reason: "NOT_ASSIGNED" };
  // CR-184 · việc nhờ uỷ quyền `approve`: B ký bằng chữ ký CỦA B, bản ký/hồ sơ ghi «thay A» (A không bị dùng chữ ký — BR-K2/K3).
  const behalf: SignBehalf[] =
    t.behalfOf && t.behalfOf !== userId ? [{ user_id: t.behalfOf, groups: [] }] : [];
  return { allowed: true, step: "approve", run_id: s.runId, ...(behalf.length ? { behalf } : {}) };
}

/**
 * BR-D1 · lượt ký của `userId` theo bước đang mở: bước duyệt có bằng chứng + người được giao / đã nhận / thuộc Group duyệt, chuyển cấp
 * hoặc «cũng quyết» (Toàn quyền) ⇒ `approve`; bước Ký `ondoc` + người ký công ty (user, hoặc thành viên Group) ⇒ `sign`; còn lại ⇒ không.
 * CR-184: thêm người làm thay nhờ uỷ quyền (`behalf`): `approve` theo hàng giao việc `delegated`, `sign` theo uỷ quyền loại `esign`.
 */
export function signTurnOf(s: OpenSignStep | null, userId: string): SignTurn {
  if (!s) return { allowed: false, reason: "NO_OPEN_STEP" };
  const st = asSt(s.stages[s.idx]);
  if (isReview(st)) return approveTurn(s, st, userId);
  const signers = ondocStepAt(s.stages, s.idx);
  if (!signers) return { allowed: false, reason: "NO_SIGN_STEP" };
  const mine = new Set(s.myGroups);
  const ok = signers.some((x) => (x.kind === "user" ? x.id === userId : mine.has(x.id)));
  const behalf = behalfOfSigners(signers, s.delegations ?? [], userId);
  return ok || behalf.length > 0
    ? { allowed: true, step: "sign", run_id: s.runId, ...(behalf.length ? { behalf } : {}) }
    : { allowed: false, reason: "NOT_SIGNER" };
}

/** BR-T2 / BR-C3 · lý do chặn Gửi duyệt từ `signReadiness` (null ⇒ đủ). */
export function signBlockOf(r: SignReadinessOut): "sign_no_files" | "sign_missing_fields" | null {
  if (r.ready) return null;
  return r.missing.some((m) => m.code === "NO_SIGN_FILE") ? "sign_no_files" : "sign_missing_fields";
}

/** BR-D3 / BR-C4 / Q6 · bước Ký xong khi có ≥ 1 chỗ ký Bên A của người ký công ty và tất cả đã ký (Bên B không tính). */
/** CR-182 · «Đối tác ký»: còn chỗ ký Bên B chưa ký (`b_open`) ⇒ bước Ký CHƯA xong (chờ đối tác). */
export const ondocDone = (c: {
  total: number;
  open: number;
  b_open?: number;
  b_total?: number;
}): boolean => c.total > 0 && c.open === 0 && (c.b_open ?? 0) === 0;
/** Bên A đã ký đủ (không xét Bên B). */
export const ondocADone = (c: { total: number; open: number }): boolean =>
  c.total > 0 && c.open === 0;
