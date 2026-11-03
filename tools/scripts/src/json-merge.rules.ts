// Gộp 3 chiều (base/ours/theirs) cho JSON dạng object — lõi thuần của merge driver locale i18n
// (`json-merge-driver.ts`, đăng ký qua .gitattributes `merge=i18njson`). Nhiều lát cùng thêm key vào một
// file locale ⇒ git (gộp theo dòng) báo conflict dù hai bên thêm key khác nhau; gộp theo key thì không.
//   - key chỉ một bên đổi/thêm/xoá ⇒ lấy bên đó; hai bên đổi giống nhau ⇒ lấy chung;
//   - hai bên đều là object ⇒ gộp đệ quy; còn lại (cùng key đổi khác nhau, xoá vs sửa) ⇒ conflict.
// Thứ tự key: theo bên "ours"; key mới của "theirs" chèn sau key đứng trước nó ở "theirs".
// Mảng/giá trị nguyên thủy coi là nguyên khối. Lưu ý: key kiểu số nguyên bị JS đưa lên đầu (locale không dùng).

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

export type MergeResult = { value: Json | undefined; conflicts: string[] };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => deepEqual(x, b[i]))
    );
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Thứ tự key: ours, rồi key chỉ có ở theirs chèn sau key đứng trước nó (bỏ qua các key ours mới thêm liền sau). */
export function mergeKeyOrder(base: Obj, ours: Obj, theirs: Obj): string[] {
  const order = Object.keys(ours);
  const tk = Object.keys(theirs);
  tk.forEach((k, i) => {
    if (k in ours) return;
    const prev = i > 0 ? tk[i - 1] : undefined;
    let pos = prev === undefined ? 0 : order.indexOf(prev) + 1; // prev vắng (đã xoá ở ours) ⇒ indexOf=-1 ⇒ 0
    while (pos < order.length && !Object.hasOwn(base, order[pos] as string)) pos++;
    order.splice(pos, 0, k);
  });
  return order;
}

function mergeObjects(base: Obj, ours: Obj, theirs: Obj, path: string, conflicts: string[]): Obj {
  const out: Obj = {};
  for (const k of mergeKeyOrder(base, ours, theirs)) {
    const r = mergeValue(base[k], ours[k], theirs[k], path ? `${path}.${k}` : k, conflicts);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

function mergeValue(
  b: Json | undefined,
  o: Json | undefined,
  t: Json | undefined,
  path: string,
  conflicts: string[],
): Json | undefined {
  if (deepEqual(o, t)) return o;
  if (deepEqual(b, o)) return t;
  if (deepEqual(b, t)) return o;
  if (isObj(o) && isObj(t) && (b === undefined || isObj(b))) {
    return mergeObjects(isObj(b) ? b : {}, o, t, path, conflicts);
  }
  conflicts.push(path || "(gốc)");
  return o; // giữ bên ours làm giá trị tạm; caller bỏ kết quả khi có conflict
}

export function mergeJson3(base: Json, ours: Json, theirs: Json): MergeResult {
  const conflicts: string[] = [];
  const value = mergeValue(base, ours, theirs, "", conflicts);
  return { value, conflicts };
}

/** Định dạng như file i18n của repo: 2 dấu cách, LF, newline cuối. */
export function formatJson(v: Json): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

export type TextMergeResult = { text: string | null; conflicts: string[]; error?: string };

/** Gộp theo văn bản JSON. base rỗng (add/add) ⇒ coi là `{}`. `text=null` khi conflict hoặc JSON hỏng. */
export function mergeJsonText(
  baseText: string,
  oursText: string,
  theirsText: string,
): TextMergeResult {
  let base: Json;
  let ours: Json;
  let theirs: Json;
  try {
    base = baseText.trim() === "" ? {} : (JSON.parse(baseText) as Json);
    ours = JSON.parse(oursText) as Json;
    theirs = JSON.parse(theirsText) as Json;
  } catch (e) {
    return { text: null, conflicts: [], error: `JSON không hợp lệ: ${(e as Error).message}` };
  }
  const { value, conflicts } = mergeJson3(base, ours, theirs);
  if (conflicts.length > 0 || value === undefined) return { text: null, conflicts };
  return { text: formatJson(value), conflicts };
}
