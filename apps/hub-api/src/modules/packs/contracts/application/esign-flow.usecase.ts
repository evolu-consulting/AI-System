// esign-flow · bước Ký số cuối luồng duyệt (lớp 2 — chỉ cổng). Mẫu chụp của lượt có bước `esign` ⇒ sau "Đã duyệt" (tool finalize, đã
// COMMIT): claim idempotent trên lượt → người ký công ty theo cấu hình (người phụ trách / trưởng phòng / người cụ thể — KHÔNG phải
// người bấm) → email đối tác từ liên hệ đối tác của HĐ (thiếu ⇒ "cần quyết") → gửi ký bằng use case ký số ở scope hệ thống → chuông
// người ký. Phong bì xong ⇒ bước xong (luồng kết thúc); từ chối/huỷ ⇒ "cần quyết" + chuông người phụ trách (Gửi lại / Mở lại HĐ).
// Gọi mạng NGOÀI tx; mọi ghi trạng thái + chuông trong một tx scope hệ thống của tenant.
// esign-flow-fix: kẹt `sending` (tiến trình chết giữa chừng) quá `ESIGN_SENDING_STALE_MIN` ⇒ Gửi lại nhận được; người ký công ty phải
// còn dùng được + còn quyền ghi gói + THẤY HĐ ngay trước khi gửi (không ⇒ NO_SIGNER); trạng thái cuối ghi điều kiện MỘT câu.
import type { ESignSignerIn } from "@ai/contracts";
import type { NotifyInput, NotifyTxRepos } from "../../kit/application/notify";
import type { PackSystemUow, PackUow, PackWho } from "../../kit/application/ports";
import type { FlowEsignStep } from "../domain/approval-flow.types";
import {
  type EsignReason,
  type EsignStatus,
  signerOf,
  signersOf,
} from "../domain/approval-flow-esign.rules";
import type { ESignStatus } from "../domain/esign.rules";
import type { ESignRepo } from "./esign.ports";

/** Bước kẹt `sending` lâu hơn số phút này ⇒ coi như tiến trình đã chết, Gửi lại được. */
export const ESIGN_SENDING_STALE_MIN = 10;

export type EsignFlowClaim = { approvalId: string; step: FlowEsignStep; owner: string | null };
export type EsignFlowCurrent = {
  approvalId: string;
  status: string | null;
  owner: string | null;
  signer: string | null;
  /** `sending` quá `ESIGN_SENDING_STALE_MIN` phút (theo `esign_at`). */
  stale: boolean;
};
export type EsignFlowFinish = { approvalId: string; owner: string | null; label: string };
export type EsignFlowRepo = {
  /** Lượt hiện tại của HĐ đã duyệt xong, mẫu chụp có bước Ký số, trạng thái bước = null (lần đầu) / `needs_decision` hoặc `sending`
   *  kẹt quá hạn (Gửi lại) ⇒ đổi `sending` + trả bước; khác ⇒ null (đã chạy / không có bước). */
  claim(contractId: string, resend: boolean): Promise<EsignFlowClaim | null>;
  set(
    approvalId: string,
    s: {
      status: Exclude<EsignStatus, "pending">;
      reason: EsignReason | null;
      signer?: string | null;
    },
  ): Promise<void>;
  current(contractId: string): Promise<EsignFlowCurrent | null>;
  /** MỘT câu: lượt hiện tại đang `sent` ⇒ đổi trạng thái cuối, trả người phụ trách + nhãn HĐ; khác ⇒ null. */
  finish(
    contractId: string,
    to: { status: "completed" | "needs_decision"; reason: EsignReason | null },
  ): Promise<EsignFlowFinish | null>;
};
type R = { esignFlow: EsignFlowRepo; esign: ESignRepo } & NotifyTxRepos;

