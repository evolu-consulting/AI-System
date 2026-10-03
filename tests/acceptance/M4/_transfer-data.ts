// ADM-FR-54 · M4-R14 · dữ liệu Import/Export dựng trong code (test-plan-cd §0 "Dữ liệu yaml"): snapshot dạng phần tử
// file (plan-cd §3.2) từ fixture M1–M3, file yaml cho int, file 1 MiB, bom alias. Không file lớn trong repo.
// Yaml sinh ra ở dạng JSON (JSON hợp lệ là YAML 1.2) — chỉ ca cú pháp dùng văn bản yaml khối viết tay.
// Không import bun:test (dùng được cho e2e Node).
import { COMMAND_SEEDS, FEATURE_SEEDS, WORKFLOW_SEEDS } from "../M2/_data";

// biome-ignore lint/suspicious/noExplicitAny: phần tử file dựng tay, kiểu thật nằm trong contract chưa có (T7)
type Obj = Record<string, any>;

export const MAX_BYTES = 1_048_576;
export const EXPORTED_AT = "2026-10-01T09:00:00.000Z";
export const FILE_NAME = "config-v7.yaml";
export const FROM_VERSION = 7;
export const TYPES = ["workflows", "commands", "features", "tenants", "groups", "grants"] as const;

export const workflowEl = (key: string): Obj => {
  const w = WORKFLOW_SEEDS[key];
  if (!w) throw new Error(`không có workflow fixture ${key}`);
  return {
    key,
    name: `Workflow ${key}`,
    description: `Workflow ${key} dùng cho kiểm thử catalog M2`,
    app_type: "workflow",
    base_url: "https://dify.example.com/v1",
    secret: w.secret,
    input_schema: w.schema,
    output_field: w.outputField,
    enabled: w.enabled,
  };
};

export const commandEl = (name: string): Obj => {
  const c = COMMAND_SEEDS[name];
  if (!c) throw new Error(`không có command fixture ${name}`);
  const wf = WORKFLOW_SEEDS[c.workflow];
  return {
    name,
    aliases: c.aliases,
    description: { vi: `Command ${name}` },
    workflow: c.workflow,
    args: c.args,
    input_map: c.inputMap,
    output: { field: wf?.outputField ?? "text", render: "markdown" },
    mode: c.mode,
    timeout_s: c.mode === "sync" ? 30 : 120,
    enabled: c.enabled,
  };
};

const featureCommands = (key: string) =>
  Object.values(COMMAND_SEEDS)
    .filter((c) => c.features.includes(key))
    .map((c) => c.name)
    .sort();

export const featureEl = (key: string): Obj => {
  if (key === "core") {
    return {
      key: "core",
      name: { vi: "Lõi", en: "Core" },
      description: {},
      icon: "package",
      status: "on",
      commands: featureCommands("core"),
    };
  }
  const f = FEATURE_SEEDS[key];
  if (!f) throw new Error(`không có feature fixture ${key}`);
  return {
    key,
    name: { vi: f.vi, en: f.en },
    description: {},
    icon: "package",
    status: f.status,
    commands: featureCommands(key),
  };
};

export const tenantEl = (key: "acme" | "globex" | "zeta", over: Obj = {}): Obj => {
  const base: Record<string, Obj> = {
    acme: {
      name: "Acme Corp",
      max_concurrent_sub: 5,
      entitlements: ["bao-cao", "dich-thuat", "ke-toan"],
    },
    globex: { name: "Globex", max_concurrent_sub: null, entitlements: [] },
    zeta: { name: "Zeta Ltd", max_concurrent_sub: null, entitlements: [] },
  };
  return { key, ...base[key], quotas: [], ...over };
};

export const groupEl = (
  tenant: string,
  key: string,
  vi: string,
  description: string | null = null,
) => ({
  tenant,
  key,
  name: { vi },
  description,
});
export const grantEl = (tenant: string, group: string, feature: string) => ({
  tenant,
  group,
  feature,
});

/**
 * Snapshot cho luật thuần (`planImport`, `buildExportFile`): dạng phần tử file, CỐ Ý không sắp xếp
 * (C-R02 kiểm hàm tự sắp). Khác fixture DB một chỗ: acme CHƯA entitlement `thu-nghiem` (C-R13).
 */
export function ruleSnapshot(): Obj {
  return {
    configVersion: 43,
    secrets: ["DIFY_TRANSLATE_KEY", "DIFY_OLD_KEY", "DIFY_INVOICE_KEY"],
    workflows: ["translate", "summarize", "invoice-check", "report-tax", "report-export"].map(
      workflowEl,
    ),
    commands: ["tom-tat", "dich", "xuat-bao-cao", "kiemtra-hoadon", "tr-nhanh"].map(commandEl),
    features: ["thu-nghiem", "core", "ke-toan", "dich-thuat", "bao-cao"].map(featureEl),
    tenants: [tenantEl("globex"), tenantEl("acme"), tenantEl("zeta")],
    groups: [
      groupEl("globex", "ke-toan", "Kế toán"),
      groupEl("acme", "kinh-doanh", "Kinh doanh"),
      groupEl("acme", "ke-toan", "Kế toán", "Phòng kế toán"),
    ],
    grants: [grantEl("globex", "ke-toan", "ke-toan"), grantEl("acme", "ke-toan", "ke-toan")],
  };
}

