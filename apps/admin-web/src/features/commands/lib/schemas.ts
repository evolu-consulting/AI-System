// ADM-FR-20, ADM-FR-21, ADM-BR-01, ADM-BR-10 · M2-R13…R17 · schema form command; hằng số từ @ai/contracts, thông điệp là KEY i18n.
// Kiểm map input_map ↔ input của workflow nằm ở lib/input-map.ts (cần biết workflow).
import {
  ALIASES_MAX,
  ARG_DEFAULT_MAX,
  ARG_FALLBACKS,
  ARG_NAME_RE,
  ARGS_MAX,
  CATALOG_KEY_RE,
  COMMAND_DESC_MAX,
  COMMAND_MODES,
  CONST_VALUE_MAX,
  MAP_SOURCES,
  OUTPUT_FIELD_MAX,
  OUTPUT_RENDERS,
  TIMEOUT_MAX_S,
  TIMEOUT_MIN_S,
} from "@ai/contracts";
import { z } from "zod";

export type LocalizedValue = { vi: string; en: string };
export type ArgValues = {
  name: string;
  description: LocalizedValue;
  default: string;
  fallback: (typeof ARG_FALLBACKS)[number] | "none";
  rest: boolean;
};
export type MapEntryValues = { source: (typeof MAP_SOURCES)[number] | ""; value: string };
export type CommandFormValues = {
  name: string;
  aliases: string[];
  description: LocalizedValue;
  workflow_id: string;
  feature_ids: string[];
  args: ArgValues[];
  input_map: Record<string, MapEntryValues>;
  output_field: string;
  render: (typeof OUTPUT_RENDERS)[number];
  mode: (typeof COMMAND_MODES)[number];
  timeout_s: number;
  enabled: boolean;
};

const key = z.string().regex(CATALOG_KEY_RE, "commands.error.nameFormat");
const localized = z.object({
  vi: z
    .string()
    .trim()
    .min(1, "commands.error.descRequired")
    .max(COMMAND_DESC_MAX, "commands.error.descRequired"),
  en: z.string().trim().max(COMMAND_DESC_MAX, "commands.error.descRequired"),
});
const arg = z.object({
  name: z.string().regex(ARG_NAME_RE, "commands.error.argName"),
  description: localized,
  default: z.string().max(ARG_DEFAULT_MAX),
  fallback: z.enum(["none", ...ARG_FALLBACKS]),
  rest: z.boolean(),
});
const mapEntry = z.object({
  source: z.enum(["", ...MAP_SOURCES]).default(""),
  // RHF chỉ tạo `source` khi người dùng chọn trước khi map được dựng đủ → `value` mặc định rỗng.
  value: z.string().max(CONST_VALUE_MAX, "commands.error.constMax").default(""),
});

function checkNames(v: { name: string; aliases: string[] }, ctx: z.RefinementCtx): void {
  if (v.aliases.length > ALIASES_MAX) {
    ctx.addIssue({ code: "custom", path: ["aliases"], message: "commands.error.aliasMax" });
  }
  const seen = new Set<string>([v.name]);
  for (const a of v.aliases) {
    if (seen.has(a)) {
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "commands.error.aliasDup" });
      return;
    }
    seen.add(a);
  }
}

function checkArgs(args: ArgValues[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  args.forEach((a, i) => {
    if (seen.has(a.name)) {
      ctx.addIssue({ code: "custom", path: ["args", i, "name"], message: "commands.error.argDup" });
    }
    seen.add(a.name);
    if (a.rest && i !== args.length - 1) {
      ctx.addIssue({
        code: "custom",
        path: ["args", i, "rest"],
        message: "commands.error.argRest",
      });
    }
  });
}

export const commandSchema = z
  .object({
    name: key,
    aliases: z.array(key),
    description: localized,
    workflow_id: z.string().min(1, "commands.error.workflowRequired"),
    feature_ids: z.array(z.string()), // CR-055: rỗng hợp lệ (command chưa gắn feature)
    args: z.array(arg).max(ARGS_MAX),
    input_map: z.record(z.string(), mapEntry),
    output_field: z
      .string()
      .trim()
      .min(1, "commands.error.outputField")
      .max(OUTPUT_FIELD_MAX, "commands.error.outputField"),
    render: z.enum(OUTPUT_RENDERS),
    mode: z.enum(COMMAND_MODES),
    timeout_s: z
      .number("commands.error.timeout")
      .int("commands.error.timeout")
      .min(TIMEOUT_MIN_S, "commands.error.timeout")
      .max(TIMEOUT_MAX_S, "commands.error.timeout"),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    checkNames(v, ctx);
    checkArgs(v.args, ctx);
  });
