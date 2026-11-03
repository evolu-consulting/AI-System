// CR-112 · ADM-FR-76 · công ty platform_admin chọn gần nhất (id): route cũ `/users`, `/groups`… chuyển tới workspace của công ty này.
const KEY = "ai.lastTenant";

type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function getLastTenant(store: Store | undefined = defaultStore()): string | undefined {
  try {
    return store?.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setLastTenant(id: string, store: Store | undefined = defaultStore()): void {
  try {
    store?.setItem(KEY, id);
  } catch {
    // Chế độ riêng tư / bị chặn: bỏ qua, chỉ mất tiện ích "nhớ công ty".
  }
}
