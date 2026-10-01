// ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-50 · dữ liệu fixture danh mục M2 (test-plan §3). Dùng chung cho test int (bun)
// và e2e/support (Node/Playwright): chỉ phụ thuộc `postgres`, KHÔNG import bun:test.
import type postgres from "postgres";
import { TENANT_ID } from "../M1/_data";

type Sql = postgres.Sql;

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** uuid cố định `01900000-0000-7000-8000-0000000002nn` (nn thập phân 00–99). */
export const id2 = (n: number): string => `01900000-0000-7000-8000-0000000002${pad2(n)}`;

export const ID = {
  secret: { translate: id2(1), invoice: id2(2), old: id2(3) },
  workflow: {
    translate: id2(11),
    invoiceCheck: id2(12),
    summarize: id2(13),
    reportExport: id2(14),
    reportTax: id2(15),
  },
  command: {
    dich: id2(21),
    tomTat: id2(22),
    kiemtraHoadon: id2(23),
    trNhanh: id2(24),
    xuatBaoCao: id2(25),
  },
  feature: { keToan: id2(31), dichThuat: id2(32), baoCao: id2(33), thuNghiem: id2(34) },
  /** agent "Trợ lý dịch" (hub.agent_workflows) — AC-A05. */
  agent: "01900000-0000-7000-8000-0000000002a1",
  /** uuid hợp lệ nhưng không có trong DB. */
  unknown: "01900000-0000-7000-8000-0000000002f9",
} as const;

// ---- hằng quét rò secret (AC-A06) ----
export const LEAK_1 = "sk-LEAK-Q7Zp3XvR9mT2LwB5nJc8YdHa";
export const LEAK_2 = "sk-LEAK-NEW-4Fh8KsD1yWq6ZoUe3PgM";
export const LEAK_EMOJI = "😀😀😀😀";
/** 7 ký tự: bị 400 (SECRET_VALUE_MIN = 8). */
export const LEAK_SHORT = "sk-LEAK";

/** Dạng thô, base64, hex của một chuỗi (quét rò). */
export const leakForms = (v: string): string[] => [
  v,
  Buffer.from(v, "utf8").toString("base64"),
  Buffer.from(v, "utf8").toString("hex"),
];

// ---- danh mục fixture ----
export type SecretSeed = { id: string; name: string; last4: string; note: string | null };
export type InputSeed = {
  name: string;
  type: "text" | "number" | "boolean" | "select" | "file";
  required: boolean;
  description: string;
  options?: string[];
};
export type WorkflowSeed = {
  id: string;
  key: string;
  secret: string;
  enabled: boolean;
  schema: InputSeed[];
  outputField: string | null;
};

export const SECRET_SEEDS: Record<string, SecretSeed> = {
  DIFY_TRANSLATE_KEY: {
    id: ID.secret.translate,
    name: "DIFY_TRANSLATE_KEY",
    last4: "7f3a",
    note: "App Translate trên Dify prod",
  },
  DIFY_INVOICE_KEY: { id: ID.secret.invoice, name: "DIFY_INVOICE_KEY", last4: "91c2", note: null },
  DIFY_OLD_KEY: {
    id: ID.secret.old,
    name: "DIFY_OLD_KEY",
    last4: "44aa",
    note: "Key cũ, chờ xoá",
  },
};

const inp = (
  name: string,
  type: InputSeed["type"],
  required: boolean,
  options?: string[],
): InputSeed => ({
  name,
  type,
  required,
  description: `Tham số ${name} của workflow`,
  ...(options ? { options } : {}),
});

export const WORKFLOW_SEEDS: Record<string, WorkflowSeed> = {
  translate: {
    id: ID.workflow.translate,
    key: "translate",
    secret: "DIFY_TRANSLATE_KEY",
    enabled: true,
    schema: [
      inp("source_text", "text", true),
      inp("target_lang", "text", true),
      inp("tone", "select", false, ["formal", "casual"]),
    ],
    outputField: "text",
  },
  "invoice-check": {
    id: ID.workflow.invoiceCheck,
    key: "invoice-check",
    secret: "DIFY_INVOICE_KEY",
    enabled: true,
    schema: [inp("invoice_file", "file", true)],
    outputField: "result",
  },
  summarize: {
    id: ID.workflow.summarize,
    key: "summarize",
    secret: "DIFY_INVOICE_KEY",
    enabled: true,
    schema: [inp("text", "text", true)],
    outputField: "summary",
  },
  "report-export": {
    id: ID.workflow.reportExport,
    key: "report-export",
    secret: "DIFY_INVOICE_KEY",
    enabled: false,
    schema: [],
    outputField: null,
  },
  "report-tax": {
    id: ID.workflow.reportTax,
    key: "report-tax",
    secret: "DIFY_INVOICE_KEY",
    enabled: true,
    schema: [],
    outputField: null,
  },
};

