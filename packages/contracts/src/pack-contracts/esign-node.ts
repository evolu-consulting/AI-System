// CR-122 · E5 · FLOW2-FR-25 · cấu hình node Ký số THEO TỪNG NODE (flow-model.md bảng node: nhà cung cấp, người ký công ty, đối tác ký, thứ tự,
// hạn, nhắc). Tất cả tuỳ chọn: trường trống ⇒ lấy cài đặt ký số của app (`/esign/settings`) như trước.
// Cấu hình ghi ở `args` của stage tool `contracts-esign-send`; `args` của stage tool chỉ nhận giá trị ĐƠN (chuỗi/số/boolean) nên có hai
// dạng: logic (`EsignNodeConfig`, mảng) và dạng args (`encodeEsignNodeArgs`/`decodeEsignNodeArgs`, `company_signers` = chuỗi
// `user:<uuid>,group:<uuid>`). Panel node dùng dạng logic; lưu def đổi sang dạng args.
import { z } from "zod";
import type { ESignProviderOut } from "./esign";

export const ESIGN_NODE_ORDERS = ["parallel", "sequential"] as const;
export type EsignNodeOrder = (typeof ESIGN_NODE_ORDERS)[number];
export const ESIGN_NODE_SIGNERS_MAX = 3;
export const ESIGN_NODE_DUE_DAYS_MAX = 90;
/** CR-127 · P2 · BR-60: hạn ký theo GIỜ (ký cùng lúc: mặc định 4 giờ) — cùng trần với hạn ngày. */
export const ESIGN_NODE_DUE_HOURS_MAX = ESIGN_NODE_DUE_DAYS_MAX * 24;
export const ESIGN_NODE_REMIND_HOURS_MAX = 720;

export const EsignNodeSignerSchema = z.strictObject({
  kind: z.enum(["user", "group"]),
  id: z.uuid(),
});
export type EsignNodeSigner = z.infer<typeof EsignNodeSignerSchema>;

export const EsignNodeConfigSchema = z.strictObject({
  // CR-125 · m4 · MOD-FR-11: node KHÔNG còn nhà cung cấp — người ký chọn cách ký lúc ký; `provider` cũ trong def đã lưu bị bỏ qua khi đọc.
  /** Người ký phía công ty: người cụ thể hoặc Group (mọi thành viên còn dùng được). Vắng ⇒ người bắt đầu lượt như trước. */
  company_signers: z.array(EsignNodeSignerSchema).min(1).max(ESIGN_NODE_SIGNERS_MAX).optional(),
  /** `true` ⇒ bắt buộc có đối tác ký (thiếu email ⇒ lỗi); `false` ⇒ chỉ công ty ký; vắng ⇒ có email thì đối tác ký như trước. */
  partner_signs: z.boolean().optional(),
  /** Song song (cùng lúc) / tuần tự (lần lượt theo danh sách, đối tác sau). Vắng ⇒ tuần tự như trước. */
  order: z.enum(ESIGN_NODE_ORDERS).optional(),
  /** Hạn ký (ngày) — panel đặt cùng `timeout_h` của stage chờ (`esignWaitTimeoutH`). */
  due_days: z.number().int().min(1).max(ESIGN_NODE_DUE_DAYS_MAX).optional(),
  /** CR-127 · P2 · hạn ký theo giờ; có cả hai ⇒ giờ thắng (`esignWaitTimeoutH`). */
  due_hours: z.number().int().min(1).max(ESIGN_NODE_DUE_HOURS_MAX).optional(),
  /** Nhắc người ký chưa ký mỗi N giờ. */
  remind_every_hours: z.number().int().min(1).max(ESIGN_NODE_REMIND_HOURS_MAX).optional(),
});
export type EsignNodeConfig = z.infer<typeof EsignNodeConfigSchema>;

/** Khoá tham số của tool `contracts-esign-send` (ngoài `contract_id`) — khớp `EsignNodeConfig`. */
export const ESIGN_NODE_PARAMS = [
  "company_signers",
  "partner_signs",
  "order",
  "due_days",
  "due_hours",
  "remind_every_hours",
] as const;

type Scalar = string | number | boolean;
export type EsignNodeArgs = Partial<Record<(typeof ESIGN_NODE_PARAMS)[number], Scalar>>;

const SIGNER_RE = /^(user|group):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Cấu hình logic ⇒ `args` (giá trị đơn). Trường vắng không xuất hiện. */
export function encodeEsignNodeArgs(c: EsignNodeConfig): EsignNodeArgs {
  const out: EsignNodeArgs = {};
  if (c.company_signers)
    out.company_signers = c.company_signers.map((s) => `${s.kind}:${s.id}`).join(",");
  if (c.partner_signs !== undefined) out.partner_signs = c.partner_signs;
  if (c.order !== undefined) out.order = c.order;
  if (c.due_days !== undefined) out.due_days = c.due_days;
  if (c.due_hours !== undefined) out.due_hours = c.due_hours;
  if (c.remind_every_hours !== undefined) out.remind_every_hours = c.remind_every_hours;
  return out;
}