export type EsignFlowDeps = {
  uow: PackUow<R> & PackSystemUow<R>;
  /** Gửi ký scope hệ thống (`ESignUsecase.sendSystem`). */
  send: (
    tenantId: string,
    signer: string,
    id: string,
    signers: ESignSignerIn[],
    provider?: string,
  ) => Promise<void>;
  deptHead: (tenantId: string, groupId: string) => Promise<string | null>;
  /** Người ký công ty còn dùng được (active, không khoá) + còn quyền ghi gói. */
  signerOk: (tenantId: string, userId: string) => Promise<boolean>;
  /** Đối tác ký hợp lệ theo schema người ký đối tác (adapter); sai ⇒ null. */
  parsePartner: (name: string, email: string) => { name: string; email: string } | null;
  warn: (msg: string, meta: Record<string, unknown>) => void;
};
export type EsignFlowOutcome = "none" | "sent" | "needs_decision";
export type ResendOutcome = EsignFlowOutcome | "not_found" | "forbidden" | "not_needed";

const REASON_TEXT: Record<EsignReason, string> = {
  NO_PARTNER_EMAIL: "đối tác chưa có email liên hệ",
  NO_SIGNER: "chưa xác định được người ký phía công ty",
  SEND_FAILED: "gửi ký không thành công",
  DECLINED: "có người từ chối ký",
  VOIDED: "phong bì ký đã bị huỷ",
};
const bell = (user: string, id: string, title: string, body?: string): NotifyInput => ({
  user_id: user,
  kind: "contract.esign",
  title: title.slice(0, 200),
  ...(body ? { body } : {}),
  link: `/contracts/${id}`,
});
const needsBell = (owner: string, id: string, label: string, why: EsignReason) =>
  bell(
    owner,
    id,
    `Ký số HĐ ${label} cần quyết`,
    `Lý do: ${REASON_TEXT[why]}. Gửi lại hoặc mở lại HĐ.`,
  );

type Partner = { name: string; email: string } | null;
type Contract = Awaited<ReturnType<ESignRepo["contract"]>>;
const labelOf = (k: Contract) => (k?.number ?? k?.title ?? "").slice(0, 120);

