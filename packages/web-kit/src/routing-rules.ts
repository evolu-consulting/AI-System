// CR-118 §11.2 · luật chọn quy trình theo phòng ban: logic THUẦN sửa danh sách luật + ánh xạ lỗi API (dùng chung sohoptac-web và
// admin-web; mỗi app tự lo chữ). Hợp đồng: `@ai/contracts/hub-admin` (process-routing). Thứ tự mảng = ưu tiên (đầu = xét trước).
import type { ProcessRoutingRule, PutProcessRoutingRequest } from "@ai/contracts/hub-admin";

/** = `ROUTING_RULES_MAX` của hợp đồng (giữ số ở đây để không kéo zod schema vào chunk web). */
export const RULES_MAX = 50;

export type RuleDraft = {
  /** Khoá React ổn định (id luật từ server hoặc khoá tạm `n<k>`). */
  key: string;
  departmentIds: string[];
  defId: string;
  isDefault: boolean;
  /** cr118-routing-deleted · từ server: quy trình của luật bị xoá / chưa xuất bản ⇒ không lưu được cho tới khi sửa hoặc xoá luật. */
  unavailable?: "deleted" | "unpublished";
};

let seq = 0;
export const newRuleKey = (): string => `n${++seq}`;

type ServerRule = Pick<
  ProcessRoutingRule,
  "id" | "priority" | "condition" | "def_id" | "is_default" | "unavailable"
>;

/** Phản hồi GET ⇒ bản nháp (theo `priority` tăng dần). */
export function fromServer(rules: readonly ServerRule[]): RuleDraft[] {
  return [...rules]
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({
      key: r.id,
      departmentIds: [...(r.condition.departmentIds ?? [])],
      defId: r.def_id,
      isDefault: r.is_default,
      ...(r.unavailable ? { unavailable: r.unavailable } : {}),
    }));
}

/** Thân PUT: luật thường theo thứ tự đang có, luật mặc định (không điều kiện) xếp cuối. */
export function toPutBody(version: number, drafts: readonly RuleDraft[]): PutProcessRoutingRequest {
  const ordered = [...drafts.filter((d) => !d.isDefault), ...drafts.filter((d) => d.isDefault)];
  return {
    version,
    rules: ordered.map((d) => ({
      condition: d.isDefault ? {} : { departmentIds: [...d.departmentIds] },
      def_id: d.defId,
      is_default: d.isDefault,
    })),
  };
}

export const canAddRule = (list: readonly RuleDraft[]): boolean => list.length < RULES_MAX;

/** Thêm một luật thường ở cuối (chưa chọn phòng ban); quá trần ⇒ không đổi. */
export function addRule(list: readonly RuleDraft[], defId: string, key: string): RuleDraft[] {
  if (!canAddRule(list)) return [...list];
  return [...list, { key, departmentIds: [], defId, isDefault: false }];
}

export const removeRule = (list: readonly RuleDraft[], key: string): RuleDraft[] =>
  list.filter((r) => r.key !== key);

/** Đổi thứ tự một vị trí (`-1` lên, `+1` xuống); ra ngoài biên ⇒ không đổi. */
export function moveRule(list: readonly RuleDraft[], key: string, delta: -1 | 1): RuleDraft[] {
  const i = list.findIndex((r) => r.key === key);
  const j = i + delta;
  const out = [...list];
  const a = out[i];
  const b = out[j];
  if (i < 0 || !a || !b) return out;
  out[i] = b;
  out[j] = a;
  return out;
}

export const patchRule = (
  list: readonly RuleDraft[],
  key: string,
  patch: Partial<Pick<RuleDraft, "departmentIds" | "defId">>,
): RuleDraft[] =>
  list.map((r) => {
    if (r.key !== key) return r;
    // Đổi sang quy trình khác ⇒ cờ "không chạy được" của quy trình cũ hết hiệu lực (server tính lại khi lưu).
    const { unavailable: _gone, ...rest } = r;
    return patch.defId !== undefined && patch.defId !== r.defId
      ? { ...rest, ...patch }
      : { ...r, ...patch };
  });

/** Chọn/bỏ "mặc định": chỉ MỘT luật mặc định; luật mặc định không có phòng ban. */
export function setDefault(list: readonly RuleDraft[], key: string, on: boolean): RuleDraft[] {
  return list.map((r) => {
    if (r.key === key)
      return on ? { ...r, isDefault: true, departmentIds: [] } : { ...r, isDefault: false };
    return on ? { ...r, isDefault: false } : r;
  });
}

