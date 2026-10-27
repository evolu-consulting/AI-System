// cf-esign-docusign · luật thuần khối "Ký số" ở chi tiết HĐ: chế độ hiển thị + nút được bấm theo trạng thái + quyền.
import type { ESignStateOut } from "@ai/contracts";

export type EsignMode =
  | "hidden"
  | "unconfigured"
  | "disabled"
  | "notReady"
  | "send"
  | "pending"
  | "signed"
  | "failed";

export type EsignView = {
  mode: EsignMode;
  canSend: boolean;
  canSignNow: boolean;
  canCancel: boolean;
  canRefresh: boolean;
  canDownload: boolean;
  demo: boolean;
};

const none: Omit<EsignView, "mode"> = {
  canSend: false,
  canSignNow: false,
  canCancel: false,
  canRefresh: false,
  canDownload: false,
  demo: false,
};

/** `locked` = HĐ đã duyệt xong (khoá). Chưa khoá và chưa từng gửi ⇒ ẩn khối. */
export function esignView(
  s: ESignStateOut | undefined,
  o: { locked: boolean; write: boolean },
): EsignView {
  if (!s) return { mode: "hidden", ...none };
  const e = s.envelope;
  if (!e && !o.locked) return { mode: "hidden", ...none };
  const demo = e?.demo ?? s.demo;
  if (e && (e.status === "sent" || e.status === "delivered"))
    return {
      ...none,
      mode: "pending",
      demo,
      canRefresh: true,
      canSignNow: o.write && e.signers.some((x) => x.embedded && x.signed_at === null),
      canCancel: o.write,
    };
  if (e?.status === "completed")
    return {
      ...none,
      mode: "signed",
      demo,
      canDownload: e.has_signed_file,
      canRefresh: !e.has_signed_file,
    };
  return idleView(s, o.write, e !== null, demo);
}

/** Chưa gửi / bị từ chối / bị huỷ: gửi (lại) được khi đủ cấu hình + bật + HĐ sẵn sàng + quyền ghi. */
function idleView(s: ESignStateOut, write: boolean, had: boolean, demo: boolean): EsignView {
  if (!s.configured) return { ...none, mode: "unconfigured" };
  const block: EsignMode | null = !s.enabled ? "disabled" : !s.ready ? "notReady" : null;
  if (block) return { ...none, mode: had ? "failed" : block, demo };
  return { ...none, mode: had ? "failed" : "send", demo, canSend: write };
}

/** Khoá i18n của dòng trạng thái / gợi ý. */
export function statusKey(v: EsignView, status: string | undefined): string | null {
  if (v.mode === "pending") return "contracts.esign.pending";
  if (v.mode === "signed") return "contracts.esign.signedAt";
  if (status === "declined") return "contracts.esign.declined";
  if (status === "voided") return "contracts.esign.voided";
  return null;
}
const HINT: Partial<Record<EsignMode, string>> = {
  unconfigured: "contracts.esign.notConfigured",
  disabled: "contracts.esign.notEnabled",
  notReady: "contracts.esign.notReady",
};
export const hintKey = (v: EsignView): string | null => HINT[v.mode] ?? null;

/** Bỏ `?esign=return` (DocuSign/ký thử quay về) khỏi URL sau khi đã làm mới một lần. */
export function returnedFromSigning(search: string): boolean {
  return new URLSearchParams(search).get("esign") === "return";
}
