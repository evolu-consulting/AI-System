// CR-151e · luật thuần MỘT nguồn cho «Đối tác» (máy chủ `GET /partners/page` và web): dòng điểm đối tác × vai của MỌI engine, huy hiệu
// (MỚI · tạm tính), mức xấu nhất, cờ đỏ, gộp các vai thành MỘT dòng mỗi đối tác, lọc (vai / CHÚ Ý / cờ đỏ), tìm tên, sắp xếp, cắt trang.
import { z } from "zod";
import type { PartnerRole } from "./ledger";
import type { PartnerRow, ScoreBand } from "./partners";
import { REP_ROLES, type RepPartnerRow, type RepRole } from "./reputation";

/** Dòng điểm đối tác × vai của MỌI engine: HD8 (`PartnerRow`) hoặc V2-E (`RepPartnerRow` đã quy đổi, thêm vai bên trả hoa hồng). */
export type ScoreRow = Omit<PartnerRow, "role" | "roles"> & {
  role: RepRole;
  roles?: PartnerRole[];
};

/** `none` = chưa có việc nào ("– · Chưa đủ dữ liệu"); `new` = có điểm tạm (MỚI · tạm tính). */
export type Level = ScoreBand | "new" | "none";
type Scored = Pick<PartnerRow, "score" | "band" | "provisional" | "provisional_score">;
export type Badge = { level: Level; shown: number | null; provisional: boolean };

export function badgeOf(r: Scored): Badge {
  if (r.score !== null && r.band) return { level: r.band, shown: r.score, provisional: false };
  if (r.provisional) return { level: "new", shown: r.provisional_score ?? null, provisional: true };
  return { level: "none", shown: null, provisional: false };
}

const RANK: Record<Level, number> = { watch: 0, fair: 1, good: 2, new: 3, none: 4 };
export const worstOf = (rows: readonly Scored[]): Level =>
  rows.reduce<Level>((w, r) => {
    const l = badgeOf(r).level;
    return RANK[l] < RANK[w] ? l : w;
  }, "none");

export type FlagType = NonNullable<PartnerRow["red_flags"]>[number]["type"];
export type Flag = { type: FlagType; n: number };

/** Cờ đỏ gộp mọi vai (cùng loại cộng số lần). */
export function flagsOf(rows: readonly Pick<PartnerRow, "red_flags">[]): Flag[] {
  const by = new Map<FlagType, number>();
  for (const r of rows)
    for (const f of r.red_flags ?? []) by.set(f.type, (by.get(f.type) ?? 0) + f.n);
  return [...by].map(([type, n]) => ({ type, n }));
}

const BANDS: readonly ScoreBand[] = ["good", "fair", "watch"];
/** Một dòng `/reputation/partners` ⇒ dòng chung: mức MỚI có điểm ⇒ "MỚI · tạm tính", không điểm ⇒ "–"; cờ đỏ giữ nguyên (tách khỏi điểm). */
export function fromRep(r: RepPartnerRow): ScoreRow {
  const band = BANDS.find((b) => b === r.level) ?? null;
  const fresh = r.level === "new";
  return {
    party: r.party,
    name: r.name,
    role: r.role,
    score: band ? r.score : null,
    band,
    reason: "",
    event_count: r.jobs,
    adjust: 0,
    contracts: 0,
    provisional: fresh && r.score !== null,
    provisional_score: fresh ? r.score : null,
    red_flag: r.red_flag === true,
    ...(r.red_flags ? { red_flags: r.red_flags } : {}),
  };
}

export type PartyItem = {
  party: string;
  name: string;
  roles: ScoreRow[];
  contracts: number;
  worst: Level;
  red_flag: boolean;
  red_flags: Flag[];
};

const ROLE_ORDER: readonly RepRole[] = REP_ROLES;
const byName = (a: PartyItem, b: PartyItem) => a.name.localeCompare(b.name, "vi");
const byAttention = (a: PartyItem, b: PartyItem) =>
  Number(b.red_flag) - Number(a.red_flag) || byName(a, b);

