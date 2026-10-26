// HD-FR-31 · HD-FR-33 · HD-FR-34 · HD-FR-36 · HD-FR-37 · M3-decouple: flow duyệt HĐ là máy trạng thái của gói (không engine).
// Mở lượt (tải lên / trích lại / nhập tay), xem thẻ duyệt, quyết bước (luật `decide` thuần), cài đặt tenant. Quyết trong MỘT tx
// khoá hàng HĐ (FOR UPDATE) ⇒ `finalize` đánh giá lại ngưỡng trong câu UPDATE (D3-14). Lớp 2: chỉ cổng, lỗi trả mã (route dịch).
import type { ProductLink } from "@ai/contracts";
import type { PackWho } from "../../kit/application/ports";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { RunPhase } from "../domain/approval-edit.rules";
import {
  type ApprovalActor,
  type ApprovalErrorCode,
  approvalView,
  type Decision,
  decide,
  phaseOf,
} from "../domain/approval-machine.rules";
import type { ApprovalState, ApprovalTxRepos, ApprovalUow, OpenOutcome } from "./approval.ports";
import type { EngineCard } from "./approval-engine-card.usecase";

/** Group duyệt: id theo khoá của tenant (thiếu ⇒ vắng) + Group của user (cache cấu hình, 0 SQL khi nóng). */
export type ApprovalGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  userGroups(who: PackWho): Promise<ReadonlySet<string>>;
  /** Quyền gói của user (read/write/admin) — dự phòng khi tenant chưa có Group duyệt. Vắng ⇒ không dự phòng. */
  actionsOf?(who: PackWho): Promise<ReadonlySet<string>>;
};
export type ExtractJob = {
  tenantId: string;
  userId: string;
  contractId: string;
  approvalId: string | null;
};
/** Hàng đợi bền lượt AI đọc (Redis Streams) — gọi SAU commit. */
export type ExtractJobs = { enqueue(job: ExtractJob): Promise<void> };

export type ApprovalDeps = {
  uow: ApprovalUow;
  groups: ApprovalGroups;
  jobs: ExtractJobs;
  /** "Trích lại" (review B #27/#28): AI sẵn sàng + trần thao tác tenant — chỉ áp khi phán quyết thật sự trích lại (sau
   *  kiểm người duyệt/bước/nguồn). `quota` ném 429/503 ⇒ tx ROLLBACK. Vắng ⇒ không kiểm. */
  redo?: { ready: boolean; quota: (tenantId: string) => Promise<void> };
  /** contract-flow S3a · cờ engine bật: lượt vừa vào `level1` (đã COMMIT) ⇒ mở run engine. Vắng ⇒ máy 2 bước cũ. Không ném. */
  engine?: EngineStart;
  /** contract-flow S3b · thẻ + hành động cho lượt `mode = 'engine'`. Vắng ⇒ lượt engine hiện thẻ rỗng, không quyết được. */
  card?: EngineCard;
  /** S3b · cài đặt duyệt đổi (tenant chưa lưu mẫu) ⇒ đồng bộ lại def engine. Không ném. */
  onSettingsSaved?: (who: PackWho) => Promise<unknown>;
};
export type EngineStart = (who: PackWho, contractId: string) => Promise<unknown>;
export type ContractApproval =
  | ReturnType<typeof approvalView>
  | Awaited<ReturnType<NonNullable<ApprovalDeps["card"]>["view"]>>;
/** `products` (products-confirm): gắn/tạo SP cho dòng HĐ — áp TRONG tx chỉ khi bước này làm HĐ thành "đã xác nhận". */
export type ApprovalAction = {
  action: "approve" | "reject" | "redo" | "return";
  feedback?: string;
  products?: readonly ProductLink[];
};
export type ActOutcome =
  | ContractApproval
  | "not_found"
  | "unavailable"
  | { error: ApprovalErrorCode };

/** Mở lượt duyệt; `extracting` ⇒ xếp lượt AI đọc sau commit. */
export function startApproval(d: ApprovalDeps) {
  return async (
    who: PackWho,
    id: string,
    initial: "extracting" | "level1",
  ): Promise<OpenOutcome> => {
    const aid = crypto.randomUUID();
    const out = await d.uow.tenant(who, (r) => r.approval.open(id, aid, who.userId, initial));
    if (out === "ok" && initial === "extracting")
      await d.jobs.enqueue({ ...who, contractId: id, approvalId: aid });
    if (out === "ok" && initial === "level1" && d.engine) await d.engine(who, id);
    return out;
  };
}

const NO_ACTIONS: ReadonlySet<string> = new Set();

/** Người duyệt theo Group cấu hình; Group đó KHÔNG có ở tenant (tenant bật feature tay, chưa có Group vai) ⇒ dựa quyền
 *  gói: cấp 1 = `write`, cấp 2 = `admin`. Group có mà user không thuộc ⇒ không duyệt (không dự phòng). Người duyệt cấp 2
 *  luôn được xác nhận cấp 1 (luật người gửi ở cấp 2 vẫn áp — `decide`). */