const asBool = (v: Scalar): boolean | Scalar => (v === "true" ? true : v === "false" ? false : v);
const asNum = (v: Scalar): number | Scalar =>
  typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : v;

/**
 * `args` của stage ⇒ cấu hình đã kiểm. Bỏ qua khoá không thuộc cấu hình (vd `contract_id`); giá trị rỗng ("") coi như vắng.
 * Sai ⇒ `{ ok: false, issues }` (mỗi issue = khoá tham số sai).
 */
export function decodeEsignNodeArgs(
  args: Readonly<Record<string, Scalar>>,
): { ok: true; config: EsignNodeConfig } | { ok: false; issues: string[] } {
  const raw: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const k of ESIGN_NODE_PARAMS) {
    const v = args[k];
    if (v === undefined || v === "") continue;
    const got = coerce(k, v);
    if (got === BAD) issues.push(k);
    else raw[k] = got;
  }
  const p = EsignNodeConfigSchema.safeParse(raw);
  if (!p.success) for (const i of p.error.issues) issues.push(String(i.path[0] ?? "config"));
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] };
  return p.success ? { ok: true, config: p.data } : { ok: false, issues: ["config"] };
}

const BAD = Symbol("bad");
/** Giá trị đơn của `args` ⇒ giá trị logic (chuỗi người ký ⇒ mảng; "true"/"3" ⇒ boolean/số); chuỗi người ký sai dạng ⇒ `BAD`. */
function coerce(k: (typeof ESIGN_NODE_PARAMS)[number], v: Scalar): unknown {
  if (k === "company_signers") return signersOf(String(v));
  if (k === "partner_signs") return asBool(v);
  if (k === "due_days" || k === "due_hours" || k === "remind_every_hours") return asNum(v);
  return v;
}
function signersOf(s: string): unknown {
  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const list = parts.map((p) => SIGNER_RE.exec(p));
  const ok = list.filter((m): m is RegExpExecArray => m !== null);
  if (ok.length !== list.length) return BAD;
  return ok.map((m) => ({ kind: m[1]?.toLowerCase(), id: m[2] }));
}

/**
 * CR-125 · m4 · CEO-review #2 · MỘT luật cho cấu hình node Ký số (panel, validator lúc lưu, tool lúc chạy): phải chọn người ký phía công ty
 * (người hoặc phòng ban) — không còn «người bắt đầu lượt» ngầm (bước tự chạy sau duyệt không có người bắt đầu ⇒ dừng im lặng).
 */
export const ESIGN_NODE_NO_SIGNER_SELECTED = "NO_SIGNER_SELECTED";
export function esignConfigIssues(c: EsignNodeConfig): { field: string; code: string }[] {
  return c.company_signers?.length
    ? []
    : [{ field: "company_signers", code: ESIGN_NODE_NO_SIGNER_SELECTED }];
}

/** Hạn ký (giờ): `due_hours` thắng `due_days × 24`; vắng ⇒ null. MỘT luật cho stage chờ và tool gửi ký. */
export const esignDueHours = (c: EsignNodeConfig): number | null =>
  c.due_hours ?? (c.due_days === undefined ? null : c.due_days * 24);

/** Giờ chờ của stage "chờ ký" theo hạn ký; vắng ⇒ null (giữ `timeout_h` mặc định của node). */
export const esignWaitTimeoutH = (c: EsignNodeConfig): number | null => esignDueHours(c);

/** Tên nhà cung cấp/Group cho ô chọn của panel node: `GET /pack/contracts/esign/options`. */
export type ESignNodeOptionsOut = {
  /** Chỉ nhà cung cấp ĐANG BẬT cho công ty (khả dụng ở server và công ty đã bật ký số); rỗng ⇒ chưa bật ký số. */
  providers: Pick<ESignProviderOut, "key" | "label" | "kind" | "legal">[];
  /** Mặc định hiệu lực của công ty (ô "Theo cài đặt chung"); null ⇒ chưa cấu hình. */
  default_provider: string | null;
  /** Công ty đã bật ký số (false ⇒ panel hiện lý do + cách bật). */
  enabled: boolean;
  /** Group của công ty để chọn người ký (kind = "group"); người cụ thể chọn từ danh sách thành viên chung của shell. */
  groups: { id: string; key: string; name: string }[];
  orders: typeof ESIGN_NODE_ORDERS;
  limits: { signers_max: number; due_days_max: number; remind_hours_max: number };
};

/** `POST /pack/contracts/esign/node-config/check` ⇒ lỗi theo khoá trường (rỗng ⇒ hợp lệ). */
export type ESignNodeCheckOut = { issues: { field: string; code: string }[] };
