// HUB-FR-12 · H2a-R06 · dựng `inputs` Dify từ `input_map` + kiểm kiểu (plan-rules). Thuần.
import type { CommandArg, InputMap, InputMapEntry, WorkflowInput } from "@ai/contracts";
import type { MessageContext } from "@ai/contracts/chat";
import type { DifyAppType } from "@ai/contracts/hub";
import type { WorkflowInputValue } from "./catalog.types";

export type BuildInputsInput = {
  inputMap: InputMap;
  inputSchema: readonly WorkflowInput[];
  args: readonly CommandArg[];
  values: Record<string, string | null>;
  ctx: MessageContext;
  userId: string;
  tenantId: string;
};

export type BuildInputsResult =
  | { ok: true; inputs: Record<string, WorkflowInputValue>; query: string | null }
  | { ok: false; missing: string[]; invalid: string[] };

const BOOL: Record<string, boolean> = {
  true: true,
  false: false,
  "1": true,
  "0": false,
  yes: true,
  no: false,
};
/** Input Dify mang câu hỏi của app `chat`/`agent` (R09). */
export const QUERY_INPUT = "query";

/** Giá trị thô + tên báo lỗi (tên tham số command khi nguồn `arg`, không thì tên input — R06). */
function source(
  i: BuildInputsInput,
  name: string,
  e: InputMapEntry | undefined,
): { raw: string | null; label: string } {
  if (!e) return { raw: null, label: name };
  switch (e.source) {
    case "arg":
      return { raw: i.values[e.value] ?? null, label: e.value };
    case "const":
      return { raw: e.value, label: name };
    case "selection":
    case "page_url":
    case "page_text":
      return { raw: i.ctx[e.source] ?? null, label: name };
    case "user_id":
      return { raw: i.userId, label: name };
    case "tenant_id":
      return { raw: i.tenantId, label: name };
    default:
      // `attachment` — H2c: chưa có file ⇒ rỗng.
      return { raw: null, label: name };
  }
}

/** Ép kiểu theo `input.type`; `undefined` = sai kiểu. */
function coerce(inp: WorkflowInput, raw: string): WorkflowInputValue | undefined {
  switch (inp.type) {
    case "number": {
      const n = Number(raw.trim());
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      return BOOL[raw.trim().toLowerCase()];
    case "select":
      return inp.options?.includes(raw) ? raw : undefined;
    default:
      return raw;
  }
}

/** Tên tham số command theo thứ tự `args`, rồi tên input theo thứ tự schema; khử trùng. */
function ordered(labels: readonly string[], args: readonly CommandArg[]): string[] {
  const pos = new Map(args.map((a, k) => [a.name, k]));
  const uniq = [...new Set(labels)];
  const rank = (l: string) => pos.get(l) ?? args.length + uniq.indexOf(l);
  return uniq.sort((a, b) => rank(a) - rank(b));
}

/** number = `Number()` hữu hạn; boolean ∈ {true,false,1,0,yes,no} (không phân biệt hoa); select ∉ options → invalid. */
export function buildInputs(i: BuildInputsInput): BuildInputsResult {
  const inputs: Record<string, WorkflowInputValue> = {};
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const inp of i.inputSchema) {
    const { raw, label } = source(i, inp.name, i.inputMap[inp.name]);
    if (raw === null || raw.trim() === "") {
      if (inp.required) missing.push(label);
      continue;
    }
    const v = coerce(inp, raw);
    if (v === undefined) invalid.push(label);
    else inputs[inp.name] = v;
  }
  const bad = new Set(invalid);
  const miss = missing.filter((m) => !bad.has(m));
  if (miss.length > 0 || invalid.length > 0)
    return { ok: false, missing: ordered(miss, i.args), invalid: ordered(invalid, i.args) };
  const q = inputs[QUERY_INPUT];
  return { ok: true, inputs, query: q === undefined ? null : String(q) };
}

/** `chat`/`agent` cần `query`; `workflow` không. */
export function appNeedsQuery(appType: DifyAppType): boolean {
  return appType !== "workflow";
}