export type FeatureSeed = {
  id: string;
  key: string;
  vi: string;
  en: string;
  status: "on" | "off" | "beta";
};
export const FEATURE_SEEDS: Record<string, FeatureSeed> = {
  "ke-toan": {
    id: ID.feature.keToan,
    key: "ke-toan",
    vi: "Kế toán",
    en: "Accounting",
    status: "on",
  },
  "dich-thuat": {
    id: ID.feature.dichThuat,
    key: "dich-thuat",
    vi: "Dịch thuật",
    en: "Translation",
    status: "on",
  },
  "bao-cao": {
    id: ID.feature.baoCao,
    key: "bao-cao",
    vi: "Báo cáo",
    en: "Reports",
    status: "beta",
  },
  "thu-nghiem": {
    id: ID.feature.thuNghiem,
    key: "thu-nghiem",
    vi: "Thử nghiệm",
    en: "Experiments",
    status: "off",
  },
};

type MapEntry = { source: string; value?: string };
export type CommandSeed = {
  id: string;
  name: string;
  aliases: string[];
  workflow: string;
  features: string[];
  mode: "sync" | "async";
  enabled: boolean;
  args: unknown[];
  inputMap: Record<string, MapEntry>;
};
const arg = (name: string, rest = false) => ({
  name,
  description: { vi: `Tham số ${name}` },
  default: null,
  fallback: null,
  rest,
});
export const COMMAND_SEEDS: Record<string, CommandSeed> = {
  dich: {
    id: ID.command.dich,
    name: "dich",
    aliases: ["tr"],
    workflow: "translate",
    features: ["core"],
    mode: "sync",
    enabled: true,
    args: [arg("lang"), arg("text", true)],
    inputMap: {
      source_text: { source: "arg", value: "text" },
      target_lang: { source: "arg", value: "lang" },
    },
  },
  "tom-tat": {
    id: ID.command.tomTat,
    name: "tom-tat",
    aliases: [],
    workflow: "summarize",
    features: ["core"],
    mode: "sync",
    enabled: true,
    args: [],
    inputMap: { text: { source: "selection" } },
  },
  "kiemtra-hoadon": {
    id: ID.command.kiemtraHoadon,
    name: "kiemtra-hoadon",
    aliases: [],
    workflow: "invoice-check",
    features: ["ke-toan"],
    mode: "async",
    enabled: true,
    args: [],
    inputMap: { invoice_file: { source: "attachment" } },
  },
  "tr-nhanh": {
    id: ID.command.trNhanh,
    name: "tr-nhanh",
    aliases: [],
    workflow: "translate",
    features: ["dich-thuat"],
    mode: "sync",
    enabled: false,
    args: [arg("lang"), arg("text", true)],
    inputMap: {
      source_text: { source: "arg", value: "text" },
      target_lang: { source: "arg", value: "lang" },
    },
  },
  "xuat-bao-cao": {
    id: ID.command.xuatBaoCao,
    name: "xuat-bao-cao",
    aliases: [],
    workflow: "report-export",
    features: ["bao-cao"],
    mode: "async",
    enabled: false,
    args: [],
    inputMap: {},
  },
};

/** [feature key, tenant key, đã thu hồi]. */
export const ENTITLEMENT_SEEDS: Array<[string, "acme" | "globex" | "zeta", boolean]> = [
  ["ke-toan", "acme", false],
  ["ke-toan", "globex", true],
  ["dich-thuat", "acme", false],
  ["bao-cao", "acme", false],
  ["thu-nghiem", "acme", false],
];

export type CatalogParts = {
  secrets?: string[];
  workflows?: string[];
  features?: string[];
  commands?: string[];
  /** true = cả 5 dòng ENTITLEMENT_SEEDS (cần feature + tenant tương ứng). */
  entitlements?: boolean;
  agents?: boolean;
};
export const ALL_CATALOG: CatalogParts = {
  secrets: Object.keys(SECRET_SEEDS),
  workflows: Object.keys(WORKFLOW_SEEDS),
  features: Object.keys(FEATURE_SEEDS),
  commands: Object.keys(COMMAND_SEEDS),
  entitlements: true,
  agents: true,
};

