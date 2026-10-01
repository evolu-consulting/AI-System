// ADM-FR-20 · M2-R15 · giá trị mặc định của form command, chuyển Command ↔ form, và body POST/PATCH.
import {
  type Command,
  type CommandCreateRequest,
  type CommandMode,
  TIMEOUT_DEFAULT_S,
} from "@ai/contracts";
import { hasSource } from "./input-map";
import type { ArgValues, CommandFormValues, LocalizedValue, MapEntryValues } from "./schemas";

export const defaultTimeout = (mode: CommandMode): number => TIMEOUT_DEFAULT_S[mode];

export const emptyCommandForm = (): CommandFormValues => ({
  name: "",
  aliases: [],
  description: { vi: "", en: "" },
  workflow_id: "",
  feature_ids: [],
  args: [],
  input_map: {},
  output_field: "",
  render: "markdown",
  mode: "sync",
  timeout_s: defaultTimeout("sync"),
  enabled: true,
});

const localized = (d: { vi: string; en?: string }): LocalizedValue => ({
  vi: d.vi,
  en: d.en ?? "",
});

export function toFormValues(c: Command): CommandFormValues {
  const input_map: Record<string, MapEntryValues> = {};
  for (const [k, e] of Object.entries(c.input_map)) {
    input_map[k] = { source: e.source, value: "value" in e ? e.value : "" };
  }
  return {
    name: c.name,
    aliases: [...c.aliases],
    description: localized(c.description),
    workflow_id: c.workflow.id,
    feature_ids: [...c.feature_ids],
    args: c.args.map(
      (a): ArgValues => ({
        name: a.name,
        description: localized(a.description),
        default: a.default ?? "",
        fallback: a.fallback ?? "none",
        rest: a.rest,
      }),
    ),
    input_map,
    output_field: c.output.field,
    render: c.output.render,
    mode: c.mode,
    timeout_s: c.timeout_s,
    enabled: c.enabled,
  };
}

/** Nhân bản (D6): tên `<name>-copy`, tắt, bỏ alias (alias dùng chung không gian tên nên sẽ trùng); giữ phần còn lại. */
export function toDuplicateValues(c: Command): CommandFormValues {
  return { ...toFormValues(c), name: `${c.name}-copy`, aliases: [], enabled: false };
}

const optLocalized = (v: LocalizedValue) => {
  const en = v.en.trim();
  return en ? { vi: v.vi.trim(), en } : { vi: v.vi.trim() };
};

/** Mục map chưa chọn nguồn bị bỏ; `arg`/`const` mang `value`, các nguồn còn lại không có `value`. */
export function toInputMap(map: Record<string, MapEntryValues>): CommandCreateRequest["input_map"] {
  const out: CommandCreateRequest["input_map"] = {};
  for (const [k, e] of Object.entries(map)) {
    if (!hasSource(e)) continue;
    out[k] =
      e.source === "arg" || e.source === "const"
        ? { source: e.source, value: e.value }
        : { source: e.source };
  }
  return out;
}

export function toRequestBody(v: CommandFormValues): CommandCreateRequest {
  return {
    name: v.name,
    aliases: v.aliases,
    description: optLocalized(v.description),
    workflow_id: v.workflow_id,
    args: v.args.map((a) => ({
      name: a.name,
      description: optLocalized(a.description),
      default: a.default.trim() === "" ? null : a.default.trim(),
      fallback: a.fallback === "none" ? null : a.fallback,
      rest: a.rest,
    })),
    input_map: toInputMap(v.input_map),
    output: { field: v.output_field.trim(), render: v.render },
    mode: v.mode,
    timeout_s: v.timeout_s,
    enabled: v.enabled,
    feature_ids: v.feature_ids,
  };
}
