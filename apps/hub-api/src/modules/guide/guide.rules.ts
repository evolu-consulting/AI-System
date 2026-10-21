// app-guide · luật thuần (lớp 1): đọc nội dung hướng dẫn (markdown gói sẵn), tìm, lọc theo quyền người gọi. Không I/O, không DB.
// Tệp `content/*.md`: frontmatter (id, title, title_en, audience: all|admin, pack: none|contracts) + các mục `## Tiêu đề`.

export type GuideAudience = "all" | "admin";
export type GuideSection = {
  /** `<tệp>/<slug tiêu đề>` — ổn định, dùng với tham số `id`. */
  id: string;
  doc: string;
  docTitle: string;
  heading: string;
  audience: GuideAudience;
  /** "none" = mọi người; khác = chỉ khi gói đó bật cho người gọi. */
  pack: string;
  keywords: string;
  text: string;
};
export type GuideAccess = { admin: boolean; packs: ReadonlySet<string> };

/** Bỏ dấu tiếng Việt + chữ thường, để "tạo hợp đồng" khớp "tao hop dong". */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();

const slug = (s: string): string =>
  fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function front(raw: string): { meta: Record<string, string>; body: string } {
  const m = FRONT_RE.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Một tệp markdown → các mục (mỗi `## ` một mục). Thiếu `id` ⇒ ném (lỗi đóng gói, bắt ở test). */
export function parseGuideDoc(raw: string): GuideSection[] {
  const { meta, body } = front(raw);
  const doc = meta.id;
  if (!doc) throw new Error("guide doc: thiếu id");
  const audience: GuideAudience = meta.audience === "admin" ? "admin" : "all";
  const pack = meta.pack && meta.pack !== "none" ? meta.pack : "none";
  const out: GuideSection[] = [];
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    out.push({
      id: `${doc}/${slug(heading)}`,
      doc,
      docTitle: meta.title ?? doc,
      heading,
      audience,
      pack,
      keywords: meta.keywords ?? "",
      text: (nl < 0 ? "" : part.slice(nl + 1)).trim(),
    });
  }
  return out;
}

/** Quản trị chỉ cho admin; mục của gói chỉ khi gói đó bật + người gọi đọc được. */
export const allowed = (s: GuideSection, a: GuideAccess): boolean =>
  (s.audience === "all" || a.admin) && (s.pack === "none" || a.packs.has(s.pack));

export const visibleSections = (all: readonly GuideSection[], a: GuideAccess): GuideSection[] =>
  all.filter((s) => allowed(s, a));

const STOP = new Set(
  (
    "la lam sao the nao o dau co de va cho toi minh cua trong khi nhu gi nay do cac mot nhung " +
    "huong dan cach muon can xem how do i to the a an in on of and where what is can"
  ).split(" "),
);

const tokens = (q: string): string[] => {
  const all = fold(q)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length > 0 ? kept : all; // câu chỉ toàn từ dừng vẫn tìm được
};

const count = (hay: string, needle: string): number => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < 5; i = hay.indexOf(needle, i + needle.length))
    n++;
  return n;
};

/** Điểm một mục: tiêu đề (×6) > từ khoá/tên tệp (×3) > nội dung (×1, tối đa 5 lần); cặp từ liền nhau trong tiêu đề +4. */
export function scoreSection(s: GuideSection, toks: readonly string[]): number {
  const h = fold(s.heading);
  const k = fold(`${s.docTitle} ${s.keywords}`);
  const b = fold(s.text);
  let score = 0;
  for (const t of toks) score += (h.includes(t) ? 6 : 0) + (k.includes(t) ? 3 : 0) + count(b, t);
  for (let i = 0; i + 1 < toks.length; i++) if (h.includes(`${toks[i]} ${toks[i + 1]}`)) score += 4;
  return score;
}

/** Tìm trong các mục NGƯỜI GỌI ĐƯỢC THẤY, điểm giảm dần; điểm 0 bị bỏ. */
export function searchGuide(
  all: readonly GuideSection[],
  access: GuideAccess,
  query: string,
  k: number,
): GuideSection[] {
  const toks = tokens(query);
  if (toks.length === 0) return [];
  return visibleSections(all, access)
    .map((s) => ({ s, score: scoreSection(s, toks) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, k))
    .map((x) => x.s);
}

/** Lấy một mục theo id nếu người gọi được thấy; ngược lại `undefined` (không lộ mục bị ẩn). */
export const getSection = (
  all: readonly GuideSection[],
  access: GuideAccess,
  id: string,
): GuideSection | undefined => visibleSections(all, access).find((s) => s.id === id);