export async function approvalActor(
  g: ApprovalGroups,
  who: PackWho,
  s: ApprovalSettings,
): Promise<ApprovalActor> {
  const [ids, mine, acts] = await Promise.all([
    g.idsOf(who.tenantId, [s.level1GroupKey, s.level2GroupKey]),
    g.userGroups(who),
    g.actionsOf ? g.actionsOf(who) : NO_ACTIONS,
  ]);
  const has = (k: string, fallback: "write" | "admin") => {
    const id = ids.get(k);
    return id === undefined ? acts.has(fallback) : mine.has(id);
  };
  // Người dùng 2026-10-23: người duyệt cấp 2 ("Toàn quyền") cũng xác nhận được cấp 1 (không phải vào thêm Group cấp 1).
  const inLevel2 = has(s.level2GroupKey, "admin");
  return { userId: who.userId, inLevel1: has(s.level1GroupKey, "write") || inLevel2, inLevel2 };
}

const actorOf = (d: ApprovalDeps, who: PackWho, s: ApprovalSettings) =>
  approvalActor(d.groups, who, s);

const viewOf = (st: ApprovalState, actor: ApprovalActor) =>
  approvalView(st.approval, actor, { value: st.value, threshold: st.threshold });

const NOBODY = { userId: "", inLevel1: false, inLevel2: false };
async function engineViewOf(
  d: ApprovalDeps,
  who: PackWho,
  st: ApprovalState,
): Promise<ContractApproval> {
  if (d.card) return d.card.view(who, st);
  return { ...approvalView(st.approval, NOBODY), mode: "engine" as const, steps: [] };
}

export function getApproval(d: ApprovalDeps) {
  return async (who: PackWho, id: string): Promise<ContractApproval | null> => {
    const got = await d.uow.tenant(who, async (r) => {
      const st = await r.approval.state(id, { lock: false });
      // S3b · lượt engine: quyền do engine quyết ⇒ không cần cài đặt cấp 1/2 (≤ 1 SQL của gói).
      return { st, s: st && st.approval?.mode !== "engine" ? await r.approval.settings() : null };
    });
    if (!got.st) return null;
    if (got.st.approval?.mode === "engine") return engineViewOf(d, who, got.st);
    return viewOf(got.st, await actorOf(d, who, got.s as ApprovalSettings));
  };
}

/** Áp phán quyết trong tx đang khoá HĐ. `null` ⇒ bước không còn mở (đua). */
async function apply(
  r: ApprovalTxRepos,
  who: PackWho,
  c: {
    contractId: string;
    approvalId: string;
    feedback: string | undefined;
    products?: readonly ProductLink[] | undefined;
  },
  dec: Exclude<Decision, { kind: "error" }>,
): Promise<"ok" | "redo" | null> {
  const { contractId: cid, approvalId: id } = c;
  if (dec.kind === "to_level2") return (await r.approval.toLevel2(id, who.userId)) ? "ok" : null;
  if (dec.kind === "reject") {
    const e = { kind: "rejected" as const, feedback: c.feedback ?? null, actor: who.userId };
    return (await r.approval.markRejected(cid, id, e)) ? "ok" : null;
  }
  if (dec.kind === "redo") {
    if (!dec.reextract) return "ok";
    return (await r.approval.markExtracting(cid, id)) ? "redo" : null;
  }
  return finalizeOrLevel2(r, who, c, dec.level2Passed);
}

/** D3-14 · `finalize` kiểm ngưỡng trong câu UPDATE; giá trị đổi dưới khoá ⇒ cần cấp 2: chuyển cấp 2 thay vì "Đã duyệt". */
async function finalizeOrLevel2(
  r: ApprovalTxRepos,
  who: PackWho,
  c: { contractId: string; approvalId: string; products?: readonly ProductLink[] | undefined },
  level2Passed: boolean,
): Promise<"ok" | null> {
  if (await r.approval.finalize(c.contractId, c.approvalId, who.userId, level2Passed)) {
    await linkOnConfirm(r, who, c);
    return "ok";
  }
  if (level2Passed) return null;
  return (await r.approval.toLevel2(c.approvalId, who.userId)) ? "ok" : null;
}

/** products-confirm: HĐ vừa thành "đã xác nhận" ⇒ gắn/tạo SP theo lựa chọn trong hộp xác nhận (cùng tx; lỗi ⇒ ROLLBACK cả bước). */
async function linkOnConfirm(
  r: ApprovalTxRepos,
  who: PackWho,
  c: { contractId: string; products?: readonly ProductLink[] | undefined },
): Promise<void> {
  if (!c.products?.length || !r.links) return;
  const out = await r.links.link(c.contractId, c.products, who.userId);
  if (out.kind !== "ok") throw new Error(`product-links on confirm: ${out.kind}`);
}

type Decided = { done: "ok" | "redo"; approvalId: string; error?: undefined };
type TxOutcome =
  | Decided
  | "not_found"
  | "unavailable"
  | { error: ApprovalErrorCode }
  | { engine: ApprovalState };

