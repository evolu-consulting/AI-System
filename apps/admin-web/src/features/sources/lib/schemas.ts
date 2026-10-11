// ADM-FR-68 · PB-R02/R19 · validate form nguồn phía client (plan-frontend §3). Thông điệp là KEY i18n; luật khớp contract
// (`SOURCE_KEY_RE`, `GitUrlSchema`, `BranchSchema`, `PathSchema`). Hàm thuần để test, không phụ thuộc React.
import type { SourceConfig, SourceCreateRequest, SourceKind } from "@ai/contracts/hub-admin";
import {
  SOURCE_BRANCH_MAX,
  SOURCE_DESC_MAX,
  SOURCE_KEY_RE,
  SOURCE_PATH_MAX,
  SOURCE_URL_MAX,
} from "@ai/contracts/hub-admin";
import type { Resolver } from "react-hook-form";

export type SourceFormMode = "new" | "edit";
export type SourceFormValues = {
  key: string;
  kind: SourceKind;
  url: string;
  branch: string;
  path: string;
  document_id: string;
  /** Mã công ty (`tenant.key`) — chỉ platform_admin khi tạo mới. */
  tenant: string;
  description: string;
};
export type SourceField = keyof SourceFormValues;
export type SourceFormErrors = Partial<Record<SourceField, string>>;
export type SourceFormContext = { mode: SourceFormMode; isPlatform: boolean };

const P = "process.sources.err";

export const EMPTY_SOURCE_FORM: SourceFormValues = {
  key: "",
  kind: "git_remote",
  url: "",
  branch: "main",
  path: "",
  document_id: "",
  tenant: "",
  description: "",
};

/** Ký hiệu: trim + chữ thường (người dùng dán "Docs " vẫn hợp lệ). */
export const normalizeSourceKey = (v: string): string => v.trim().toLowerCase();

function urlError(raw: string): string | undefined {
  const v = raw.trim();
  if (v === "") return `${P}.url.required`;
  if (v.length > SOURCE_URL_MAX) return `${P}.url.tooLong`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return `${P}.url.https`;
  }
  if (u.protocol !== "https:") return `${P}.url.https`;
  if (u.username !== "" || u.password !== "" || /^https:\/\/[^/?#]*@/i.test(v)) {
    return `${P}.url.credential`;
  }
  return undefined;
}

function branchError(raw: string): string | undefined {
  const v = raw.trim();
  if (v === "") return `${P}.branch.required`;
  if (v.length > SOURCE_BRANCH_MAX) return `${P}.branch.tooLong`;
  if (v.startsWith("-")) return `${P}.branch.dash`;
  return undefined;
}

function pathError(raw: string): string | undefined {
  const v = raw.trim();
  if (v === "") return `${P}.path.required`;
  if (v.length > SOURCE_PATH_MAX) return `${P}.path.tooLong`;
  return undefined;
}

/** Lỗi theo ô (rỗng = hợp lệ). Chỉ kiểm ô của `kind` đang chọn; `key`/`tenant` chỉ khi tạo mới. */
export function validateSourceForm(v: SourceFormValues, ctx: SourceFormContext): SourceFormErrors {
  const e: SourceFormErrors = {};
  if (ctx.mode === "new") {
    if (!SOURCE_KEY_RE.test(normalizeSourceKey(v.key))) e.key = `${P}.key.invalid`;
    if (ctx.isPlatform && v.tenant === "") e.tenant = `${P}.tenant.required`;
  }
  if (v.kind === "git_remote") {
    e.url = urlError(v.url);
    e.branch = branchError(v.branch);
  } else if (v.kind === "local_path") {
    e.path = pathError(v.path);
  } else if (v.document_id === "") {
    e.document_id = `${P}.document.required`;
  }
  if (v.description.length > SOURCE_DESC_MAX) e.description = `${P}.desc.tooLong`;
  return Object.fromEntries(Object.entries(e).filter(([, m]) => m !== undefined));
}

/** Resolver cho react-hook-form (không dùng zod: luật phụ thuộc `kind` + vai, đơn giản hơn khi viết tay). */
export function sourceResolver(ctx: SourceFormContext): Resolver<SourceFormValues> {
  return async (values) => {
    const errs = validateSourceForm(values, ctx);
    const entries = Object.entries(errs) as [SourceField, string][];
    if (entries.length === 0) return { values, errors: {} };
    return {
      values: {},
      errors: Object.fromEntries(
        entries.map(([k, message]) => [k, { type: "validate", message }]),
      ) as never,
    };
  };
}

/** Form → `config` gửi server theo loại (đã trim). */
export function toConfig(v: SourceFormValues): SourceConfig {
  if (v.kind === "git_remote") {
    return { kind: "git_remote", url: v.url.trim(), branch: v.branch.trim() };
  }
  if (v.kind === "local_path") return { kind: "local_path", path: v.path.trim() };
  return { kind: "library", document_id: v.document_id };
}

/** Form (tạo mới) → body POST; `tenantId` chỉ có với platform_admin. */
export function toCreateRequest(
  v: SourceFormValues,
  tenantId: string | undefined,
): SourceCreateRequest {
  return {
    key: normalizeSourceKey(v.key),
    kind: v.kind,
    config: toConfig(v),
    description: v.description.trim(),
    ...(tenantId ? { tenant_id: tenantId } : {}),
  };
}

/** Cấu hình đã lưu → giá trị ban đầu của form (không có `path` khi bản công khai). */
export function toFormValues(
  src: { key: string; kind: SourceKind; description: string },
  config: SourceConfig | null,
): SourceFormValues {
  const base = { ...EMPTY_SOURCE_FORM, key: src.key, kind: src.kind, description: src.description };
  if (!config) return base;
  if (config.kind === "git_remote") return { ...base, url: config.url, branch: config.branch };
  if (config.kind === "local_path") return { ...base, path: config.path };
  return { ...base, document_id: config.document_id };
}

/** `details.issues[0].path[0]` của VALIDATION_ERROR → ô tương ứng (config.url/branch/path/document_id, key, description, tenant_id). */
export function fieldFromIssues(details: unknown): { field: SourceField; key: string } | null {
  const issues = (details as { issues?: { path?: unknown[] }[] } | null | undefined)?.issues;
  const path = issues?.[0]?.path;
  const [a, b] = [path?.[0], path?.[1]];
  if (a === "key") return { field: "key", key: `${P}.key.invalid` };
  if (a === "description") return { field: "description", key: `${P}.desc.tooLong` };
  if (a === "tenant_id") return { field: "tenant", key: `${P}.tenant.required` };
  if (a !== "config") return null;
  if (b === "url") return { field: "url", key: `${P}.url.https` };
  if (b === "branch") return { field: "branch", key: `${P}.branch.required` };
  if (b === "path") return { field: "path", key: `${P}.path.required` };
  if (b === "document_id") return { field: "document_id", key: `${P}.document.required` };
  return null;
}
