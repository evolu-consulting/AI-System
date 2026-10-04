// HUB-FR-10, HUB-FR-12, HUB-FR-50 · helper test hàm thuần H2a (test-plan §4, cases §1, §7): dựng input/arg/workflow/
// command catalog hợp contract. Chỉ dữ liệu, không I/O.
import type { CommandArg, InputMap, WorkflowInput } from "@ai/contracts";
import type {
  CatalogCommand,
  CatalogWorkflow,
} from "../../../../apps/hub-api/src/modules/commands/catalog.types";

/** Dải uuid cố định H2a (`a2a0…`, test-plan §1). */
export const uid = (n: number): string => `a2a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Secret thử của `check-invoice` (cases §7, A55). Không phải key thật. */
export const LEAK = "LEAK_KEY_a550f1e2d3c4b5a6978899a";

type InputOpts = { required?: boolean; description?: string; options?: string[] };

export function input(
  name: string,
  type: WorkflowInput["type"] = "text",
  o: InputOpts = {},
): WorkflowInput {
  const base = {
    name,
    type,
    required: o.required ?? false,
    description: o.description ?? `Mô tả ${name}`,
  };
  return o.options ? { ...base, options: o.options } : base;
}

type ArgOpts = Partial<Pick<CommandArg, "default" | "fallback" | "rest">> & { en?: string };

export function arg(name: string, o: ArgOpts = {}): CommandArg {
  return {
    name,
    description: o.en ? { vi: `Tham số ${name}`, en: o.en } : { vi: `Tham số ${name}` },
    default: o.default ?? null,
    fallback: o.fallback ?? null,
    rest: o.rest ?? false,
  };
}

export function workflow(o: Partial<CatalogWorkflow> = {}): CatalogWorkflow {
  return {
    id: uid(101),
    key: "dich",
    name: "Dịch",
    description: "Dịch văn bản",
    appType: "workflow",
    baseUrl: "http://dify.test/v1",
    secretId: uid(201),
    inputSchema: [],
    outputField: null,
    enabled: true,
    sideEffect: false,
    ...o,
  };
}

export function command(o: Partial<CatalogCommand> = {}): CatalogCommand {
  return {
    id: uid(301),
    name: "dich",
    aliases: [],
    description: { vi: "Dịch" },
    workflowId: uid(101),
    args: [],
    inputMap: {},
    output: { field: "text", render: "markdown" },
    mode: "sync",
    timeoutS: 30,
    enabled: true,
    ...o,
  };
}

/** Workflow `dich` của catalog §7: `source_text` req, `target_lang` select req, `tone` opt. */
export const DICH_INPUTS: readonly WorkflowInput[] = [
  input("source_text", "text", { required: true }),
  input("target_lang", "select", { required: true, options: ["en", "vi", "ja"] }),
  input("tone"),
];
/** Lệnh `/dich` §7: `lang`, `text` (`rest`, fallback selection). */
export const DICH_ARGS: readonly CommandArg[] = [
  arg("lang"),
  arg("text", { rest: true, fallback: "selection" }),
];
export const DICH_MAP: InputMap = {
  target_lang: { source: "arg", value: "lang" },
  source_text: { source: "arg", value: "text" },
  tone: { source: "const", value: "neutral" },
};
