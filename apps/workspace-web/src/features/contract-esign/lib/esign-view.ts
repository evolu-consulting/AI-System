// cf-esign-docusign · luật thuần khối "Ký số" ở chi tiết HĐ: chế độ hiển thị + nút được bấm theo trạng thái + quyền.
import {
  type ESignEnvelopeOut,
  type ESignProviderOut,
  type ESignStateOut,
  esignLabelKey,
} from "@ai/contracts/pack-contracts";

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
  canDownload: boolean;
  demo: boolean;
  /** CR-125 · x2 · mode "pending": người ký tiếp theo CHƯA ký (tên) khi người xem KHÔNG phải người ký ⇒ "Đang chờ <tên> ký" không nút. */
  waitingFor: string | null;
  /** CR-125 · x2 · hạn ký của phong bì (ISO) — banner "Đến lượt bạn ký — hạn …". */
  dueAt: string | null;
};

const none: Omit<EsignView, "mode"> = {
  canSend: false,
  canSignNow: false,
  canCancel: false,
  canDownload: false,
  demo: false,
  waitingFor: null,
  dueAt: null,
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
  if (e && (e.status === "sent" || e.status === "delivered")) {
    // CR-125 · x2 · lượt của người xem: có người ký nội bộ chưa ký ⇒ MỘT banner + MỘT nút "Ký ngay"; người khác ⇒ "Đang chờ <tên> ký", không nút.
    const known = e.signers.some((x) => x.is_you !== undefined);
    // CR-125 · cùng luật server (`isTurnOf`): chưa ký VÀ mọi người `order` nhỏ hơn đã ký ⇒ mới có nút "Ký ngay".
    const mine =
      o.write &&
      e.signers.some(
        (x) =>
          (known ? x.is_you === true : x.embedded) &&
          !hasSigned(x) &&
          e.signers.every((p) => p.order >= x.order || hasSigned(p)),
      );
    return {
      ...none,
      mode: "pending",
      demo,
      canSignNow: mine,
      canCancel: o.write,
      dueAt: e.due_at ?? null,
      waitingFor: mine ? null : (nextSigner(e)?.name ?? null),
    };
  }
  if (e?.status === "completed")
    return {
      ...none,
      mode: "signed",
      demo,
      canDownload: e.has_signed_file,
    };
  return idleView(s, o.write, e !== null, demo);
}

/** Cùng định nghĩa "đã ký" với hub (`isSigned`): có mốc `signed_at` HOẶC trạng thái người ký completed/signed. */
const hasSigned = (x: { signed_at: string | null; status: string | null }): boolean =>
  x.signed_at !== null || ["completed", "signed"].includes((x.status ?? "").toLowerCase());

/** Người ký kế tiếp chưa ký (theo thứ tự). */
const nextSigner = (e: ESignEnvelopeOut) =>
  [...e.signers].sort((a, b) => a.order - b.order).find((x) => !hasSigned(x));

/** Chưa gửi / bị từ chối / bị huỷ: gửi (lại) được khi đủ cấu hình + bật + HĐ sẵn sàng + quyền ghi. */
function idleView(s: ESignStateOut, write: boolean, had: boolean, demo: boolean): EsignView {
  if (!s.configured) return { ...none, mode: "unconfigured" };
  const block: EsignMode | null = !s.enabled ? "disabled" : !s.ready ? "notReady" : null;
  if (block) return { ...none, mode: had ? "failed" : block, demo };
  return { ...none, mode: had ? "failed" : "send", demo, canSend: write };
}

/** Khoá i18n của dòng trạng thái / gợi ý. */
export function statusKey(v: EsignView, status: string | undefined): string | null {
  if (v.mode === "pending") return esignLabelKey("sent");
  if (v.mode === "signed") return "contracts.esign.signedAt"; // = nhãn `signed` kèm thời điểm
  if (status === "declined" || status === "voided") return esignLabelKey(status);
  return null;
}
const HINT: Partial<Record<EsignMode, string>> = {
  unconfigured: "contracts.esign.notConfigured",
  disabled: "contracts.esign.notEnabled",
  notReady: "contracts.esign.notReady",
};
export const hintKey = (v: EsignView): string | null => HINT[v.mode] ?? null;

/** esign-multi · nhà cung cấp chọn được (khả dụng). */
export function availableProviders(providers: ESignProviderOut[] | undefined): ESignProviderOut[] {
  return (providers ?? []).filter((p) => p.available);
}

/** Dropdown chọn nhà cung cấp ở hộp Gửi ký chỉ hiện khi có > 1 nhà cung cấp khả dụng. */
export const showProviderPicker = (providers: ESignProviderOut[] | undefined): boolean =>
  availableProviders(providers).length > 1;

