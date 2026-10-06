// HUB-FR-72 · khởi động an toàn: thiếu bản dịch (chunk lỗi/mất mạng) → màn lỗi tối giản, không trang trắng.
import { i18n, initI18n, NAMESPACE } from "./i18n";

export function hasTranslations(lng: string = i18n.language): boolean {
  return i18n.hasResourceBundle(lng, NAMESPACE);
}

/** Màn lỗi cứng song ngữ (miễn i18n) + nút tải lại; DOM thuần, không phụ thuộc CSS bundle. */
export function renderBootError(el: HTMLElement): void {
  el.replaceChildren();
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "max-width:420px;margin:15vh auto;padding:24px;font-family:system-ui,sans-serif;text-align:center";
  const p = document.createElement("p");
  p.textContent =
    "Không tải được giao diện. Kiểm tra kết nối rồi thử lại. / Could not load the app. Check your connection and try again.";
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Tải lại / Reload";
  b.style.cssText = "margin-top:16px;padding:8px 16px;cursor:pointer";
  b.addEventListener("click", () => location.reload());
  box.append(p, b);
  el.append(box);
}

export async function boot(
  onReady: () => void,
  onFail: () => void,
  init: () => Promise<unknown> = initI18n,
  has: () => boolean = hasTranslations,
): Promise<void> {
  try {
    await init();
  } catch (err) {
    console.error("[boot] initI18n failed", err);
    onFail();
    return;
  }
  if (has()) onReady();
  else onFail();
}
