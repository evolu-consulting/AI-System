// R1 · port phần thuần của mgmt-app `ingest/extract.py` (đồ thị từ đoạn), `ingest/resolve.py` (bí danh thực thể) và
// `query/similar.py` (đoạn giống / mâu thuẫn). Khác bản gốc (không embedding — chưa có OPENAI key, ADR-0021 (c)): ứng viên bí
// danh = cùng loại + cùng "dạng so khớp" (bỏ dấu, chữ thường, bỏ danh từ chung đầu tên, tập từ không thứ tự); độ giống đoạn =
// cosine trên tập từ đã gấp dấu. LLM (trích/so bí danh/phán mâu thuẫn) đi qua port; bản giả tất định ở đây (`fake*`).

export const ENTITY_TYPES = [
  "Person",
  "Project",
  "Team",
  "Product",
  "Concept",
  "Decision",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type Entity = { name: string; type: EntityType };
export type Relation = { src: string; dst: string; type: string };
export type Extraction = { entities: Entity[]; relations: Relation[] };
export type Verdict = { verdict: "DUPLICATE" | "CONFLICT" | "RELATED"; reason: string };

export const EXTRACT_LIMITS = {
  nameMax: 120,
  perChunk: 40,
  relType: /^[A-Z][A-Z_]{1,39}$/,
  /** Cosine tập từ tối thiểu để là SIMILAR (mgmt-app `similar_threshold` cho embedding ~0,8; tập từ thưa hơn). */
  similar: 0.5,
  /** Chỉ cặp gần trùng mới đưa LLM phán mâu thuẫn (trần chi phí; mgmt-app phán khi chung thực thể). */
  judge: 0.7,
  neighbours: 6,
  judgeMax: 10,
  aliasMax: 10,
  /** F-08: trần số cặp thử (gồm cặp LLM bác), không chỉ số bí danh thêm được. */
  aliasTryMax: 30,
} as const;

/** `Entity.key` của mgmt-app: `Type:tên thường`. */
export const entityKey = (e: Entity): string => `${e.type}:${e.name.trim().toLowerCase()}`;

/** Khoá cặp bí danh (key a, key b) trong tập trả về của `IngestReadRepo.aliasedPairs`. */
export const aliasPairKey = (a: string, b: string): string => `${a}\u0000${b}`;

/** `match_form`: bỏ dấu (NFD), chữ thường, trim — "đ" giữ nguyên như bản gốc. */
export function matchForm(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

const LEAD_NOUNS = ["nhom", "du an", "phong", "cong ty", "team", "project"];

/** Dạng so bí danh: tập từ (đã sắp) sau khi bỏ danh từ chung đầu tên ("nhóm", "dự án", "phòng", "công ty"). */
export function aliasForm(name: string): string {
  let f = matchForm(name).replace(/đ/g, "d");
  for (const n of LEAD_NOUNS) if (f.startsWith(`${n} `)) f = f.slice(n.length + 1);
  return (f.match(/[\p{L}\p{N}]+/gu) ?? []).sort().join(" ");
}

export type AliasTry = { a: string; b: string; type: string; aName: string; bName: string };

/**
 * F-08 · `link_aliases` (thuần): thực thể mới (không trùng key) × ứng viên đã có cùng loại + cùng `aliasForm`, khác key — tra
 * bằng Map (type, dạng so), không quét lồng; ≤ 1 cặp mỗi thực thể, ≤ `max` cặp (trần lần thử, gồm cả cặp sau đó bị bác).
 */
export function aliasTries(
  ents: readonly Entity[],
  cands: readonly { key: string; name: string; type: string }[],
  max: number = EXTRACT_LIMITS.aliasTryMax,
): AliasTry[] {
  const idx = new Map<string, { key: string; name: string }[]>();
  for (const c of cands) {
    const k = `${c.type}\u0000${aliasForm(c.name)}`;
    idx.set(k, [...(idx.get(k) ?? []), c]);
  }
  const out: AliasTry[] = [];
  const seen = new Set<string>();
  for (const e of ents) {
    const a = entityKey(e);
    if (out.length >= max || seen.has(a)) continue;
    seen.add(a);
    const f = aliasForm(e.name);
    const c = f === "" ? undefined : idx.get(`${e.type}\u0000${f}`)?.find((x) => x.key !== a);
    if (c) out.push({ a, b: c.key, type: e.type, aName: e.name, bName: c.name });
  }
  return out;
}

const isType = (t: unknown): t is EntityType => ENTITY_TYPES.includes(t as EntityType);
const cleanName = (n: unknown): string | null =>
  typeof n === "string" && n.trim() !== "" ? n.trim().slice(0, EXTRACT_LIMITS.nameMax) : null;

/** JSON trả về của LLM ⇒ Extraction sạch: loại hợp lệ, tên ≤ 120, quan hệ chỉ giữa thực thể đã trả, kiểu UPPER_SNAKE. */
export function parseExtraction(raw: unknown): Extraction {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const ents: Entity[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(o.entities) ? o.entities : []) {
    const r = (e ?? {}) as Record<string, unknown>;
    const name = cleanName(r.name);
    if (!name || !isType(r.type) || ents.length >= EXTRACT_LIMITS.perChunk) continue;
    const ent = { name, type: r.type };
    if (seen.has(entityKey(ent))) continue;
    seen.add(entityKey(ent));
    ents.push(ent);
  }
  const names = new Set(ents.map((e) => e.name));
  const rels = (Array.isArray(o.relations) ? o.relations : []).flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const ok =
      names.has(r.src as string) && names.has(r.dst as string) && typeof r.type === "string";
    return ok && EXTRACT_LIMITS.relType.test(r.type as string)
      ? [{ src: r.src as string, dst: r.dst as string, type: r.type as string }]
      : [];
  });
  return { entities: ents, relations: rels.slice(0, EXTRACT_LIMITS.perChunk) };
}