const TENANT_BY_KEY = { acme: TENANT_ID.acme, globex: TENANT_ID.globex, zeta: TENANT_ID.zeta };
const fakeCiphertext = () => Buffer.alloc(32, 7);
const fakeIv = () => Buffer.alloc(12, 3);

async function seedSecrets(sql: Sql, keys: string[]): Promise<void> {
  for (const k of keys) {
    const s = SECRET_SEEDS[k] as SecretSeed;
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4, note)
      values (${s.id}, ${s.name}, ${fakeCiphertext()}, ${fakeIv()}, 1, ${s.last4}, ${s.note})`;
  }
}

async function seedWorkflows(sql: Sql, keys: string[]): Promise<void> {
  for (const k of keys) {
    const w = WORKFLOW_SEEDS[k] as WorkflowSeed;
    const secret = SECRET_SEEDS[w.secret] as SecretSeed;
    await sql`insert into admin.workflows
      (id, key, name, description, app_type, base_url, secret_id, input_schema, output_field, enabled)
      values (${w.id}, ${w.key}, ${`Workflow ${w.key}`}, ${`Workflow ${w.key} dùng cho kiểm thử catalog M2`},
        'workflow', 'https://dify.example.com/v1', ${secret.id}, ${sql.json(w.schema)},
        ${w.outputField}, ${w.enabled})`;
  }
}

async function seedFeatures(sql: Sql, keys: string[]): Promise<void> {
  for (const k of keys) {
    const f = FEATURE_SEEDS[k] as FeatureSeed;
    await sql`insert into admin.features (id, key, name, description, icon, status)
      values (${f.id}, ${f.key}, ${sql.json({ vi: f.vi, en: f.en })}, ${sql.json({})}, 'package', ${f.status})`;
  }
}

async function featureIdOf(sql: Sql, key: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from admin.features where key = ${key}`;
  if (!row) throw new Error(`seedCatalog: chưa có feature ${key}`);
  return row.id;
}

async function seedCommands(sql: Sql, keys: string[]): Promise<void> {
  for (const k of keys) {
    const c = COMMAND_SEEDS[k] as CommandSeed;
    const wf = WORKFLOW_SEEDS[c.workflow] as WorkflowSeed;
    await sql`insert into admin.commands
      (id, name, aliases, description, workflow_id, args, input_map, output, mode, timeout_s, enabled)
      values (${c.id}, ${c.name}, ${c.aliases}, ${sql.json({ vi: `Command ${c.name}` })}, ${wf.id},
        ${sql.json(c.args as never)}, ${sql.json(c.inputMap as never)},
        ${sql.json({ field: wf.outputField ?? "text", render: "markdown" })},
        ${c.mode}, ${c.mode === "sync" ? 30 : 120}, ${c.enabled})`;
    for (const n of [c.name, ...c.aliases]) {
      await sql`insert into admin.command_names (name, command_id) values (${n}, ${c.id})`;
    }
    for (const fk of c.features) {
      await sql`insert into admin.feature_commands (feature_id, command_id)
        values (${await featureIdOf(sql, fk)}, ${c.id})`;
    }
  }
}

async function seedEntitlements(sql: Sql): Promise<void> {
  for (const [fk, tk, revoked] of ENTITLEMENT_SEEDS) {
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id, revoked_at)
      values (${await featureIdOf(sql, fk)}, ${TENANT_BY_KEY[tk]}, ${revoked ? new Date() : null})`;
  }
}

/** Chèn danh mục bằng owner (đúng thứ tự khoá ngoại). Chỉ chèn phần được yêu cầu. */
export async function seedCatalog(sql: Sql, parts: CatalogParts): Promise<void> {
  await seedSecrets(sql, parts.secrets ?? []);
  await seedWorkflows(sql, parts.workflows ?? []);
  await seedFeatures(sql, parts.features ?? []);
  await seedCommands(sql, parts.commands ?? []);
  if (parts.entitlements) await seedEntitlements(sql);
  if (parts.agents) {
    await sql`insert into hub.agent_workflows (agent_id, workflow_id)
      values (${ID.agent}, ${ID.workflow.translate})`;
  }
}

/** Xoá toàn bộ dữ liệu người dùng + danh mục (TRUNCATE tường minh, không dựa vào CASCADE ngầm của M1). */
export async function truncateCatalog(sql: Sql): Promise<void> {
  await sql`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features,
    admin.secrets, admin.workflows, admin.commands cascade`;
  await sql`truncate hub.agent_workflows`;
}
