// CR-121 c11 · Q11 · chế độ xem quy trình: CANVAS (sơ đồ) là mặc định mọi chỗ xem/sửa; danh sách bước dọc là chế độ phụ.
// Nhớ lựa chọn của người dùng trên trình duyệt (localStorage, khoá `processView`); thiếu/lỗi/giá trị lạ ⇒ canvas. Logic thuần (không React).
export type ViewMode = "canvas" | "list";

export const VIEW_MODE_KEY = "processView";
export const DEFAULT_VIEW_MODE: ViewMode = "canvas";

type Store = Pick<Storage, "getItem" | "setItem">;

const browserStore = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // trình duyệt chặn truy cập lưu trữ
  }
};

export function readViewMode(store: Store | null = browserStore()): ViewMode {
  try {
    return store?.getItem(VIEW_MODE_KEY) === "list" ? "list" : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/** Ghi lựa chọn; lỗi ghi (đầy/chặn) bị nuốt — chế độ vẫn đổi trong phiên. */
export function writeViewMode(mode: ViewMode, store: Store | null = browserStore()): void {
  try {
    store?.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* không nhớ được: lần sau về canvas */
  }
}
