// HD-FR-31 · HD-FR-33 · HD-FR-34 · HD-FR-36 · HD-FR-37 · M3-decouple: flow duyệt HĐ là máy trạng thái của gói (không engine).
// Mở lượt (tải lên / trích lại / nhập tay), xem thẻ duyệt, quyết bước (luật `decide` thuần), cài đặt tenant. Quyết trong MỘT tx
// khoá hàng HĐ (FOR UPDATE) ⇒ `finalize` đánh giá lại ngưỡng trong câu UPDATE (D3-14). Lớp 2: chỉ cổng, lỗi trả mã (route dịch).
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

/** Group duyệt: id theo khoá của tenant (thiếu ⇒ vắng) + Group của user (cache cấu hình, 0 SQL khi nóng). */
export type ApprovalGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  userGroups(who: PackWho): Promise<ReadonlySet<string>>;
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
};
export type ContractApproval = ReturnType<typeof approvalView>;
export type ApprovalAction = { action: "approve" | "reject" | "redo"; feedback?: string };
export type ActOutcome = ContractApproval | "not_found" | { error: ApprovalErrorCode };

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
    return out;
  };
}

async function actorOf(d: ApprovalDeps, who: PackWho, s: ApprovalSettings): Promise<ApprovalActor> {
  const [ids, mine] = await Promise.all([
    d.groups.idsOf(who.tenantId, [s.level1GroupKey, s.level2GroupKey]),
    d.groups.userGroups(who),
  ]);
  const has = (k: string) => {
    const g = ids.get(k);
    return g !== undefined && mine.has(g);
  };
  return { userId: who.userId, inLevel1: has(s.level1GroupKey), inLevel2: has(s.level2GroupKey) };
}

const viewOf = (st: ApprovalState, actor: ApprovalActor) => approvalView(st.approval, actor);

export function getApproval(d: ApprovalDeps) {
  return async (who: PackWho, id: string): Promise<ContractApproval | null> => {
    const got = await d.uow.tenant(who, async (r) => ({
      st: await r.approval.state(id, { lock: false }),
      s: await r.approval.settings(),
    }));
    if (!got.st) return null;
    return viewOf(got.st, await actorOf(d, who, got.s));
  };
}

/** Áp phán quyết trong tx đang khoá HĐ. `null` ⇒ bước không còn mở (đua). */
async function apply(
  r: ApprovalTxRepos,
  who: PackWho,
  c: { contractId: string; approvalId: string },
  dec: Exclude<Decision, { kind: "error" }>,
  b: ApprovalAction,
): Promise<"ok" | "redo" | null> {
  const { contractId: cid, approvalId: id } = c;
  if (dec.kind === "to_level2") return (await r.approval.toLevel2(id, who.userId)) ? "ok" : null;
  if (dec.kind === "reject") {
    const e = { kind: "rejected" as const, feedback: b.feedback ?? null, actor: who.userId };
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
  c: { contractId: string; approvalId: string },
  level2Passed: boolean,
): Promise<"ok" | null> {
  if (await r.approval.finalize(c.contractId, c.approvalId, who.userId, level2Passed)) return "ok";
  if (level2Passed) return null;
  return (await r.approval.toLevel2(c.approvalId, who.userId)) ? "ok" : null;
}

/** Quyết bước đang mở: quyền Group + người bắt đầu + lý do theo `decide`; ghi trong tx khoá HĐ. */
export function actApproval(d: ApprovalDeps) {
  const get = getApproval(d);
  return async (who: PackWho, id: string, b: ApprovalAction): Promise<ActOutcome> => {
    const s = await d.uow.tenant(who, (r) => r.approval.settings());
    const actor = await actorOf(d, who, s);
    const out = await d.uow.tenant(who, async (r) => {
      const st = await r.approval.state(id, { lock: true });
      if (!st) return "not_found" as const;
      if (!st.approval) return { error: "APPROVAL_NOT_OPEN" as const };
      const dec = decide({
        status: st.approval.status,
        startedBy: st.approval.startedBy,
        actor,
        action: b.action,
        feedback: b.feedback,
        value: st.value,
        threshold: st.threshold,
        hasSource: st.hasSource,
      });
      if (dec.kind === "error") return { error: dec.code };
      const done = await apply(r, who, { contractId: id, approvalId: st.approval.id }, dec, b);
      if (done === null) return { error: "APPROVAL_NOT_OPEN" as const };
      if (done === "redo")
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return { done, approvalId: st.approval.id, startedBy: st.approval.startedBy };
    });
    if (out === "not_found") return out;
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
    return d.uow.tenant(who, (r) => r.approval.saveSettings(s, who.userId));
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
