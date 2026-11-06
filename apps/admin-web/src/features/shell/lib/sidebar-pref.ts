// CR-121 f11 · trạng thái mở/thu gọn thanh bên: NHỚ theo lần bấm gần nhất (localStorage), mọi trang như nhau (không tự mở/thu theo trang).
// Kho bị chặn/lỗi ⇒ mặc định mở, không ném lỗi.
export const SIDEBAR_KEY = "ai.sidebarCollapsed";

type Store = Pick<Storage, "getItem" | "setItem">;
const browser = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function readCollapsed(store: Store | null = browser()): boolean {
  try {
    return store?.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed: boolean, store: Store | null = browser()): void {
  try {
    store?.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* không nhớ được: lần sau mở */
  }
}
