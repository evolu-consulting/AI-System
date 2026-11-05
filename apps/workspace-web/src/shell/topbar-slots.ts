// CR-120 · khe trên thanh trên dùng chung: AppShell (Header) đăng ký phần tử DOM, module Community (chunk lười) vẽ ô tìm kiếm + chuông
// của nó vào đó bằng portal (module không import shell — host cấp `slots` qua configureCommunityHost). Thuần, không React.
export type SlotName = "search" | "bell";

const els: Record<SlotName, HTMLElement | null> = { search: null, bell: null };
const subs = new Set<() => void>();

export const topbarSlots = {
  get: (name: SlotName): HTMLElement | null => els[name],
  set(name: SlotName, el: HTMLElement | null): void {
    if (els[name] === el) return;
    els[name] = el;
    for (const f of subs) f();
  },
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
