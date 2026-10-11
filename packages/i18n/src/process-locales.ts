// CR-056 · P-a FD3: chuỗi quy trình (`process.<phần>.<tên>`) nạp lười, tách khỏi chuỗi chat/Admin. Mỗi phần một file
// `locales/process/<phần>.{vi,en}.json` (nội dung = cây con của `process.<phần>`); PF chỉ sửa phần của mình.
import type { Locale } from "./locales";

export const PROCESS_LOCALE_PARTS = [
  "common",
  "composer",
  "run",
  "thread",
  "ask",
  "inbox",
  "usage",
  "admin",
  "sources",
  "inputs",
] as const;
export type ProcessLocalePart = (typeof PROCESS_LOCALE_PARTS)[number];
type Tree = Record<string, unknown>;

const LOADERS: Record<Locale, Record<ProcessLocalePart, () => Promise<{ default: Tree }>>> = {
  vi: {
    common: () => import("../locales/process/common.vi.json"),
    composer: () => import("../locales/process/composer.vi.json"),
    run: () => import("../locales/process/run.vi.json"),
    thread: () => import("../locales/process/thread.vi.json"),
    ask: () => import("../locales/process/ask.vi.json"),
    inbox: () => import("../locales/process/inbox.vi.json"),
    usage: () => import("../locales/process/usage.vi.json"),
    admin: () => import("../locales/process/admin.vi.json"),
    sources: () => import("../locales/process/sources.vi.json"),
    inputs: () => import("../locales/process/inputs.vi.json"),
  },
  en: {
    common: () => import("../locales/process/common.en.json"),
    composer: () => import("../locales/process/composer.en.json"),
    run: () => import("../locales/process/run.en.json"),
    thread: () => import("../locales/process/thread.en.json"),
    ask: () => import("../locales/process/ask.en.json"),
    inbox: () => import("../locales/process/inbox.en.json"),
    usage: () => import("../locales/process/usage.en.json"),
    admin: () => import("../locales/process/admin.en.json"),
    sources: () => import("../locales/process/sources.en.json"),
    inputs: () => import("../locales/process/inputs.en.json"),
  },
};

/** Nạp các phần (mặc định tất cả) của một ngôn ngữ và gộp thành `{ process: { <phần>: … } }`. */
export async function loadProcessLocale(
  locale: Locale,
  parts: readonly ProcessLocalePart[] = PROCESS_LOCALE_PARTS,
): Promise<Tree> {
  const loaded = await Promise.all(parts.map((p) => LOADERS[locale][p]()));
  return { process: Object.fromEntries(parts.map((p, i) => [p, loaded[i]?.default ?? {}])) };
}

/** Admin dùng `{x}` thay `{{x}}` (plan-frontend §7 của Admin): đổi cú pháp tham số của cả cây. */
export function toSingleBrace<T>(tree: T): T {
  if (typeof tree === "string") return tree.replace(/\{\{(\w+)\}\}/g, "{$1}") as T;
  if (typeof tree !== "object" || tree === null) return tree;
  return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, toSingleBrace(v)])) as T;
}
