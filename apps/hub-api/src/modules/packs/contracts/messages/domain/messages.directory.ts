// CR-190 · danh bạ nhóm trang Tin nhắn — luật thuần (không I/O): dựng dòng cho nhóm «Nội bộ» và «Nhóm chat» từ cuộc của người gọi + đồng nghiệp, sắp xếp, tìm, phân trang bằng con trỏ keyset.
// Nhóm công ty đối tác sắp/phân trang trong DB (hub 0167) cùng KHOÁ (k1, k2, k3, id) nên con trỏ cùng dạng. Thứ tự: ghim (k1=0) → tin mới nhất (k1=1, k2 = −thời điểm) → chưa từng nhắn (k1=2) theo tên A→Z.

/** Khoá sắp xếp một dòng; `k2` là chuỗi số (khớp `numeric` của DB). */
export type DirKey = { k1: number; k2: string; k3: string; id: string };

/** Bỏ dấu + hoa thường (đ → d) để tìm/sắp tên tiếng Việt. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "")
    .replace(new RegExp(String.fromCharCode(0x111), "g"), "d");
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const encodeDirCursor = (k: DirKey): string =>
  Buffer.from(JSON.stringify([k.k1, k.k2, k.k3, k.id])).toString("base64url");
/** Con trỏ hỏng ⇒ null (route trả 400). */
export function decodeDirCursor(s: string): DirKey | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 4) return null;
    const [k1, k2, k3, id] = v;
    return (k1 === 0 || k1 === 1 || k1 === 2) &&
      typeof k2 === "string" &&
      NUM_RE.test(k2) &&
      typeof k3 === "string" &&
      typeof id === "string" &&
      UUID_RE.test(id)
      ? { k1, k2, k3, id }
      : null;
  } catch {
    return null;
  }
}

/** So khoá: k1 số, k2 số thập phân, k3/id theo thứ tự ký tự. */
export function cmpKey(a: DirKey, b: DirKey): number {
  if (a.k1 !== b.k1) return a.k1 - b.k1;
  const d = Number(a.k2) - Number(b.k2);
  if (d !== 0) return d < 0 ? -1 : 1;
  if (a.k3 !== b.k3) return a.k3 < b.k3 ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/** Cuộc nội bộ của người gọi, bản nhẹ (không tin cuối). `last_seq` = 0 ⇒ chưa từng nhắn. */
export type ConvLite = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  peer_id: string | null;
  last_seq: number;
  last_at: string;
  unread: number;
  pinned_at: string | null;
  marked_unread: boolean;
};
export type DirPeople = ReadonlyMap<
  string,
  { name: string; active: boolean; job_title: string | null }
>;
export type DirItem = {
  key: DirKey;
  /** `u:<user>` hoặc `c:<cuộc>`. */
  rowKey: string;
  conv: ConvLite | null;
  personId: string | null;
};

const unreadOf = (c: ConvLite | null): number =>
  c ? Math.max(c.unread, c.marked_unread ? 1 : 0) : 0;
const keyOf = (c: ConvLite | null, name: string, id: string): DirKey => {
  const sent = c !== null && c.last_seq > 0;
  return {
    k1: c?.pinned_at ? 0 : sent ? 1 : 2,
    k2: sent ? String(-Date.parse(c.last_at)) : "0",
    k3: fold(name),
    id,
  };
};

/**
 * Nhóm «Nội bộ»: đồng nghiệp còn dùng được (đúng luật tạo 1-1 hiện có) ∪ đầu kia của cuộc 1-1 ĐÃ CÓ (lịch sử/ghim/cờ vẫn thấy, kể cả người đã nghỉ).
 * Cuộc 1-1 rỗng với người đã nghỉ, người không rõ ⇒ bỏ. Không bao giờ thêm người ngoài luật.
 */
const directByPeer = (convs: readonly ConvLite[]): Map<string, ConvLite> => {
  const m = new Map<string, ConvLite>();
  for (const c of convs) if (c.kind === "direct" && c.peer_id) m.set(c.peer_id, c);
  return m;
};
const hasHistory = (c: ConvLite): boolean =>
  c.last_seq > 0 || c.pinned_at !== null || c.marked_unread;
const matches = (p: { name: string; job_title: string | null }, fq: string): boolean =>
  fq === "" || fold(p.name).includes(fq) || fold(p.job_title ?? "").includes(fq);

export function internalItems(convs: readonly ConvLite[], people: DirPeople, q: string): DirItem[] {
  const byPeer = directByPeer(convs);
  const fq = fold(q);
  const out: DirItem[] = [];
  for (const [id, p] of people) {
    const conv = byPeer.get(id) ?? null;
    const shown = p.active || (conv !== null && hasHistory(conv));
    if (shown && matches(p, fq))
      out.push({ key: keyOf(conv, p.name, id), rowKey: `u:${id}`, conv, personId: id });
  }
  return out.sort((x, y) => cmpKey(x.key, y.key));
}

/** Nhóm «Nhóm chat»: các nhóm người gọi là thành viên (tên không dấu khớp `q`). */
export function chatItems(convs: readonly ConvLite[], q: string): DirItem[] {
  const fq = fold(q);
  return convs
    .filter((c) => c.kind === "group" && (!fq || fold(c.title ?? "").includes(fq)))
    .map((c) => ({
      key: keyOf(c, c.title ?? "", c.id),
      rowKey: `c:${c.id}`,
      conv: c,
      personId: null,
    }))
    .sort((a, b) => cmpKey(a.key, b.key));
}

/** Tổng chưa đọc của nhóm: Σ max(thật, cờ ? 1 : 0) mỗi cuộc, kẹp 999. */
export function unreadSum(items: readonly DirItem[]): number {
  return Math.min(
    items.reduce((n, i) => n + unreadOf(i.conv), 0),
    999,
  );
}

/** Trang kế: bỏ dòng ≤ con trỏ, lấy `limit`; `next` = khoá dòng cuối khi còn nữa. `items` đã sắp. */
export function pageAfter(
  items: readonly DirItem[],
  cursor: DirKey | null,
  limit: number,
): { page: DirItem[]; next: DirKey | null } {
  const rest = cursor ? items.filter((i) => cmpKey(i.key, cursor) > 0) : items;
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  return { page, next: rest.length > limit && last ? last.key : null };
}
