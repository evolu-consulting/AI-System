// CR-103 · R4 fnr-showcase · node `set` (họ `work`, không AI): luật thuần — dựng `fields` từ input run/hằng + kiểm def.
// CR-122 E4 · thêm nguồn field của bước trước (`{kind:"field", step, key}`) + dữ kiện bản ghi (`{kind:"fact", key}`) và biến đổi kiểu
// tối thiểu (`as`: number/text/date/bool). Giá trị sai dạng ⇒ null + báo lại (`bad`), không ném. Thuần, lớp 1 (không I/O).

export type SetFieldType = "number" | "string" | "date";
export type SetAs = "number" | "text" | "date" | "bool";
export type SetFromDef =
  | { input: string }
  | { const: string | number }
  | { kind: "field"; step: number; key: string }
  | { kind: "fact"; key: string };
export type SetValueDef = { key: string; from: SetFromDef; as?: SetAs };
export type SetExec = { kind: "set"; values: readonly SetValueDef[] };
export type SetFieldValue = string | number;
/** Giá trị nguồn thô (field output / dữ kiện app). */
export type SetRaw = string | number | boolean | readonly string[] | null;
export type SetStageShape = {
  executor: { kind: string; values?: readonly SetValueDef[] };
  fields: readonly { key: string; type: string }[];
};
export type SetDefIssue = { path: string; rule: "SET_INVALID" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T/;

/** Kiểu field output tương ứng với kiểu input def; `file`/`source_ref`/… không dùng được ⇒ null. */
export function inputFieldType(inputType: string): SetFieldType | null {
  if (inputType === "number") return "number";
  if (inputType === "date") return "date";
  return inputType === "text" || inputType === "select" ? "string" : null;
}

/** Kiểu field mà `as` tạo ra (`bool` ghi "true"/"false" ⇒ chuỗi). */
export const asFieldType = (as: SetAs): SetFieldType =>
  as === "number" ? "number" : as === "date" ? "date" : "string";

function constMatches(type: string, v: string | number): boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "date") return typeof v === "string" && DATE_RE.test(v);
  return typeof v === "string";
}

const isCalendar = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const textOf = (v: Exclude<SetRaw, null>): string => (Array.isArray(v) ? v.join(", ") : String(v));

/** Biến đổi theo `as`; sai dạng / trống ⇒ undefined (gọi là "sai dạng"). */
function toNumber(v: Exclude<SetRaw, null>): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}
function toDate(v: Exclude<SetRaw, null>): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const d = DATETIME_RE.exec(s)?.[1] ?? s;
  return isCalendar(d) ? d : undefined;
}
const TRUE: ReadonlySet<unknown> = new Set([true, 1, "1", "true"]);
const FALSE: ReadonlySet<unknown> = new Set([false, 0, "0", "false"]);
const toBool = (v: Exclude<SetRaw, null>): string | undefined =>
  TRUE.has(v) ? "true" : FALSE.has(v) ? "false" : undefined;

export function convertAs(v: SetRaw, as: SetAs): SetFieldValue | undefined {
  if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return undefined;
  if (as === "text") return textOf(v);
  if (as === "number") return toNumber(v);
  return as === "date" ? toDate(v) : toBool(v);
}

/** Ép giá trị thô theo kiểu field khai báo (khi không có `as`); `number` mà không phải số hữu hạn ⇒ undefined. */
function coerce(raw: SetRaw, type: string | undefined): SetFieldValue | undefined {
  if (raw === null) return undefined;
  if (type === "number") return convertAs(raw, "number");
  if (type === "date") return convertAs(raw, "date");
  return typeof raw === "number" ? raw : textOf(raw);
}

/** Ngữ cảnh nguồn lúc chạy: field output theo BƯỚC (stage đầu tiên của bước có khoá) + dữ kiện app (null = không đọc được). */
export type SetSources = {
  inputs: Readonly<Record<string, string | number>>;
  fieldsByStep?: Readonly<Record<number, Readonly<Record<string, SetRaw>>>>;
  facts?: Readonly<Record<string, SetRaw>> | null;
};

function rawOf(f: SetFromDef, s: SetSources): SetRaw | undefined {
  if ("input" in f) return s.inputs[f.input];
  if ("const" in f) return f.const;
  if (f.kind === "field") {
    const row = s.fieldsByStep?.[f.step];
    return row && Object.hasOwn(row, f.key) ? (row[f.key] ?? null) : null;
  }
  return s.facts && Object.hasOwn(s.facts, f.key) ? (s.facts[f.key] ?? null) : null;
}

/**
 * `fields` của stage `set` + danh sách khoá sai dạng (`bad`). Input/hằng vắng hoặc sai ⇒ bỏ dòng (như cũ). Nguồn field/fact vắng hoặc
 * sai dạng ⇒ ghi `null` (bước sau thấy "chưa có dữ liệu") + khoá vào `bad` để audit — không ném.
 */
export function setFieldsOf(
  exec: SetExec,
  src: SetSources,
  declared: readonly { key: string; type: string }[] = [],
): { fields: Record<string, SetFieldValue | null>; bad: string[] } {
  const fields: Record<string, SetFieldValue | null> = {};
  const bad: string[] = [];
  for (const v of exec.values) {
    const raw = rawOf(v.from, src);
    const typed = "kind" in v.from;
    if (raw === undefined && !typed) continue;
    const val =
      raw === undefined
        ? undefined
        : v.as
          ? convertAs(raw, v.as)
          : coerce(raw, declared.find((f) => f.key === v.key)?.type);
    if (val !== undefined) fields[v.key] = val;
    else if (typed) {
      fields[v.key] = null;
      bad.push(v.key);
    }
  }
  return { fields, bad };
}

