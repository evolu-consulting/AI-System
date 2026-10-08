// [CR-052] Mặc định EN toàn hệ thống, không dò ngôn ngữ trình duyệt → trang chưa đăng nhập luôn render EN.
// Các e2e kiểm chữ tiếng Việt chọn VI tường minh bằng cách seed localStorage (đúng thứ người dùng lưu khi bấm "Tiếng Việt")
// qua `use.storageState` trong config Playwright; context tạo bằng `browser.newContext()` thừa hưởng. Khoá lưu: admin-web/chat-web
// `ai.locale`, studio-web `studio.locale`. Sau đăng nhập app đổi theo user.locale nên user fixture phải có locale 'vi'.
export const LOCALE_KEYS = ["ai.locale", "studio.locale"] as const;

export function viStorageState(origins: string[]) {
  return {
    cookies: [],
    origins: origins.map((origin) => ({
      origin: new URL(origin).origin,
      localStorage: LOCALE_KEYS.map((name) => ({ name, value: "vi" })),
    })),
  };
}