/** Trích lại thật sự (sau `decide`): AI chưa sẵn sàng ⇒ `unavailable`; trừ quota (ném ⇒ ROLLBACK). */
async function redoGate(
  d: ApprovalDeps,
  who: PackWho,
  dec: Decision,
): Promise<"unavailable" | null> {
  if (dec.kind !== "redo" || !dec.reextract || !d.redo) return null;
  if (!d.redo.ready) return "unavailable";
  await d.redo.quota(who.tenantId);
  return null;
}

/** S3b · lượt engine quyết qua engine (ngoài tx này, scope người quyết); máy cũ không có "Trả lại"; không có lượt ⇒ không mở. */
function beforeMachine(st: ApprovalState, b: ApprovalAction): TxOutcome | null {
  if (!st.approval) return { error: "APPROVAL_NOT_OPEN" };
  if (st.approval.mode === "engine") return { engine: st };
  return b.action === "return" ? { error: "APPROVAL_NOT_OPEN" } : null;
}

/** Trong tx khoá HĐ: đọc trạng thái → `decide` → cổng trích lại → ghi. */
function decideInTx(d: ApprovalDeps, who: PackWho, id: string, b: ApprovalAction) {
  return async (r: ApprovalTxRepos, actor: ApprovalActor): Promise<TxOutcome> => {
    const st = await r.approval.state(id, { lock: true });
    if (!st) return "not_found";
    const pre = beforeMachine(st, b);
    if (pre) return pre;
    if (!st.approval) return { error: "APPROVAL_NOT_OPEN" };
    const dec = decide({
      status: st.approval.status,
      startedBy: st.approval.startedBy,
      actor,
      action: b.action as Exclude<ApprovalAction["action"], "return">,
      feedback: b.feedback,
      value: st.value,
      threshold: st.threshold,
      hasSource: st.hasSource,
    });
    if (dec.kind === "error") return { error: dec.code };
    if ((await redoGate(d, who, dec)) === "unavailable") return "unavailable";
    const c = {
      contractId: id,
      approvalId: st.approval.id,
      feedback: b.feedback,
      products: b.products,
    };
    const done = await apply(r, who, c, dec);
    if (done === null) return { error: "APPROVAL_NOT_OPEN" };
    if (done === "redo")
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
    return { done, approvalId: st.approval.id };
  };
}

/** S3b · quyết trên engine (ngoài tx khoá HĐ) rồi trả thẻ mới. */
async function actOnEngine(
  d: ApprovalDeps,
  who: PackWho,
  id: string,
  b: ApprovalAction,
  st: ApprovalState,
): Promise<ActOutcome> {
  const res = d.card ? await d.card.act(who, id, b, st) : { error: "APPROVAL_NOT_OPEN" as const };
  if (res === "unavailable") return res;
  if (res !== "ok") return { error: res.error };
  return (await getApproval(d)(who, id)) ?? "not_found";
}

/** Quyết bước đang mở: quyền Group + người bắt đầu + lý do theo `decide`; ghi trong tx khoá HĐ. */
export function actApproval(d: ApprovalDeps) {
  const get = getApproval(d);
  return async (who: PackWho, id: string, b: ApprovalAction): Promise<ActOutcome> => {
    const s = await d.uow.tenant(who, (r) => r.approval.settings());
    const actor = await actorOf(d, who, s);
    const inTx = decideInTx(d, who, id, b);
    const out = await d.uow.tenant(who, (r) => inTx(r, actor));
    if (out === "not_found" || out === "unavailable") return out;
    if ("engine" in out) return actOnEngine(d, who, id, b, out.engine);
    if (out.error !== undefined) return { error: out.error };
    if (out.done === "redo")
      await d.jobs.enqueue({ ...who, contractId: id, approvalId: out.approvalId });
    return (await get(who, id)) ?? "not_found";
  };
}

/** HD-FR-37 · lưu cài đặt + nhật ký; Group không có ở tenant ⇒ `group_missing` (không lưu). */
export function saveApprovalSettings(d: ApprovalDeps) {
  return async (who: PackWho, s: ApprovalSettings): Promise<ApprovalSettings | "group_missing"> => {
    const ids = await d.groups.idsOf(who.tenantId, [s.level1GroupKey, s.level2GroupKey]);
    if (!ids.has(s.level1GroupKey) || !ids.has(s.level2GroupKey)) return "group_missing";
    const saved = await d.uow.tenant(who, (r) => r.approval.saveSettings(s, who.userId));
    await d.onSettingsSaved?.(who);
    return saved;
  };
}

export function readApprovalSettings(d: Pick<ApprovalDeps, "uow">) {
  return (who: PackWho) => d.uow.tenant(who, (r) => r.approval.settings());
}

/** Seam sửa trường (review S1): giai đoạn lượt duyệt (cấp 1 sửa được, cấp 2 khoá — D3-02). */
export function patchGuard(d: Pick<ApprovalDeps, "uow">) {
  return {
    async phase(who: PackWho, runId: string): Promise<RunPhase> {
      return phaseOf(await d.uow.tenant(who, (r) => r.approval.statusOf(runId)));
    },
  };
}
