// tenant-owner · luật thuần của script tenant-owner-setup: đọc tham số, kế hoạch → dòng in, nội dung file thông tin đăng nhập.
// Không đụng DB/file. Mật khẩu chỉ xuất hiện trong `credentialsText` (ghi ra file 600), không bao giờ trong dòng in.
import { DisplayNameSchema, TenantKeySchema, UsernameSchema } from "@ai/contracts";

/** Tenant không bao giờ được tạo chủ bằng script này. */
export const REFUSED_TENANTS: readonly string[] = ["platform", "demo"];
export const OWNER_PASSWORD_LEN = 24;
/** Tên phòng ban "đỉnh" nhận chủ tenant làm trưởng phòng (so khớp không phân biệt hoa/thường, bỏ khoảng trắng thừa). */
export const TOP_DEPARTMENT = "Phòng Giám đốc";

export type OwnerArgs = {
  tenant: string;
  name: string;
  username: string;
  apply: boolean;
  out: string;
};

export const defaultOut = (tenant: string): string => `/claude-home/TENANT_OWNER_${tenant}.txt`;

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--"))
    throw new Error(`tenant-owner-setup: ${flag} thiếu giá trị`);
  return v;
}

function parsed<T>(
  schema: { safeParse(x: unknown): { success: boolean; data?: T } },
  v: string,
  what: string,
): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new Error(`tenant-owner-setup: ${what} không hợp lệ: ${JSON.stringify(v)}`);
  return r.data as T;
}

/** `--tenant <key> --name "<họ tên>" --username <u> [--apply] [--out <file>]`. Sai ⇒ ném Error có lý do. */
export function parseOwnerArgs(argv: readonly string[]): OwnerArgs {
  const t = flagValue(argv, "--tenant");
  const n = flagValue(argv, "--name");
  const u = flagValue(argv, "--username");
  if (!t || !n || !u)
    throw new Error(
      'tenant-owner-setup: cần --tenant <key> --name "<họ tên>" --username <u> [--apply] [--out <file>]',
    );
  const tenant = parsed<string>(TenantKeySchema, t, "--tenant");
  if (REFUSED_TENANTS.includes(tenant))
    throw new Error(
      `tenant-owner-setup: từ chối tenant "${tenant}" (không tạo chủ cho platform/demo)`,
    );
  return {
    tenant,
    name: parsed<string>(DisplayNameSchema, n, "--name"),
    username: parsed<string>(UsernameSchema, u, "--username"),
    apply: argv.includes("--apply"),
    out: flagValue(argv, "--out") ?? defaultOut(tenant),
  };
}

export const normName = (s: string): string =>
  s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export type OwnerPlan =
  | { kind: "exists" }
  | {
      kind: "create";
      tenantId: string;
      /** Platform admin ghi vào updated_by/audit. */
      actor: { id: string; username: string };
      /** Group giữ `contracts-admin` (ưu tiên `contracts-owner`). */
      group: { id: string; key: string };
      /** Phòng ban đỉnh (Phòng Giám đốc); null ⇒ không đặt trưởng phòng. */
      dept: { groupId: string; key: string; prevHead: string | null } | null;
    };

/** Kế hoạch → dòng in (không có mật khẩu). */
export function describeOwnerPlan(p: OwnerPlan, a: OwnerArgs): string[] {
  if (p.kind === "exists") return ["exists, nothing to do"];
  const head = p.dept
    ? `trưởng phòng ${p.dept.key}${p.dept.prevHead ? ` (thay ${p.dept.prevHead})` : ""}`
    : `không có phòng "${TOP_DEPARTMENT}" ⇒ không đặt trưởng phòng`;
  return [
    `tạo user ${a.username} "${a.name}" · tenant_admin · locale vi · KHÔNG email · bắt đổi mật khẩu`,
    `thêm vào Group ${p.group.key} (contracts · Chủ sở hữu)`,
    head,
    `mật khẩu ${OWNER_PASSWORD_LEN} ký tự ⇒ chỉ ghi vào ${a.out} (mode 600)`,
    `người ghi (audit): ${p.actor.username}`,
  ];
}

/** Nội dung file thông tin đăng nhập (mode 600). */
export function credentialsText(a: OwnerArgs, password: string): string {
  return [
    `tenant: ${a.tenant}`,
    `username: ${a.username}`,
    `display_name: ${a.name}`,
    `password: ${password}`,
    "must_change_password: true (đổi ở lần đăng nhập đầu)",
    "",
  ].join("\n");
}
