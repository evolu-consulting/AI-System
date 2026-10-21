// dify-demo-flow · luật thuần của `dify-register`: cờ CLI, app "Kiểm tra hạn mức duyệt hợp đồng" (workflow Dify không LLM,
// DSL ở deploy/prod-sohoptac2/dify/han-muc-duyet.yml), kế hoạch (không bao giờ chứa key). Dùng lại bước ghi của seed:dify.
import type { ArgSpec, CommandSpec, Localized, WorkflowSpec } from "./seed-dify-live.apps";
import type { CommandWant, SeedPlan, WorkflowWant } from "./seed-dify-live.rules";

export const HMD_SECRET = "DIFY_KEY_HAN_MUC_DUYET";
export const HMD_FEATURE = {
  key: "han-muc-duyet",
  name: { vi: "Kiểm tra hạn mức duyệt", en: "Approval limit check" },
} as const;
/** Mã app Dify = UUID trong URL console (khớp DifyAppIdSchema: chữ/số/gạch ngang ≤ 64). */
export const APP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const CONTRACT_TYPES = ["Mua", "Bán", "Giới thiệu"];
const arg = (name: string, vi: string, en: string, o: Partial<ArgSpec> = {}): ArgSpec => ({
  name,
  description: { vi, en },
  default: null,
  fallback: null,
  rest: false,
  ...o,
});

export const HMD_WORKFLOW: WorkflowSpec = {
  key: "dify-han-muc-duyet",
  name: "Kiểm tra hạn mức duyệt hợp đồng (Dify)",
  description:
    "Tra chính sách hạn mức duyệt QC-TC-01: cho giá trị hợp đồng (VND) và loại hợp đồng (Mua/Bán/Giới thiệu), trả về ai (chức danh nào) phải duyệt và chuỗi các cấp duyệt. Dùng khi người dùng hỏi hợp đồng giá trị bao nhiêu thì ai phải duyệt/ký. Thiếu giá trị hoặc loại hợp đồng thì hỏi lại người dùng, không đoán. Không dùng để tra hay sửa một hợp đồng cụ thể.",
  app_type: "workflow",
  input_schema: [
    {
      name: "contract_value",
      type: "number",
      required: true,
      description: "Giá trị hợp đồng bằng số, đơn vị VND (vd 600000000 cho 600 triệu)",
    },
    {
      name: "contract_type",
      type: "select",
      required: true,
      description: "Loại hợp đồng: Mua, Bán hoặc Giới thiệu",
      options: CONTRACT_TYPES,
    },
    { name: "partner_name", type: "text", required: false, description: "Tên đối tác (tuỳ chọn)" },
  ],
  output_field: "note",
};

export const HMD_COMMAND: CommandSpec = {
  name: "han-muc-duyet",
  description: {
    vi: "Kiểm tra cấp duyệt hợp đồng theo hạn mức (vd /han-muc-duyet 600000000 Mua)",
    en: "Check contract approval level by value (e.g. /han-muc-duyet 600000000 Mua)",
  },
  args: [
    arg("value", "Giá trị hợp đồng (VND)", "Contract value (VND)"),
    arg("type", "Loại: Mua | Bán | Giới thiệu", "Type: Mua | Bán | Giới thiệu"),
    arg("partner", "Tên đối tác (tuỳ chọn)", "Partner name (optional)", { rest: true }),
  ],
  input_map: {
    contract_value: { source: "arg", value: "value" },
    contract_type: { source: "arg", value: "type" },
    partner_name: { source: "arg", value: "partner" },
  },
  output: { field: "note", render: "markdown" },
  timeout_s: 30,
};

export type RegisterArgs = {
  apply: boolean;
  tenant: string;
  appId: string;
  baseUrl: string;
  /** Rỗng ⇒ mọi Group đang có quyền `contracts-read` của tenant. */
  group: string | null;
  rotateKey: boolean;
};

const VALUE_FLAGS: Record<string, "tenant" | "appId" | "baseUrl" | "group"> = {
  "--tenant": "tenant",
  "--app-id": "appId",
  "--base-url": "baseUrl",
  "--group": "group",
};

/** Tách cờ: trả lỗi hoặc null. Cờ giá trị nhận `--cờ=giá trị` hoặc `--cờ giá trị`. */
function readFlags(argv: string[], r: Partial<RegisterArgs>): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (flag === "--apply") r.apply = true;
    else if (flag === "--rotate-key") r.rotateKey = true;
    else {
      const err = setValue(r, flag, eq > 0 ? a.slice(eq + 1) : argv[++i]);
      if (err) return err;
    }
  }
  return null;
}