/** Phần đầu file hợp lệ (plan-cd §3.2). */
export const header = (configVersion = FROM_VERSION): Obj => ({
  format: "ai-system/config",
  format_version: 1,
  config_version: configVersion,
  exported_at: EXPORTED_AT,
});

/** File đầy đủ từ snapshot (mọi phần tử, không đổi gì) — điểm xuất phát để sửa từng ca luật. */
export function fileOf(s: Obj, over: Obj = {}): Obj {
  const used = new Set<string>((s.workflows ?? []).map((w: Obj) => w.secret));
  return {
    ...header(s.configVersion),
    secrets: [...used].sort().map((name) => ({ name })),
    ...Object.fromEntries(TYPES.map((t) => [t, s[t] ?? []])),
    ...over,
  };
}

export const NEW_DESC = "Dịch văn bản giữa các ngôn ngữ — bản import";
export const REPORT_NEW: Obj = {
  key: "report-new",
  name: "Workflow report-new",
  description: "Workflow report-new tạo từ file import",
  app_type: "workflow",
  base_url: "https://dify.example.com/v1",
  secret: "DIFY_REPORT_KEY",
  input_schema: [],
  output_field: null,
  enabled: true,
};
export const BAO_CAO_MOI: Obj = {
  name: "bao-cao-moi",
  aliases: [],
  description: { vi: "Command bao-cao-moi" },
  workflow: "report-new",
  args: [],
  input_map: {},
  output: { field: "text", render: "markdown" },
  mode: "sync",
  timeout_s: 30,
  enabled: true,
};

/**
 * File int C-I01 (dạng object): sửa `translate.description`, sửa `acme.name`, thêm workflow `report-new`
 * (secret `DIFY_REPORT_KEY` chưa có), thêm command `bao-cao-moi` vào `bao-cao.commands`.
 * Chỉ gồm phần tử đổi → summary {added 2, updated 3, unchanged 0}.
 */
export function baseObject(): Obj {
  return {
    ...header(),
    secrets: [{ name: "DIFY_REPORT_KEY" }, { name: "DIFY_TRANSLATE_KEY" }],
    workflows: [{ ...workflowEl("translate"), description: NEW_DESC }, REPORT_NEW],
    commands: [BAO_CAO_MOI],
    features: [{ ...featureEl("bao-cao"), commands: ["bao-cao-moi", "xuat-bao-cao"] }],
    tenants: [
      tenantEl("acme", {
        name: "Acme Corporation",
        entitlements: ["bao-cao", "dich-thuat", "ke-toan", "thu-nghiem"],
      }),
    ],
  };
}

/** Object → nội dung yaml (JSON là YAML 1.2 hợp lệ; dòng đầu là comment yaml). */
export const toYaml = (o: Obj): string =>
  `# ai-system config (qc)\n${JSON.stringify(o, null, 2)}\n`;

export const baseFile = (): string => toYaml(baseObject());

/** Thêm comment `#` cuối file cho tới đúng `bytes` byte UTF-8. */
export function padTo(content: string, bytes: number): string {
  const head = `${content}#`;
  const left = bytes - Buffer.byteLength(head, "utf8");
  if (left < 0) throw new Error("padTo: nội dung đã dài hơn đích");
  return head + "x".repeat(left);
}

/** Comment toàn "ệ" (3 byte) cho tới đúng `bytes` byte (số ký tự < số byte). */
export function multiByte(content: string, bytes: number): string {
  const head = `${content}#`;
  let left = bytes - Buffer.byteLength(head, "utf8");
  const k = Math.floor(left / 3);
  left -= k * 3;
  return head + "ệ".repeat(k) + "x".repeat(left);
}

/** "Billion laughs" `levels` tầng, mỗi tầng 9 alias của tầng trước. */
export function bomAlias(levels = 9): string {
  const lines = ['a0: &a0 ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]'];
  for (let i = 1; i <= levels; i++) {
    lines.push(
      `a${i}: &a${i} [${Array(9)
        .fill(`*a${i - 1}`)
        .join(",")}]`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Một anchor + một alias (hợp lệ YAML, nhưng `maxAliasCount: 0` phải từ chối). */
export const ONE_ALIAS = `format: ai-system/config
format_version: 1
config_version: 7
exported_at: "${EXPORTED_AT}"
workflows:
  - &w
    key: summarize
  - *w
`;

/** Lỗi cú pháp ở dòng 3 (khoá map lồng trong map gọn). */
export const BROKEN_LINE3 = `format: ai-system/config
format_version: 1
config_version: : 7
exported_at: "${EXPORTED_AT}"
`;

/** Khoá map trùng (`name:` 2 lần) — `uniqueKeys` phải từ chối. */
export const DUP_KEYS = `format: ai-system/config
format_version: 1
config_version: 7
exported_at: "${EXPORTED_AT}"
tenants:
  - key: acme
    name: Acme Corp
    name: Acme Again
    max_concurrent_sub: 5
    entitlements: []
    quotas: []
`;
