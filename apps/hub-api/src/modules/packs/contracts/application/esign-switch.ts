// CR-125 · m4 · MOD-FR-11 · người ký chọn cách ký KHÁC loại phong bì đã gửi (vd gửi bằng DocuSign, chọn Ký thử): giành quyền đổi (MỘT tx:
// `FOR UPDATE` + kiểm còn mở/chưa ai ký + UPDATE có điều kiện giữ lease) ⇒ huỷ ở nhà cung cấp (hụt ⇒ nhả quyền, phong bì cũ vẫn là phong bì
// sống) ⇒ ghi `voided` + audit ⇒ gửi lại cùng người ký / thứ tự / HẠN CÒN LẠI / nhắc trên cách đã chọn. Gửi lại hụt ⇒ dựng lại trên cách cũ;
// dựng lại cũng hụt ⇒ bắn `esign.voided` (lý do `resend-failed`) để lượt rời bước chờ, không kẹt. Hai lượt đổi cùng lúc ⇒ đúng MỘT phong bì mới.
import type { ESignSignerIn } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import { type ESignStatus, isOpen } from "../domain/esign.rules";
import { isSigned } from "../domain/esign-signer.rules";
import { ESignFail } from "./esign.helpers";
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";
import type { SendNodeOpts } from "./esign-node.usecase";
import { errName } from "./esign-void";

export type EsignSwitchDeps = {
  uow: PackUow<{ esign: ESignRepo }>;
  avail: (key: string) => ESignProvider | null;
  warn?: ((msg: string, meta: Record<string, unknown>) => void) | undefined;
  send: (
    who: PackWho,
    id: string,
    signers: ESignSignerIn[],
    key: string,
    node: SendNodeOpts,
  ) => Promise<void>;
  reopen: (who: PackWho, id: string) => Promise<EnvelopeRow>;
  /** Loại của nhà cung cấp (envelope = cả luồng ký trên nền tảng của họ; ca = chứng thư, đổi theo từng người ký). */
  kindOf: (key: string) => "envelope" | "ca";
  now?: (() => Date) | undefined;
  /** Phong bì sang trạng thái cuối ⇒ lượt đang chờ rẽ nhánh (cùng hook webhook). */
  onStatus?:
    | ((tenantId: string, contractId: string, status: ESignStatus) => Promise<void>)
    | undefined;
};

/** Lease giữ quyền đổi (phút) — tiến trình chết giữa chừng ⇒ hết lease bên khác đổi / quét hạn được. */
export const ESIGN_SWITCH_LEASE_MIN = 10;
/** CR-125 · m10 · `reason` của phong bì trong lúc giữ quyền đổi: webhook/đồng bộ của nó bị bỏ qua (chỉ audit, không tín hiệu). */
export const ESIGN_SWITCHING = "switching";
const H = 3_600_000;

/** Hạn còn lại (giờ, làm tròn lên, ≥ 1) tính từ lúc gửi phong bì cũ — gửi lại không kéo dài hạn ký. */
export function remainingDueH(
  e: Pick<EnvelopeRow, "createdAt" | "dueH">,
  now: Date,
): number | null {
  if (!e.dueH) return null;
  const sent = Date.parse(e.createdAt);
  if (Number.isNaN(sent)) return e.dueH;
  return Math.max(1, Math.ceil((sent + e.dueH * H - now.getTime()) / H));
}

const nodeOf = (e: EnvelopeRow, now: Date): SendNodeOpts => {
  const dueH = remainingDueH(e, now);
  return {
    companyUsers: e.signers.flatMap((s) =>
      s.role === "company" && s.client_user_id ? [s.client_user_id] : [],
    ),
    order: new Set(e.signers.map((s) => s.order)).size === 1 ? "parallel" : "sequential",
    ...(dueH ? { dueH } : {}),
    ...(e.remindEveryH ? { remindEveryH: e.remindEveryH } : {}),
  };
};

