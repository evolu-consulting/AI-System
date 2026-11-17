// CR-181 · s4 · luật thuần của màn chặn + mục menu (Q5, Q10): chỉ chặn khi công ty bật và API nói cần tạo.
import type { MySignatureView, SignatureSettings } from "@ai/contracts/signature";
import type { CaptionFields, Method } from "./signature-image";

const LATER_KEY = "sig.later";

/** Chặn chỉ khi `needs_create`, chưa chọn «Làm sau» (chỉ được khi không bắt buộc). API lỗi / chưa tải ⇒ không chặn. */
export function shouldBlock(view: MySignatureView | undefined, later: boolean): boolean {
  if (!view?.needs_create) return false;
  return view.settings.required ? true : !later;
}

export const showMenu = (view: MySignatureView | undefined): boolean =>
  view?.settings.on_doc_enabled === true;

/** Bước đầu: chữ ký chính nếu chưa có (hoặc cách tạo cũ đã bị bỏ); còn lại là chữ ký tắt. */
export function firstStep(view: MySignatureView): "main" | "initials" {
  const ok = view.main && view.settings.methods.includes(view.main.method);
  return ok ? "initials" : "main";
}

export const needsInitialsAfterMain = (s: SignatureSettings): boolean => s.initials === "own";

export const captionFields = (s: SignatureSettings): CaptionFields => ({
  name: s.caption.includes("name"),
  title: s.caption.includes("title"),
  date: s.caption.includes("date"),
  time: s.caption.includes("time"),
});

export const methodsOf = (s: SignatureSettings): Method[] => s.methods;

/** «Làm sau» nhớ trong phiên trình duyệt này. */
export const readLater = (): boolean => {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
};
export const writeLater = (): void => {
  try {
    sessionStorage.setItem(LATER_KEY, "1");
  } catch {
    /* không có sessionStorage: chỉ mất nhớ */
  }
};
