// C1 FE · localStorage an toàn: chế độ riêng tư / chặn site data làm accessor ném lỗi → coi như không có.

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocal(key: string, s: Store | null = store()): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string, s: Store | null = store()): void {
  try {
    s?.setItem(key, value);
  } catch {
    // bỏ qua: không lưu được thì lần sau nhập lại
  }
}