export function esignFlow(d: EsignFlowDeps) {
  const sys = <T>(tid: string, fn: (r: R) => Promise<T>) => d.uow.system(tid, fn);
  const warnOf = (msg: string, id: string, e: unknown) => {
    const err = e instanceof Error ? e : null;
    d.warn(msg, {
      contract_id: id,
      error: err?.name ?? "unknown",
      detail: err?.message.slice(0, 80) ?? "",
    });
  };

  /** Bước dừng "cần quyết" + chuông người phụ trách (một tx). */
  const needs = async (
    tid: string,
    id: string,
    c: { approvalId: string; owner: string | null },
    why: EsignReason,
    label: string,
  ) => {
    await sys(tid, async (r) => {
      await r.esignFlow.set(c.approvalId, { status: "needs_decision", reason: why });
      if (c.owner) await r.notify.enqueue([needsBell(c.owner, id, label, why)]);
    });
    return "needs_decision" as const;
  };

  /** Đối tác ký: email từ liên hệ đối tác của HĐ, kiểm bằng schema (tên trống ⇒ email); thiếu/sai ⇒ null. */
  const partnerOf = (k: Contract): Partner => {
    const em = k?.partner?.email?.trim() ?? "";
    if (!em) return null;
    return d.parsePartner((k?.partner?.name?.trim() || em).slice(0, 200), em);
  };

  /** Người ký công ty theo cấu hình; còn dùng được + quyền ghi gói + THẤY HĐ (RLS M1 của chính người đó) — không ⇒ null. */
  const signerFor = async (tid: string, id: string, c: EsignFlowClaim) => {
    const g = c.step.company_signer.department_group_id;
    const head = c.step.company_signer.mode === "dept_head" && g ? await d.deptHead(tid, g) : null;
    const u = signerOf(c.step, { owner: c.owner, deptHead: head });
    if (!u || !(await d.signerOk(tid, u))) return null;
    const sees = await d.uow
      .tenant({ tenantId: tid, userId: u }, (r) => r.esign.contract(id))
      .catch(() => null);
    return sees ? u : null;
  };
  /** Gửi ký; lỗi ⇒ log (không thân) + false. */
  const trySend = async (tid: string, id: string, u: string, c: EsignFlowClaim, p: Partner) => {
    try {
      await d.send(tid, u, id, signersOf(c.step, p), c.step.provider ?? undefined);
      return true;
    } catch (e) {
      warnOf("contract-esign-flow-send-failed", id, e);
      return false;
    }
  };

  /** Sau claim: chọn người ký → đối tác → gửi → `sent` + chuông người ký. */
  const run = async (tid: string, id: string, c: EsignFlowClaim): Promise<EsignFlowOutcome> => {
    const k = await sys(tid, (r) => r.esign.contract(id));
    const label = labelOf(k);
    const signer = await signerFor(tid, id, c);
    if (!signer) return needs(tid, id, c, "NO_SIGNER", label);
    const partner = partnerOf(k);
    if (c.step.partner_signs && !partner) return needs(tid, id, c, "NO_PARTNER_EMAIL", label);
    if (!(await trySend(tid, id, signer, c, partner)))
      return needs(tid, id, c, "SEND_FAILED", label);
    await sys(tid, async (r) => {
      await r.esignFlow.set(c.approvalId, { status: "sent", reason: null, signer });
      await r.notify.enqueue([
        bell(signer, id, `Mời ký số HĐ ${label}`, "Hợp đồng đã duyệt xong, chờ bạn ký."),
      ]);
    });
    return "sent";
  };

  /** Trạng thái cuối của phong bì ⇒ MỘT câu đổi có điều kiện (`sent`); chuông chỉ khi có hàng đổi. */
  const finish = async (tid: string, id: string, st: ESignStatus) => {
    const to =
      st === "completed"
        ? { status: "completed" as const, reason: null }
        : { status: "needs_decision" as const, reason: st === "declined" ? "DECLINED" : "VOIDED" };
    if (st !== "completed" && st !== "declined" && st !== "voided") return;
    await sys(tid, async (r) => {
      const f = await r.esignFlow.finish(id, to as Parameters<EsignFlowRepo["finish"]>[1]);
      if (!f?.owner) return;
      const b =
        to.status === "completed"
          ? bell(f.owner, id, `Hợp đồng ${f.label} đã ký số xong`)
          : needsBell(f.owner, id, f.label, to.reason as EsignReason);
      await r.notify.enqueue([b]);
    });
  };

  return {
    /** Tool finalize gọi SAU commit "Đã duyệt". Không có bước Ký số / đã chạy ⇒ `none`. */
    async afterApproved(tid: string, id: string): Promise<EsignFlowOutcome> {
      const c = await sys(tid, (r) => r.esignFlow.claim(id, false));
      return c ? run(tid, id, c) : "none";
    },

    /** Phong bì sang trạng thái cuối (hook của use case ký số). Lỗi ⇒ log, không ném. */
    async onStatus(tid: string, id: string, st: ESignStatus): Promise<void> {
      await finish(tid, id, st).catch((e: unknown) =>
        warnOf("contract-esign-flow-status-failed", id, e),
      );
    },

    /** "Gửi lại" khi bước cần quyết (hoặc kẹt `sending` quá hạn): người phụ trách HĐ hoặc owner gói (`admin`). */
    async resend(who: PackWho, id: string, admin: boolean): Promise<ResendOutcome> {
      const cur = await d.uow.tenant(who, (r) => r.esignFlow.current(id));
      if (!cur) return "not_found";
      if (!admin && cur.owner !== who.userId) return "forbidden";
      if (cur.status !== "needs_decision" && !cur.stale) return "not_needed";
      const c = await sys(who.tenantId, (r) => r.esignFlow.claim(id, true));
      return c ? run(who.tenantId, id, c) : "not_needed";
    },
  };
}
export type EsignFlow = ReturnType<typeof esignFlow>;
