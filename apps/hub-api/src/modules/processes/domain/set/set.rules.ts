// CR-103 · R4 fnr-showcase · node `set` (họ `work`, không AI): luật thuần — dựng `fields` từ input run/hằng + kiểm def.
// Thuần, lớp 1 (không I/O). Nối dây vào def.rules / registry ở phase B (sau khi R1 gộp).

export type SetFieldType = "number" | "string" | "date";
export type SetValueDef = { key: string; from: { input: string } | { const: string | number } };
export type SetExec = { kind: "set"; values: readonly SetValueDef[] };
export type SetFieldValue = string | number;
export type SetStageShape = {
  executor: { kind: string; values?: readonly SetValueDef[] };
  fields: readonly { key: string; type: string }[];
};
export type SetDefIssue = { path: string; rule: "SET_INVALID" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Kiểu field output tương ứng với kiểu input def; `file`/`source_ref`/… không dùng được ⇒ null. */
export function inputFieldType(inputType: string): SetFieldType | null {
  if (inputType === "number") return "number";
  if (inputType === "date") return "date";
  return inputType === "text" || inputType === "select" ? "string" : null;
}

function constMatches(type: string, v: string | number): boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "date") return typeof v === "string" && DATE_RE.test(v);
  return typeof v === "string";
}

/** Ép giá trị thô theo kiểu field khai báo; `number` mà không phải số hữu hạn ⇒ undefined (bỏ dòng, kiểm ở lúc lưu def/start). */
function coerce(raw: string | number, type: string | undefined): SetFieldValue | undefined {
  if (type !== "number") return typeof raw === "number" ? raw : String(raw);
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return String(raw).trim() === "" || !Number.isFinite(n) ? undefined : n;
}

/** Giá trị `fields` của stage `set`. Input vắng ⇒ bỏ qua dòng đó (không ném). */
export function setFields(
  exec: SetExec,
  inputs: Readonly<Record<string, string | number>>,
  declared: readonly { key: string; type: string }[] = [],
): Record<string, SetFieldValue> {
  const out: Record<string, SetFieldValue> = {};
  for (const v of exec.values) {
    const raw = "input" in v.from ? inputs[v.from.input] : v.from.const;
    if (raw === undefined) continue;
    const val = coerce(raw, declared.find((f) => f.key === v.key)?.type);
    if (val !== undefined) out[v.key] = val;
  }
  return out;
}

/** Ô sai của một dòng gán (`key` | `from`); hợp lệ ⇒ null. */
function badCell(
  v: SetValueDef,
  fields: SetStageShape["fields"],
  inputs: readonly { key: string; type: string }[],
  seen: ReadonlySet<string>,
): "key" | "from" | null {
  const f = fields.find((x) => x.key === v.key);
  if (!f || seen.has(v.key)) return "key";
  if ("const" in v.from) return constMatches(f.type, v.from.const) ? null : "from";
  const name = v.from.input;
  const src = inputs.find((x) => x.key === name);
  return src && inputFieldType(src.type) === f.type ? null : "from";
}

/** SET_INVALID: key phải khai trong `output.fields` và không trùng; input phải có trong def; kiểu khớp field. */
export function setDefIssues(
  stages: readonly SetStageShape[],
  inputs: readonly { key: string; type: string }[],
): SetDefIssue[] {
  const out: SetDefIssue[] = [];
  stages.forEach((s, i) => {
    if (s.executor.kind !== "set") return;
    const seen = new Set<string>();
    for (const [j, v] of (s.executor.values ?? []).entries()) {
      const cell = badCell(v, s.fields, inputs, seen);
      if (cell) out.push({ path: `stages.${i}.executor.values.${j}.${cell}`, rule: "SET_INVALID" });
      seen.add(v.key);
    }
  });
  return out;
}