/** Một dòng mỗi đối tác (gộp vai), cờ đỏ trước rồi tên; `contracts` = 0 (số HĐ gắn sau theo trang — `withContracts`). */
export function partiesOf(
  rows: readonly ScoreRow[] | undefined,
  counts: ReadonlyMap<string, number> = new Map(),
): PartyItem[] {
  const by = new Map<string, ScoreRow[]>();
  for (const r of rows ?? []) by.set(r.party, [...(by.get(r.party) ?? []), r]);
  const items = [...by].map(([party, rs]) => {
    const roles = [...rs].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    return {
      party,
      name: roles[0]?.name ?? party,
      roles,
      contracts: counts.get(party) ?? 0,
      worst: worstOf(roles),
      red_flag: roles.some((r) => r.red_flag === true),
      red_flags: flagsOf(roles),
    };
  });
  return items.sort(byAttention);
}

// ---------- CR-151e · trang đối tác phía máy chủ ----------
export const PARTY_PAGE_DEFAULT = 20;
/** Trần `limit` (CONVENTIONS §6: tối đa 200); vượt ⇒ 400, KHÔNG cắt im lặng. */
export const PARTY_PAGE_MAX = 200;
export const PARTY_FILTERS = ["all", ...REP_ROLES, "watch", "flag"] as const;
export type PartyFilter = (typeof PARTY_FILTERS)[number];
/** `attention` = cờ đỏ trước rồi tên (mặc định); `score_asc`/`score_desc` theo điểm THẤP NHẤT các vai (chưa có điểm ⇒ cuối). */
export const PARTY_SORTS = ["attention", "name", "score_asc", "score_desc"] as const;
export type PartySort = (typeof PARTY_SORTS)[number];

export const PartyPageQuerySchema = z.strictObject({
  filter: z.enum(PARTY_FILTERS).default("all"),
  sort: z.enum(PARTY_SORTS).default("attention"),
  q: z
    .string()
    .max(100)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(PARTY_PAGE_MAX).default(PARTY_PAGE_DEFAULT),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PartyPageQuery = z.output<typeof PartyPageQuerySchema>;
/** `total` = số đối tác khớp lọc/tìm; `next_offset` null = hết. */
export type PartyPage = { items: PartyItem[]; total: number; next_offset: number | null };

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/** Lọc theo vai / CHÚ Ý / cờ đỏ; tìm: mọi từ của `q` có trong tên (không dấu, không phân biệt hoa thường). */
export function filterParties(
  items: readonly PartyItem[],
  filter: PartyFilter,
  q: string | undefined,
): PartyItem[] {
  const words = fold(q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return items.filter((p) => {
    const ok =
      filter === "all"
        ? true
        : filter === "watch"
          ? p.worst === "watch"
          : filter === "flag"
            ? p.red_flag
            : p.roles.some((r) => r.role === filter);
    if (!ok) return false;
    if (!words.length) return true;
    const h = fold(p.name);
    return words.every((w) => h.includes(w));
  });
}

/** Điểm thấp nhất các vai có điểm thật; không vai nào có ⇒ null. */
export const lowestScore = (p: PartyItem): number | null => {
  const s = p.roles.map((r) => r.score).filter((x): x is number => x !== null);
  return s.length ? Math.min(...s) : null;
};

export function sortParties(items: readonly PartyItem[], sort: PartySort): PartyItem[] {
  const out = [...items];
  if (sort === "attention") return out.sort(byAttention);
  if (sort === "name") return out.sort(byName);
  const dir = sort === "score_asc" ? 1 : -1;
  return out.sort((a, b) => {
    const x = lowestScore(a);
    const y = lowestScore(b);
    if (x === null || y === null)
      return Number(x === null) - Number(y === null) || byAttention(a, b);
    return (x - y) * dir || byAttention(a, b);
  });
}

/** Lát cắt trang đã lọc + sắp: `total`, `next_offset` (null khi hết). */
export function pageParties(
  sorted: readonly PartyItem[],
  limit: number,
  offset: number,
): PartyPage {
  const items = sorted.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, total: sorted.length, next_offset: end < sorted.length ? end : null };
}
