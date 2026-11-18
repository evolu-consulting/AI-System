// CR-182 · bước Ký «theo vai» chỉ chạy khi công ty BẬT ký trên tài liệu (`on_doc_enabled`, Cài đặt › Chữ ký). Công ty TẮT ⇒ giữ cách cũ
// («Ký qua» + người ký công ty): không tự gán vai cho bước mới, ẩn «Chuyển sang vai», cảnh báo bước đã chỉ còn vai. Thuần.
import type { EsignNodeConfig } from "@ai/contracts/pack-contracts";

export type EsignRoleUi = {
  /** Bước Ký mới (chưa vai, chưa cấu hình cũ) tự nhận vai mặc định. */
  autoRole: boolean;
  /** Hiện nút «Chuyển sang vai» (cấu hình cũ, công ty đã bật). */
  canSwitch: boolean;
  /** Bước chỉ có vai (không «Ký qua») mà công ty tắt ⇒ lượt sẽ kẹt: báo ngay ở panel. */
  blocked: boolean;
};

/** `onDoc` undefined = chưa biết (options chưa tải / API cũ) ⇒ giữ cách cũ. */
export function esignRoleUi(
  c: Pick<EsignNodeConfig, "provider" | "company_signers" | "signer_role">,
  onDoc: boolean | undefined,
): EsignRoleUi {
  const legacy = !!c.provider || !!c.company_signers?.length;
  return {
    autoRole: onDoc === true && !c.signer_role && !legacy,
    canSwitch: onDoc === true && legacy && !c.signer_role,
    blocked: onDoc === false && !!c.signer_role && !c.provider,
  };
}
