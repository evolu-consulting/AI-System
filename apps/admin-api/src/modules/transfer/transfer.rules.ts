// ADM-FR-54 · ADM-BR-04 · M4-R14 · M4-R15 · AC-A06 · luật thuần Import/Export (plan-cd §6). Không I/O.
// Export: dựng file từ snapshot (dạng phần tử file), sắp theo key, secret chỉ tên. Import: `planImport` (transfer.plan).
import {
  CONFIG_FILE_FORMAT,
  CONFIG_FORMAT_VERSION,
  type ConfigFile,
  TRANSFER_TYPES,
  type TransferType,
  type WorkflowEl,
} from "@ai/contracts";
import { type Snapshot, sortedEls, sortStrs } from "./transfer.norm";

export {
  canonicalJson,
  cmpStr,
  diffOp,
  sortedEls,
  sortKeyOf,
} from "./transfer.norm";
export { type ImportPlan, planImport } from "./transfer.plan";
export type { Snapshot, TransferType };

/** Tên secret mà các workflow tham chiếu (duy nhất, sắp) — không bao giờ có giá trị/last4 (BR-04). */
export function referencedSecrets(workflows: readonly WorkflowEl[]): { name: string }[] {
  return sortStrs([...new Set(workflows.map((w) => w.secret))]).map((name) => ({ name }));
}

/** File export: đầu file + đúng các loại trong `types`; `secrets` chỉ từ workflow được export. */
export function buildExportFile(
  s: Snapshot,
  types: readonly TransferType[],
  now: Date,
): ConfigFile {
  const file: ConfigFile = {
    format: CONFIG_FILE_FORMAT,
    format_version: CONFIG_FORMAT_VERSION,
    config_version: s.configVersion,
    exported_at: now.toISOString(),
    secrets: [],
  };
  const body = file as Record<string, unknown>;
  for (const t of TRANSFER_TYPES) {
    if (types.includes(t)) body[t] = sortedEls(t, s[t] ?? []);
  }
  file.secrets = referencedSecrets(file.workflows ?? []);
  return file;
}

export function exportFileName(configVersion: number): string {
  return `config-v${configVersion}.yaml`;
}

/** `missing` = tên cần mà chưa có giá trị; `extra` = tên gửi lên không thuộc tập cần (M4-R15). Giữ thứ tự đầu vào. */
export function checkSecretsInput(
  missing: readonly string[],
  given: Record<string, string>,
): { missing: string[]; extra: string[] } {
  const need = new Set(missing);
  return {
    missing: missing.filter((n) => !Object.hasOwn(given, n)),
    extra: Object.keys(given).filter((n) => !need.has(n)),
  };
}
