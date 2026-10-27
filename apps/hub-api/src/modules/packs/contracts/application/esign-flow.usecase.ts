// esign-flow · bước Ký số cuối luồng duyệt (lớp 2 — chỉ cổng). Mẫu chụp của lượt có bước `esign` ⇒ sau "Đã duyệt" (tool finalize, đã
// COMMIT): claim idempotent trên lượt → người ký công ty theo cấu hình (người phụ trách / trưởng phòng / người cụ thể — KHÔNG phải
// người bấm) → email đối tác từ liên hệ đối tác của HĐ (thiếu ⇒ "cần quyết") → gửi ký bằng use case ký số ở scope hệ thống → chuông
// người ký. Phong bì xong ⇒ bước xong (luồng kết thúc); từ chối/huỷ ⇒ "cần quyết" + chuông người phụ trách (Gửi lại / Mở lại HĐ).
// Gọi mạng NGOÀI tx; mọi ghi trạng thái + chuông trong một tx scope hệ thống của tenant.
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

export type EsignFlowClaim = { approvalId: string; step: FlowEsignStep; owner: string | null };
export type EsignFlowCurrent = {
  approvalId: string;
  status: string | null;
  owner: string | null;
  signer: string | null;
};
export type EsignFlowRepo = {
  /** Lượt hiện tại của HĐ đã duyệt xong, mẫu chụp có bước Ký số, trạng thái bước = null (lần đầu) / `needs_decision` (Gửi lại)
   *  ⇒ đổi `sending` + trả bước; khác ⇒ null (đã chạy / không có bước). */
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

type Partner = { name: string; email: string } | null;
type Contract = Awaited<ReturnType<ESignRepo["contract"]>>;
const labelOf = (k: Contract) => (k?.number ?? k?.title ?? "").slice(0, 120);
/** Đối tác ký: email từ liên hệ đối tác của HĐ (thiếu ⇒ null); tên trống ⇒ email. */
function partnerOf(k: Contract): Partner {
  const em = k?.partner?.email ?? null;
  return em ? { name: (k?.partner?.name || em).slice(0, 200), email: em } : null;
}

export function esignFlow(d: EsignFlowDeps) {
  const sys = <T>(tid: string, fn: (r: R) => Promise<T>) => d.uow.system(tid, fn);

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
      if (c.owner)
        await r.notify.enqueue([
          bell(
            c.owner,
            id,
            `Ký số HĐ ${label} cần quyết`,
            `Lý do: ${REASON_TEXT[why]}. Gửi lại hoặc mở lại HĐ.`,
          ),
        ]);
    });
    return "needs_decision" as const;
  };

  /** Sau claim: chọn người ký → đối tác → gửi → `sent` + chuông người ký. */
  /** Người ký công ty theo cấu hình (trưởng phòng tra danh bạ). */
  const signerFor = async (tid: string, c: EsignFlowClaim) => {
    const g = c.step.company_signer.department_group_id;
    const head = c.step.company_signer.mode === "dept_head" && g ? await d.deptHead(tid, g) : null;
    return signerOf(c.step, { owner: c.owner, deptHead: head });
  };
  /** Gửi ký; lỗi ⇒ log (không thân) + false. */
  const trySend = async (
    tid: string,
    id: string,
    signer: string,
    c: EsignFlowClaim,
    p: Partner,
  ) => {
    try {
      await d.send(tid, signer, id, signersOf(c.step, p), c.step.provider ?? undefined);
      return true;
    } catch (e) {
      const err = e instanceof Error ? e : null;
      const meta = { error: err?.name ?? "unknown", detail: err?.message.slice(0, 80) ?? "" };
      d.warn("contract-esign-flow-send-failed", { contract_id: id, ...meta });
      return false;
    }
  };

  const run = async (tid: string, id: string, c: EsignFlowClaim): Promise<EsignFlowOutcome> => {
    const k = await sys(tid, (r) => r.esign.contract(id));
    const label = labelOf(k);
    const signer = await signerFor(tid, c);
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

  return {
    /** Tool finalize gọi SAU commit "Đã duyệt". Không có bước Ký số / đã chạy ⇒ `none`. */
    async afterApproved(tid: string, id: string): Promise<EsignFlowOutcome> {
      const c = await sys(tid, (r) => r.esignFlow.claim(id, false));
      return c ? run(tid, id, c) : "none";
    },

    /** Phong bì sang trạng thái cuối (hook của use case ký số). Chỉ lượt hiện tại đang `sent`. */
    async onStatus(tid: string, id: string, st: ESignStatus): Promise<void> {
      const cur = await sys(tid, (r) => r.esignFlow.current(id));
      if (!cur || cur.status !== "sent") return;
      if (st === "completed") {
        await sys(tid, async (r) => {
          await r.esignFlow.set(cur.approvalId, { status: "completed", reason: null });
          if (cur.owner) await r.notify.enqueue([bell(cur.owner, id, "Hợp đồng đã ký số xong")]);
        });
        return;
      }
      if (st === "declined" || st === "voided")
        await needs(tid, id, cur, st === "declined" ? "DECLINED" : "VOIDED", "");
    },

    /** "Gửi lại" khi bước cần quyết: người phụ trách HĐ hoặc owner gói (`admin`). */
    async resend(who: PackWho, id: string, admin: boolean): Promise<ResendOutcome> {
      const cur = await d.uow.tenant(who, (r) => r.esignFlow.current(id));
      if (!cur) return "not_found";
      if (!admin && cur.owner !== who.userId) return "forbidden";
      if (cur.status !== "needs_decision") return "not_needed";
      const c = await sys(who.tenantId, (r) => r.esignFlow.claim(id, true));
      return c ? run(who.tenantId, id, c) : "not_needed";
    },
  };
}
export type EsignFlow = ReturnType<typeof esignFlow>;