/** Bật/tắt một phòng ban trong luật (không trùng, giữ thứ tự chọn). */
export function toggleDepartment(
  list: readonly RuleDraft[],
  key: string,
  deptId: string,
): RuleDraft[] {
  return list.map((r) => {
    if (r.key !== key || r.isDefault) return r;
    const has = r.departmentIds.includes(deptId);
    return {
      ...r,
      departmentIds: has
        ? r.departmentIds.filter((d) => d !== deptId)
        : [...r.departmentIds, deptId],
    };
  });
}

export const sameRules = (a: readonly RuleDraft[], b: readonly RuleDraft[]): boolean =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i];
    return (
      !!o &&
      r.defId === o.defId &&
      r.isDefault === o.isDefault &&
      r.departmentIds.length === o.departmentIds.length &&
      r.departmentIds.every((d, k) => d === o.departmentIds[k])
    );
  });

export type RuleIssueCode = "noDepartment" | "notAssigned" | "deptGone" | "unavailable";
export type RuleIssue = { key: string; code: RuleIssueCode };

/** Kiểm trước khi lưu (server vẫn là nguồn thật): luật thường cần ≥ 1 phòng ban; quy trình/phòng ban phải còn hợp lệ. */
export function ruleIssues(
  list: readonly RuleDraft[],
  assigned: ReadonlySet<string>,
  departments: ReadonlySet<string>,
): RuleIssue[] {
  const out: RuleIssue[] = [];
  for (const r of list) {
    if (r.unavailable) out.push({ key: r.key, code: "unavailable" });
    else if (!assigned.has(r.defId)) out.push({ key: r.key, code: "notAssigned" });
    if (r.isDefault) continue;
    if (r.departmentIds.length === 0) out.push({ key: r.key, code: "noDepartment" });
    else if (r.departmentIds.some((d) => !departments.has(d)))
      out.push({ key: r.key, code: "deptGone" });
  }
  return out;
}

export type RoutingErrorKind =
  | "conflict"
  | "notAssigned"
  | "unavailable"
  | "deptInvalid"
  | "rulesInvalid"
  | "inUse"
  | "forbidden"
  | "other";
export type RoutingErrorSpec = {
  kind: RoutingErrorKind;
  /** `inUse`: số thứ tự luật bị ảnh hưởng (1 = ưu tiên cao nhất), tăng dần. */
  rules: number[];
};

type ErrLike = { status?: number; code?: string; details?: unknown };

/** Lỗi `ApiError` (cấu trúc) của GET/PUT/DELETE process-routing ⇒ loại lỗi để app chọn chữ. */
export function routingErrorOf(err: unknown): RoutingErrorSpec {
  const e: ErrLike = typeof err === "object" && err !== null ? (err as ErrLike) : {};
  const rules = e.code === "ROUTING_PROCESS_IN_USE" ? affectedRules(e.details) : [];
  switch (e.code) {
    case "VERSION_CONFLICT":
      return { kind: "conflict", rules };
    case "ROUTING_PROCESS_NOT_ASSIGNED":
      return { kind: "notAssigned", rules };
    case "ROUTING_PROCESS_UNAVAILABLE":
      return { kind: "unavailable", rules };
    case "ROUTING_DEPARTMENT_INVALID":
      return { kind: "deptInvalid", rules };
    case "ROUTING_RULES_INVALID":
      return { kind: "rulesInvalid", rules };
    case "ROUTING_PROCESS_IN_USE":
      return { kind: "inUse", rules };
    case "PROCESS_IN_USE":
      return { kind: "inUse", rules: affectedRules(e.details) };
    default:
      return { kind: e.status === 403 ? "forbidden" : "other", rules };
  }
}

/** `details.rules = [{id, priority}]` ⇒ số thứ tự hiển thị (priority + 1), sắp tăng, bỏ phần tử sai hình. */
export function affectedRules(details: unknown): number[] {
  const list = (details as { rules?: unknown } | null | undefined)?.rules;
  if (!Array.isArray(list)) return [];
  const nums = list
    .map((r) => (r as { priority?: unknown } | null)?.priority)
    .filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 0)
    .map((p) => p + 1);
  return [...new Set(nums)].sort((a, b) => a - b);
}