/** JSON đầu tiên trong câu trả lời văn bản (LLM có thể bọc ```json). Không có ⇒ null. */
export function firstJson(text: string): unknown {
  const m = /[{[][\s\S]*[}\]]/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** `_fake_extract`: từ viết hoa ≥ 4 chữ ⇒ Concept; cặp "Hoa Hoa" ⇒ Person. */
export function fakeExtract(text: string): Extraction {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const names = uniq(text.match(/\b\p{Lu}\p{Ll}{3,}\b/gu) ?? []);
  const people = uniq(text.match(/\b\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+\b/gu) ?? []);
  return parseExtraction({
    entities: [
      ...names.map((name) => ({ name, type: "Concept" })),
      ...people.map((name) => ({ name, type: "Person" })),
    ],
    relations: [],
  });
}

/** `confirm_alias` giả: cùng tập từ (bỏ dấu, không thứ tự). */
export const fakeSameEntity = (a: string, b: string): boolean => aliasForm(a) === aliasForm(b);

/** `judge_similar` giả: giống hệt ⇒ DUPLICATE, khác ⇒ CONFLICT (như fake_llm của mgmt-app). */
export const fakeJudge = (a: string, b: string): Verdict =>
  a.trim() === b.trim()
    ? { verdict: "DUPLICATE", reason: "identical text" }
    : { verdict: "CONFLICT", reason: "fake judge: texts differ" };

/** Tập từ đã gấp dấu (≥ 2 ký tự) của một đoạn. */
export function tokenSet(text: string): Set<string> {
  return new Set(
    (matchForm(text).match(/[\p{L}\p{N}]{2,}/gu) ?? []).map((w) => w.replace(/đ/g, "d")),
  );
}

/** Cosine của hai tập (|A∩B| / √(|A|·|B|)). */
export function cosineSets(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.sqrt(a.size * b.size);
}

export type SimChunk = { id: string; docId: string; body: string };
export type SimPair = { a: string; b: string; score: number; aText: string; bText: string };

/** `neighbours` + `link_similar` (phần thuần): mỗi đoạn mới ⇒ ≤ k đoạn của TÀI LIỆU KHÁC có cosine ≥ ngưỡng, tốt nhất trước. */
export function similarPairs(
  fresh: readonly SimChunk[],
  others: readonly SimChunk[],
  threshold: number = EXTRACT_LIMITS.similar,
  k: number = EXTRACT_LIMITS.neighbours,
): SimPair[] {
  const sets = new Map(others.map((o) => [o.id, tokenSet(o.body)]));
  return fresh.flatMap((c) => {
    const mine = tokenSet(c.body);
    return others
      .filter((o) => o.docId !== c.docId)
      .map((o) => ({
        a: c.id,
        b: o.id,
        score: cosineSets(mine, sets.get(o.id) as Set<string>),
        aText: c.body,
        bText: o.body,
      }))
      .filter((p) => p.score >= threshold)
      .sort((x, y) => y.score - x.score || x.b.localeCompare(y.b))
      .slice(0, k);
  });
}

/** Từ khoá đại diện tài liệu để dò ứng viên giống (tần suất cao, ≥ 4 ký tự), tối đa `n`. */
export function docProbeTerms(texts: readonly string[], n = 12): string[] {
  const freq = new Map<string, number>();
  for (const t of texts)
    for (const w of matchForm(t).match(/[\p{L}\p{N}]{4,}/gu) ?? [])
      freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}