export const esignSwitch = (d: EsignSwitchDeps) => {
  const now = () => d.now?.() ?? new Date();

  /** MỘT tx: khoá hàng, kiểm lại còn mở + chưa ai ký, giành lease (UPDATE có điều kiện). Không giành được ⇒ lỗi trạng thái rõ. */
  const claim = (who: PackWho, e: EnvelopeRow) =>
    d.uow.tenant(who, async (r) => {
      const cur = await r.esign.lockById(e.id);
      if (!cur || !isOpen(cur.status)) throw new ESignFail("ESIGN_STATE", "already-switched");
      if (cur.signers.some(isSigned))
        // một định nghĩa "đã ký" chung (`isSigned`): có mốc ký hoặc trạng thái completed/signed
        throw new ESignFail("ESIGN_STATE", "signing");
      const got = await r.esign.claimSwitch(e.id, now(), ESIGN_SWITCH_LEASE_MIN);
      if (!got) throw new ESignFail("ESIGN_STATE", "switch-in-progress");
      return got;
    });

  const swap = async (who: PackWho, id: string, e0: EnvelopeRow, key: string) => {
    if (!d.avail(key)) throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "signer-provider");
    const e = await claim(who, e0);
    try {
      const old = d.avail(e.provider);
      if (!old) throw new Error("old-provider-unavailable");
      await old.voidEnvelope(e.envelopeId, "switch-provider");
    } catch (x) {
      // huỷ ở nhà cung cấp hụt ⇒ KHÔNG đổi hàng của mình (phong bì cũ vẫn sống), nhả quyền để bấm lại được
      d.warn?.("esign-switch-void-failed", { contract_id: id, error: errName(x) });
      await d.uow.tenant(who, (r) => r.esign.releaseSwitch(e.id)).catch(() => undefined);
      throw new ESignFail("ESIGN_RESEND_FAILED", "void");
    }
    await d.uow.tenant(who, async (r) => {
      // hàng đã đổi ngoài lease (lease hết hạn, bên khác chạm) ⇒ KHÔNG gửi lại (không sinh phong bì mồ côi)
      if (!(await r.esign.voidClaimed(e.id, "switch-provider")))
        throw new ESignFail("ESIGN_STATE", "already-switched");
      await r.esign.audit(
        who.userId,
        { esign_switch: { contract_id: id, provider: e.provider, envelope_id: e.envelopeId } },
        { esign_switch: { contract_id: id, provider: key } },
      );
    });
    const signers: ESignSignerIn[] = e.signers.map((s) =>
      s.role === "company"
        ? { role: "company" }
        : { role: "partner", name: s.name, email: s.email },
    );
    const node = nodeOf(e, now());
    try {
      await d.send(who, id, signers, key, node);
    } catch (x) {
      d.warn?.("esign-switch-resend-failed", { contract_id: id, error: errName(x) });
      await rebuild(who, id, e, signers, node);
      throw new ESignFail("ESIGN_RESEND_FAILED", "resend");
    }
    return d.reopen(who, id);
  };

  /** Gửi lại hụt ⇒ dựng lại trên cách ĐÃ GỬI («Ký ngay» bấm lại được); cũng hụt ⇒ `esign.voided` (resend-failed) để lượt không kẹt. */
  const rebuild = async (
    who: PackWho,
    id: string,
    e: EnvelopeRow,
    signers: ESignSignerIn[],
    node: SendNodeOpts,
  ) => {
    const ok = await d.send(who, id, signers, e.provider, node).then(
      () => true,
      (x: unknown) => {
        d.warn?.("esign-switch-rebuild-failed", { contract_id: id, error: errName(x) });
        return false;
      },
    );
    if (ok) return;
    await d.uow
      .tenant(who, (r) =>
        r.esign.update(e.envelopeId, {
          status: "voided",
          reason: "resend-failed",
          completedAt: null,
          signers: e.signers,
        }),
      )
      .catch(() => undefined);
    await d
      .onStatus?.(who.tenantId, id, "voided")
      .catch((x: unknown) =>
        d.warn?.("esign-flow-hook-failed", { contract_id: id, error: errName(x) }),
      );
  };

  /** Cách khác LOẠI phong bì (có "envelope") ⇒ đổi = gửi lại (chỉ người ký công ty); cùng loại "ca" ⇒ để signerProvider đổi theo từng người ký. */
  return async (
    who: PackWho,
    id: string,
    e: EnvelopeRow,
    key: string | undefined,
  ): Promise<{ e: EnvelopeRow; key: string | undefined }> => {
    const envelope = [e.provider, key ?? e.provider].some((k) => d.kindOf(k) === "envelope");
    if (key === undefined || key === e.provider) return { e, key: undefined };
    if (!envelope) {
      if (!d.avail(key)) throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "signer-provider");
      return { e, key }; // cùng loại "ca": đổi theo từng người ký
    }
    if (!e.signers.some((s) => s.role === "company" && s.client_user_id === who.userId))
      throw new ESignFail("ESIGN_NOT_SIGNER", "not-company-signer");
    return { e: await swap(who, id, e, key), key: undefined };
  };
};
