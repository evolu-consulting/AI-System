// CR-122 · E1b · luật THUẦN: stage của flow Thư viện trỏ Group theo MÃ (`group_key`, `also_group_keys`, answerer/escalate `group_key`)
// ⇒ đổi sang id Group của công ty lúc mở lượt (giữ luật "mã Group → id theo tenant"). Thiếu mã ⇒ `missing` (lượt bị từ chối, nêu mã).
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mọi mã Group mà stages tham chiếu (để đọc id MỘT câu). */
export function groupKeysOf(stages: readonly unknown[]): string[] {
  const out = new Set<string>();
  const one = (o: unknown) => {
    if (isObj(o) && typeof o.group_key === "string") out.add(o.group_key);
  };
  for (const s of stages) {
    if (!isObj(s)) continue;
    one(s.after);
    one(s.answerer);
    if (isObj(s.after)) {
      one(s.after.escalate);
      const also = (s.after.also_group_keys as unknown[] | undefined) ?? [];
      // CR-125 · «A + B cùng duyệt»: nhóm của `parallel` cũng là nhóm duyệt
      for (const k of [...also, ...parallelGroupsOf(s.after).map(keyOf)])
        if (typeof k === "string") out.add(k);
    }
  }
  return [...out];
}

const keyOf = (g: unknown): unknown => (isObj(g) ? g.group_key : undefined);

/** CR-125 · nhóm của `after.parallel` (vắng / hỏng ⇒ rỗng). */
const parallelGroupsOf = (after: Obj): unknown[] => {
  const p = after.parallel;
  return isObj(p) && Array.isArray(p.groups) ? p.groups : [];
};

/** CR-125 · `after.parallel.groups[].group_key` ⇒ `group_id` (cùng luật `bindOne`); không có `parallel` ⇒ giữ nguyên. */
function bindParallel(
  after: Obj,
  ids: ReadonlyMap<string, string>,
  miss: Set<string>,
  strip: boolean,
): Obj {
  if (!isObj(after.parallel) || !Array.isArray(after.parallel.groups)) return after;
  const groups = after.parallel.groups.map((g) => bindOne(g, ids, miss, strip));
  return { ...after, parallel: { ...after.parallel, groups } };
}

function bindOne(
  o: unknown,
  ids: ReadonlyMap<string, string>,
  miss: Set<string>,
  strip: boolean,
): unknown {
  if (!isObj(o) || typeof o.group_key !== "string") return o;
  const id = ids.get(o.group_key);
  if (!id) miss.add(o.group_key);
  const { group_key: _k, ...rest } = o;
  return { ...(strip ? rest : o), group_id: id ?? null };
}

/**
 * `strip` (CR-122 · P15): bản công ty chỉ giữ id ⇒ bỏ `group_key`/`also_group_keys`; mã thiếu ⇒ `group_id` null (admin chọn lại).
 * Mặc định giữ mã (đường mở lượt).
 */
export function bindGroupKeys(
  stages: readonly unknown[],
  ids: ReadonlyMap<string, string>,
  opts: { strip?: boolean } = {},
): { stages: unknown[]; missing: string[] } {
  const strip = opts.strip === true;
  const miss = new Set<string>();
  const out = stages.map((s) => {
    if (!isObj(s)) return s;
    let after = bindOne(s.after, ids, miss, strip) as Obj | unknown;
    if (isObj(after)) {
      if (after.escalate) after = { ...after, escalate: bindOne(after.escalate, ids, miss, strip) };
      const also = (after as Obj).also_group_keys;
      if (Array.isArray(also)) {
        const got = also.map((k) => ids.get(String(k)));
        also.forEach((k, i) => {
          if (!got[i]) miss.add(String(k));
        });
        const { also_group_keys: _a, ...rest } = after as Obj;
        after = { ...(strip ? rest : (after as Obj)), also_group_ids: got.filter(Boolean) };
      }
      after = bindParallel(after as Obj, ids, miss, strip);
    }
    return { ...s, after, answerer: bindOne(s.answerer, ids, miss, strip) };
  });
  return { stages: out, missing: [...miss] };
}