/** Nhà cung cấp chọn sẵn: mặc định hiệu lực nếu còn khả dụng, không thì khả dụng đầu tiên, không có ⇒ "". */
export function pickDefaultProvider(
  providers: ESignProviderOut[] | undefined,
  def: string | null | undefined,
): string {
  const av = availableProviders(providers);
  return av.find((p) => p.key === def)?.key ?? av[0]?.key ?? "";
}

/** Mã lỗi ký số có thông báo riêng (còn lại ⇒ "unknown"). */
export const ESIGN_ERR_CODES = new Set([
  "ESIGN_DISABLED",
  "ESIGN_STATE",
  "ESIGN_UNSUPPORTED_FILE",
  "ESIGN_PROVIDER",
  "ESIGN_PROVIDER_UNAVAILABLE",
  "ESIGN_RESEND_FAILED",
  "ESIGN_SIGNER_NO_EMAIL",
  "ESIGN_NOT_SIGNER",
  "ESIGN_NOT_YOUR_TURN",
]);
export const esignErrKey = (code: string | undefined | null): string =>
  `contracts.esign.err.${code && ESIGN_ERR_CODES.has(code) ? code : "unknown"}`;

/** Bỏ `?esign=return` (DocuSign/ký thử quay về) khỏi URL sau khi đã làm mới một lần. */
/**
 * Trang quay về sau khi ký: ĐÚNG trang chi tiết HĐ `/contracts/c/<id>` (CR-119). Đường cũ `/contracts/<id>` chuyển hướng làm mất
 * `?esign=return` ⇒ không tự làm mới ⇒ ký xong vẫn thấy "Ký ngay", bước kế không chạy (CR-122, phát hiện khi quay demo).
 */
export const signReturnUrl = (origin: string, id: string): string =>
  `${origin}/contracts/c/${encodeURIComponent(id)}`;

/**
 * CR-125 · `?ky=1` từ thư "Mời ký" KHÔNG BAO GIỜ hoàn tất chữ ký khi chưa có cú bấm của người dùng:
 * - `open`: đúng lượt + chưa ký + `sign-url` chỉ trả đường dẫn sang trang ký của nhà cung cấp (DocuSign — người dùng còn ký ở đó) ⇒ tự mở;
 * - `focus`: đúng lượt nhưng `sign-url` tự hoàn tất ký (ký thử / CA) ⇒ chỉ cuộn tới + nhấn mạnh nút "Ký ngay";
 * - `none`: không có `ky`, chưa đến lượt (theo thứ tự ký), hoặc đã ký ⇒ trang thường.
 */
export type AutoSign = "open" | "focus" | "none";
export const decideAutoSign = (i: {
  ky: boolean;
  myTurn: boolean;
  signed: boolean;
  redirectsToProvider: boolean;
}): AutoSign => {
  if (!i.ky || !i.myTurn || i.signed) return "none";
  return i.redirectsToProvider ? "open" : "focus";
};

/** Nhà cung cấp của phong bì đang mở chỉ chuyển người dùng sang trang ký của họ? (vắng cờ ⇒ false, an toàn). */
export const redirectsToProvider = (s: ESignStateOut): boolean =>
  s.providers?.find((p) => p.key === s.envelope?.provider)?.redirects_to_provider === true;

export const hasSignIntent = (search: string): boolean =>
  new URLSearchParams(search).get("ky") === "1";

export function returnedFromSigning(search: string): boolean {
  return new URLSearchParams(search).get("esign") === "return";
}

/**
 * CR-125 · quay về từ trang ký ⇒ hỏi hub làm mới phong bì từ nhà cung cấp MỘT lần. Tin hiệu: `?esign=return` HOẶC cờ "vừa rời đi ký"
 * (đặt lúc bấm Ký ngay) — đường quay về mất tham số (đăng nhập lại, chuyển hướng, nút Back) vẫn làm mới.
 */
export const shouldRefreshOnReturn = (search: string, leftToSign: boolean): boolean =>
  returnedFromSigning(search) || leftToSign;

/**
 * CR-125 · `?ky=1`: mở thẳng trang ký bằng cách ký của phong bì (hoặc mặc định công ty) — KHÔNG hỏi "Chọn cách ký" dù có nhiều nhà cung cấp.
 * Chỉ khi chưa có cách nào xác định (null) người dùng mới phải chọn.
 */
export const autoSignProvider = (s: ESignStateOut): string | null =>
  s.envelope?.provider ?? s.default_provider ?? s.provider ?? null;