function setValue(r: Partial<RegisterArgs>, flag: string, v: string | undefined): string | null {
  const key = VALUE_FLAGS[flag];
  if (!key) return `cờ không hỗ trợ: ${flag}`;
  if (!v) return `${flag} cần giá trị`;
  r[key] = v;
  return null;
}

function checkFlags(r: Partial<RegisterArgs>): string | null {
  if (!r.tenant || !KEY_RE.test(r.tenant)) return "--tenant cần key hợp lệ (a-z, 0-9, -)";
  if (!r.appId || !APP_ID_RE.test(r.appId))
    return "--app-id cần mã app Dify (UUID trong URL console)";
  if (r.group && !KEY_RE.test(r.group)) return "--group cần key hợp lệ";
  return null;
}

/** `--tenant`, `--app-id`, `--base-url` bắt buộc; `--group`, `--apply`, `--rotate-key` tuỳ chọn. Cờ lạ ⇒ lỗi. */
export function parseRegisterArgs(argv: string[]): RegisterArgs | { error: string } {
  const r: Partial<RegisterArgs> = { apply: false, rotateKey: false, group: null };
  const err = readFlags(argv, r) ?? checkFlags(r);
  if (err) return { error: err };
  const base = normalizeBaseUrl(r.baseUrl);
  if (!base) return { error: "--base-url cần http(s)://…/v1 (không chứa user:pass)" };
  return { ...(r as RegisterArgs), baseUrl: base };
}

/** Bỏ `/` cuối; chỉ http(s), không userinfo/query. Dify service API nằm ở `<gốc>/v1`. */
export function normalizeBaseUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(v) || !URL.canParse(v)) return null;
  const u = new URL(v);
  if (u.username || u.password || u.search || u.hash) return null;
  return v;
}

/** Kế hoạch dạng `SeedPlan` (dùng lại `ensure*` của seed:dify). Đầu vào không có key ⇒ plan không thể chứa key. */
export function buildRegisterPlan(a: RegisterArgs): SeedPlan {
  const workflow: WorkflowWant = {
    ...HMD_WORKFLOW,
    dify_app_id: a.appId,
    base_url: a.baseUrl,
    side_effect: false,
    secret_name: HMD_SECRET,
  };
  const command: CommandWant = { ...HMD_COMMAND, mode: "sync", workflow_key: HMD_WORKFLOW.key };
  const noName: Localized = { vi: "", en: "" };
  return {
    mode: a.apply ? "apply" : "dry-run",
    tenant: a.tenant,
    group: {
      key: a.group ?? "(nhóm có quyền contracts)",
      name: noName,
      description: "",
      members: [],
    },
    feature: { key: HMD_FEATURE.key, name: { ...HMD_FEATURE.name } },
    rotate_secrets: a.rotateKey,
    secrets: [{ name: HMD_SECRET, app: "han-muc-duyet" }],
    workflows: [workflow],
    commands: [command],
    agent: null,
  };
}

/** Bản in dry-run: không key, không URL kèm token. */
export function formatRegisterPlan(p: SeedPlan, a: RegisterArgs): string {
  const w = p.workflows[0] as WorkflowWant;
  const c = p.commands[0] as CommandWant;
  return [
    `dify-register — ${a.apply ? "GHI (--apply)" : "DRY-RUN (không ghi gì; thêm --apply để ghi)"}`,
    `tenant ${p.tenant} (chỉ tenant này được bật feature ${p.feature.key})`,
    `secret ${HMD_SECRET} (${a.rotateKey ? "tạo hoặc xoay" : "tạo nếu vắng, có rồi thì giữ"}; giá trị từ env DIFY_APP_KEY)`,
    `workflow ${w.key} [${w.app_type}] dify_app_id=${a.appId} base_url=${w.base_url} output ${w.output_field} (tạo/cập nhật)`,
    `command /${c.name} → ${w.key} · args: ${c.args.map((x) => x.name).join(", ")} (mode sync, ${c.timeout_s}s)`,
    `entitlement ${p.feature.key} → ${p.tenant}; grant → ${a.group ? `group ${a.group}` : "mọi Group có quyền contracts-read"}`,
  ].join("\n");
}
