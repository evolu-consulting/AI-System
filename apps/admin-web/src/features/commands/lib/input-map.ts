// ADM-FR-20, ADM-FR-21, ADM-FR-22 · AC-A03 · M2-R16, R17 · luật thuần của input map: gộp khi đổi workflow, kiểm thiếu/lạ, cảnh báo sai kiểu.
// Cùng luật với module rules của admin-api commands (server vẫn là nguồn quyết định, FE chỉ chặn sớm).
import type { InputType, MapSource, WorkflowInput } from "@ai/contracts";
import type { ArgValues, MapEntryValues } from "./schemas";

export type MapValues = Record<string, MapEntryValues>;
export type MapInput = Pick<WorkflowInput, "name" | "type" | "required" | "options">;
export type MapWarning = {
  var: string;
  type: InputType;
  source: MapSource;
  reason: "type_mismatch" | "const_invalid";
};

const NONE: MapEntryValues = { source: "", value: "" };

/** Mục có nguồn thật: `source` đã chọn và, với `arg`, đã chọn tham số. */
export const hasSource = (
  e: MapEntryValues | undefined,
): e is MapEntryValues & { source: MapSource } =>
  // Ô nguồn chưa chạm: RHF có thể giữ `source` undefined (input mới của workflow) ⇒ coi như chưa chọn.
  !!e && !!e.source && !(e.source === "arg" && !e.value);

/**
 * Đổi workflow (hoặc args): giữ mục còn hợp lệ, liệt kê mục bị bỏ (`dropped`), input trùng tên tham số tự map `arg` (`autoMapped`).
 * Kết quả luôn có một mục cho **mỗi** input (chưa có nguồn → `NONE`).
 */
export function reconcileMap(
  prev: MapValues,
  inputs: readonly MapInput[],
  args: readonly Pick<ArgValues, "name">[],
): { map: MapValues; dropped: string[]; autoMapped: string[] } {
  const argNames = new Set(args.map((a) => a.name));
  const map: MapValues = {};
  const autoMapped: string[] = [];
  for (const input of inputs) {
    const old = prev[input.name];
    const keep = hasSource(old) && !(old.source === "arg" && !argNames.has(old.value));
    if (keep) map[input.name] = old;
    else if (argNames.has(input.name) && !hasSource(old)) {
      map[input.name] = { source: "arg", value: input.name };
      autoMapped.push(input.name);
    } else map[input.name] = { ...NONE };
  }
  const dropped = Object.entries(prev)
    .filter(([k, e]) => hasSource(e) && !hasSource(map[k]))
    .map(([k]) => k);
  return { map, dropped, autoMapped };
}

export type MapCheck = { missing: string[]; unknownArgs: string[]; warnings: MapWarning[] };

const TEXT_SOURCES = new Set<string>([
  "selection",
  "page_url",
  "page_text",
  "user_id",
  "tenant_id",
]);

function typeMismatch(p: MapInput, source: string): boolean {
  if (p.type === "file") return source !== "attachment";
  if (source === "attachment") return true;
  return (
    (p.type === "number" || p.type === "boolean" || p.type === "select") && TEXT_SOURCES.has(source)
  );
}

function constInvalid(p: MapInput, v: string): boolean {
  if (p.type === "number") return v.trim() === "" || !Number.isFinite(Number(v));
  if (p.type === "boolean") return v !== "true" && v !== "false";
  if (p.type === "select") return !(p.options ?? []).includes(v);
  return false;
}

/** Cảnh báo sai kiểu (không chặn), theo thứ tự input; `arg` không bao giờ cảnh báo. */
export function mapWarnings(inputs: readonly MapInput[], map: MapValues): MapWarning[] {
  const out: MapWarning[] = [];
  for (const p of inputs) {
    const e = map[p.name];
    if (!hasSource(e) || e.source === "arg") continue;
    const base = { var: p.name, type: p.type, source: e.source };
    if (typeMismatch(p, e.source)) out.push({ ...base, reason: "type_mismatch" });
    else if (e.source === "const" && constInvalid(p, e.value))
      out.push({ ...base, reason: "const_invalid" });
  }
  return out;
}

/** `missing` = input bắt buộc chưa có nguồn (AC-A03); `unknownArgs` = `arg` trỏ tham số chưa khai báo. */
export function validateInputMap(
  inputs: readonly MapInput[],
  args: readonly Pick<ArgValues, "name">[],
  map: MapValues,
): MapCheck {
  const declared = new Set(args.map((a) => a.name));
  const unknownArgs: string[] = [];
  for (const e of Object.values(map)) {
    if (
      e.source === "arg" &&
      e.value !== "" &&
      !declared.has(e.value) &&
      !unknownArgs.includes(e.value)
    ) {
      unknownArgs.push(e.value);
    }
  }
  return {
    missing: inputs.filter((p) => p.required && !hasSource(map[p.name])).map((p) => p.name),
    unknownArgs,
    warnings: mapWarnings(inputs, map),
  };
}
