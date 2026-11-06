// CR-122 · U2f · FLOW2-FR-25: cấu hình RIÊNG của node module (manifest `node.config { stage, options_path }`). Tổng quát theo `options_path`:
// đường kiểm = `<options_path không có /options>/node-config/check`; cấu hình ghi vào `executor.args` (giá trị đơn) của stage `config.stage`.
// Hiện có bộ mã hoá cho node Ký số (`contracts.esign`); node khác đăng ký thêm vào `NODE_CONFIGS`.
import {
  decodeEsignNodeArgs,
  ESIGN_NODE_PARAMS,
  type EsignNodeConfig,
  encodeEsignNodeArgs,
  esignWaitTimeoutH,
} from "@ai/contracts/pack-contracts";
import type { ArgDraft, ToolDraft } from "./draft-types";

/** `/pack/contracts/esign/options` ⇒ `/pack/contracts/esign/node-config/check`. */
export const checkPathOf = (optionsPath: string): string =>
  optionsPath.replace(/\/options$/, "/node-config/check");

type Codec<C> = {
  /** Khoá args thuộc cấu hình (các khoá khác của tool, vd `contract_id`, giữ nguyên). */
  keys: readonly string[];
  decode: (args: Readonly<Record<string, string | number | boolean>>) => C;
  encode: (c: C) => Record<string, string | number | boolean>;
  /** Giờ chờ của stage chờ đi kèm (null ⇒ giữ). */
  waitH: (c: C) => number | null;
};

export const ESIGN_CODEC: Codec<EsignNodeConfig> = {
  keys: ESIGN_NODE_PARAMS,
  decode: (a) => {
    const r = decodeEsignNodeArgs(a);
    return r.ok ? r.config : {};
  },
  encode: encodeEsignNodeArgs,
  waitH: esignWaitTimeoutH,
};

/** Node → bộ mã hoá cấu hình. */
export const NODE_CONFIGS: Readonly<Record<string, Codec<never>>> = {
  "contracts.esign": ESIGN_CODEC as unknown as Codec<never>,
};

const KIND = (v: string | number | boolean): ArgDraft["kind"] =>
  typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";

/** Giá trị hằng của các arg thuộc cấu hình (arg không phải hằng bị bỏ qua). */
export function constArgs(
  tool: ToolDraft,
  keys: readonly string[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    const a = tool.args[k];
    if (a?.from !== "const" || a.value === "") continue;
    out[k] =
      a.kind === "number" ? Number(a.value) : a.kind === "boolean" ? a.value === "true" : a.value;
  }
  return out;
}

/** Ghi cấu hình vào args: xoá khoá cấu hình cũ, đặt khoá mới (hằng), giữ khoá khác. */
export function withConfigArgs(
  tool: ToolDraft,
  keys: readonly string[],
  next: Record<string, string | number | boolean>,
): ToolDraft {
  const args: ToolDraft["args"] = {};
  for (const [k, v] of Object.entries(tool.args)) if (!keys.includes(k)) args[k] = v;
  for (const [k, v] of Object.entries(next))
    args[k] = { from: "const", value: String(v), kind: KIND(v) };
  return { ...tool, args };
}
