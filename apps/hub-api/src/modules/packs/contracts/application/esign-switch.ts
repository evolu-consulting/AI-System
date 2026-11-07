// CR-125 · m4 · MOD-FR-11 · người ký chọn cách ký KHÁC loại phong bì đã gửi (vd gửi bằng DocuSign, chọn Ký thử): huỷ phong bì cũ (không
// bắn tín hiệu — luồng vẫn chờ) rồi gửi lại cùng người ký / thứ tự / hạn / nhắc trên cách đã chọn. Chưa ai ký mới đổi được.
import type { ESignSignerIn } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import { ESignFail } from "./esign.helpers";
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";
import type { SendNodeOpts } from "./esign-node.usecase";
import { errName } from "./esign-void";

export type EsignSwitchDeps = {
  uow: PackUow<{ esign: ESignRepo }>;
  avail: (key: string) => ESignProvider | null;
  warn: ((msg: string, meta: Record<string, unknown>) => void) | undefined;
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
};

export const esignSwitch = (d: EsignSwitchDeps) => {
  const swap = async (
    who: PackWho,
    id: string,
    e: EnvelopeRow,
    key: string,
  ): Promise<EnvelopeRow> => {
    if (!d.avail(key)) throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "signer-provider");
    if (e.signers.some((s) => s.signed_at !== null)) throw new ESignFail("ESIGN_STATE", "signing");
    await d
      .avail(e.provider)
      ?.voidEnvelope(e.envelopeId, "switch-provider")
      .catch((x: unknown) =>
        d.warn?.("esign-switch-void-failed", { contract_id: id, error: errName(x) }),
      );
    await d.uow.tenant(who, (r) =>
      r.esign.update(e.envelopeId, {
        status: "voided",
        reason: "switch-provider",
        completedAt: null,
        signers: e.signers,
      }),
    );
    const signers: ESignSignerIn[] = e.signers.map((s) =>
      s.role === "company"
        ? { role: "company" }
        : { role: "partner", name: s.name, email: s.email },
    );
    const companyUsers = e.signers.flatMap((s) =>
      s.role === "company" && s.client_user_id ? [s.client_user_id] : [],
    );
    const node: SendNodeOpts = {
      companyUsers,
      order: new Set(e.signers.map((s) => s.order)).size === 1 ? "parallel" : "sequential",
      ...(e.dueH ? { dueH: e.dueH } : {}),
      ...(e.remindEveryH ? { remindEveryH: e.remindEveryH } : {}),
    };
    await d.send(who, id, signers, key, node);
    return d.reopen(who, id);
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