/** Giá trị `fields` của stage `set` (chỉ input/hằng — giữ cho nơi gọi cũ). Input vắng ⇒ bỏ qua dòng đó (không ném). */
export function setFields(
  exec: SetExec,
  inputs: Readonly<Record<string, string | number>>,
  declared: readonly { key: string; type: string }[] = [],
): Record<string, SetFieldValue> {
  const { fields } = setFieldsOf(exec, { inputs }, declared);
  const out: Record<string, SetFieldValue> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null) out[k] = v;
  return out;
}

/** Ngữ cảnh luật lưu cho nguồn field: bước của từng stage (cùng chỉ số) + field output của từng stage. */
export type SetDefCtx = { steps: readonly number[] };

/** Kiểu nguồn khớp field đích: có `as` ⇒ kiểu `as` tạo ra phải = kiểu đích; không ⇒ kiểu nguồn = kiểu đích. */
const typeFits = (target: string, srcType: string | null, as?: SetAs): boolean =>
  as ? asFieldType(as) === target : srcType === target;

type CellCtx = {
  stages: readonly SetStageShape[];
  inputs: readonly { key: string; type: string }[];
  ctx: SetDefCtx | undefined;
  i: number;
};

function fromBad(v: SetValueDef, target: string, x: CellCtx): boolean {
  const f = v.from;
  if ("const" in f)
    return v.as ? convertAs(f.const, v.as) === undefined : !constMatches(target, f.const);
  if ("input" in f) {
    const src = x.inputs.find((y) => y.key === f.input);
    return !src || !typeFits(target, inputFieldType(src.type), v.as);
  }
  if (f.kind === "fact") return v.as ? asFieldType(v.as) !== target : false; // khoá/kiểu dữ kiện: `flowDefIssues` (danh mục sự kiện)
  // Nguồn field: bước TRƯỚC bước của `set`, khoá có trong output một stage của bước đó, kiểu khớp.
  const steps = x.ctx?.steps;
  if (!steps) return true;
  const own = steps[x.i] as number;
  if (!Number.isInteger(f.step) || f.step >= own) return true;
  const hit = x.stages
    .filter((_, j) => steps[j] === f.step)
    .flatMap((s) => s.fields)
    .find((d) => d.key === f.key);
  return !hit || !typeFits(target, hit.type, v.as);
}

/** Ô sai của một dòng gán (`key` | `from`); hợp lệ ⇒ null. */
function badCell(v: SetValueDef, x: CellCtx, seen: ReadonlySet<string>): "key" | "from" | null {
  const f = (x.stages[x.i] as SetStageShape).fields.find((d) => d.key === v.key);
  if (!f || seen.has(v.key)) return "key";
  return fromBad(v, f.type, x) ? "from" : null;
}

/**
 * SET_INVALID: key phải khai trong `output.fields` và không trùng; input phải có trong def; kiểu khớp field; nguồn field phải là bước
 * trước (cần `ctx.steps`, vắng ⇒ nguồn field luôn sai) và khoá có trong output bước đó.
 */
export function setDefIssues(
  stages: readonly SetStageShape[],
  inputs: readonly { key: string; type: string }[],
  ctx?: SetDefCtx,
): SetDefIssue[] {
  const out: SetDefIssue[] = [];
  stages.forEach((s, i) => {
    if (s.executor.kind !== "set") return;
    const seen = new Set<string>();
    for (const [j, v] of (s.executor.values ?? []).entries()) {
      const cell = badCell(v, { stages, inputs, ctx, i }, seen);
      if (cell) out.push({ path: `stages.${i}.executor.values.${j}.${cell}`, rule: "SET_INVALID" });
      seen.add(v.key);
    }
  });
  return out;
}

/** Giá trị input run (`ProcessInputValue[]` lưu ở `process_runs.inputs`) → key → chuỗi; file/source_ref bỏ qua. */
export function setInputsOf(
  inputs: readonly { key: string; type: string; text?: string; value?: string }[] | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of inputs ?? []) {
    const raw =
      v.type === "text"
        ? v.text
        : v.type === "file" || v.type === "source_ref"
          ? undefined
          : v.value;
    if (raw !== undefined) out[v.key] = raw;
  }
  return out;
}

const cell = (v: SetFieldValue | null): string =>
  v === null ? "—" : String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** `.md` của stage `set`: bảng key/giá trị + khối ```fields (đọc lại như output tool/agent). */
export function setOutputMd(
  stageName: string,
  fields: Readonly<Record<string, SetFieldValue | null>>,
): string {
  const keys = Object.keys(fields);
  const rows = keys.map((k) => `| ${cell(k)} | ${cell(fields[k] ?? null)} |\n`).join("");
  return (
    `# ${stageName}\n\n## Kết quả\n| Trường | Giá trị |\n|---|---|\n${rows}\n` +
    `\`\`\`fields\n${JSON.stringify(fields)}\n\`\`\`\n`
  );
}
