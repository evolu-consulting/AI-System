// ADM-FR-54 · M4-R14 · M4-R15 · M4-AC09 · Import xem trước (plan-cd §3.3, §8.2): kích thước → yaml (không alias, khoá
// không trùng, schema core) → `ConfigFileSchema` → snapshot `repeatable read, read only` → `planImport`. Không ghi gì,
// không log `content`; `secrets` trong request bị bỏ qua (không đọc). Thông điệp lỗi yaml không trích nội dung file.
import {
  type ConfigFile,
  ConfigFileSchema,
  IMPORT_ERRORS_MAX,
  IMPORT_MAX_BYTES,
  type ImportError,
  type ImportPreview,
  type ImportRequest,
  TRANSFER_TYPES,
} from "@ai/contracts";
import { readConfigVersion, type Tx, withScope } from "@ai/db";
import { parse, YAMLError } from "yaml";
import { appError } from "../../lib/errors";
import { formatPath } from "./transfer.import-ctx";
import type { Snapshot } from "./transfer.norm";
import { readSnapshot } from "./transfer.repo";
import { type ImportPlan, planImport } from "./transfer.rules";
import { type Call, SNAPSHOT_TX } from "./transfer.service";

export type ParsedFile = { file: ConfigFile | null; errors: ImportError[] };

/** `Buffer.byteLength` UTF-8 (không phải số ký tự) > 1 MiB → 413 `PAYLOAD_TOO_LARGE {max_bytes}`. */
export function checkImportSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > IMPORT_MAX_BYTES)
    throw appError("PAYLOAD_TOO_LARGE", { max_bytes: IMPORT_MAX_BYTES });
}

function yamlError(err: unknown): ImportError {
  const base: ImportError = { path: "", code: "YAML_SYNTAX", message: "File yaml không hợp lệ" };
  if (err instanceof YAMLError) {
    const pos = err.linePos?.[0];
    const reason = { reason: err.code };
    return pos
      ? { ...base, params: reason, line: pos.line, col: pos.col }
      : { ...base, params: reason };
  }
  // `maxAliasCount: 0` ném ReferenceError (không vị trí): alias/anchor bị cấm (D7, chống "billion laughs").
  if (err instanceof ReferenceError)
    return {
      ...base,
      message: "File yaml không được dùng alias/anchor",
      params: { reason: "ALIAS" },
    };
  throw err;
}

/** yaml → object → `ConfigFileSchema`; lỗi → danh sách `ImportError` (≤ 100). */
export function parseConfigText(content: string): ParsedFile {
  let doc: unknown;
  try {
    doc = parse(content, {
      maxAliasCount: 0,
      uniqueKeys: true,
      schema: "core",
      prettyErrors: true,
    });
  } catch (err) {
    return { file: null, errors: [yamlError(err)] };
  }
  const r = ConfigFileSchema.safeParse(doc);
  if (r.success) return { file: r.data, errors: [] };
  const errors = r.error.issues
    .slice(0, IMPORT_ERRORS_MAX)
    .map((i): ImportError => ({ path: formatPath(i.path), code: "SCHEMA", message: i.message }));
  return { file: null, errors };
}

/** Snapshot đủ mọi loại (tham chiếu chéo cần cả loại không có trong file). */
export const readFullSnapshot = async (tx: Tx, v: number): Promise<Snapshot> =>
  readSnapshot(tx, v, TRANSFER_TYPES);

const EMPTY_PLAN: ImportPlan = {
  items: [],
  summary: { added: 0, updated: 0, unchanged: 0 },
  missing_secrets: [],
  errors: [],
};

export async function previewImport(c: Call, req: ImportRequest): Promise<ImportPreview> {
  checkImportSize(req.content);
  const parsed = parseConfigText(req.content);
  const { v, plan } = await withScope(
    c.ctx.db,
    c.scope,
    async (tx) => {
      const v = await readConfigVersion(tx);
      if (!parsed.file) return { v, plan: { ...EMPTY_PLAN, errors: parsed.errors } };
      return { v, plan: planImport(parsed.file, await readFullSnapshot(tx, v)) };
    },
    SNAPSHOT_TX,
  );
  return {
    valid: plan.errors.length === 0,
    file_name: req.file_name,
    from_config_version: parsed.file?.config_version ?? null,
    base_config_version: v,
    ...plan,
  };
}
