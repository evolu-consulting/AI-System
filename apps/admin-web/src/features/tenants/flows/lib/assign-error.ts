// CR-121 f6 · lỗi gán/đổi quy trình cho công ty ⇒ câu nghiệp vụ + hành động khắc phục (Luật GỐC 3), thay "Không thực hiện được. Thử lại sau.".
// Mã lỗi thật của hub (library/routing): SLOT_GROUPS_MISSING · PROCESS_NOT_PUBLISHED · PROCESS_PUBLISH_INVALID · PROCESS_REF_INVALID · mọi 422 khác.
// Mã `ROUTING_*` / VERSION_CONFLICT đã có câu riêng ở bộ sửa luật (web-kit `routingErrorOf`) nên trả null ở đây.
type ErrLike = { status?: number; code?: string; details?: unknown };

/** Nơi người dùng sửa: tab Ứng dụng · Thư viện quy trình · Thành viên › Nhóm. */
export type AssignAction = "apps" | "library" | "groups";
export type AssignErrorSpec = {
  key: string;
  params: Record<string, string>;
  action: AssignAction;
};

const keysOf = (details: unknown): string => {
  const k = (details as { keys?: unknown } | null | undefined)?.keys;
  return Array.isArray(k) ? k.filter((x): x is string => typeof x === "string").join(", ") : "";
};

export function assignErrorOf(err: unknown, ctx: { app: string }): AssignErrorSpec | null {
  const e: ErrLike = typeof err === "object" && err !== null ? (err as ErrLike) : {};
  const app = { app: ctx.app };
  switch (e.code) {
    case "SLOT_GROUPS_MISSING":
      return {
        key: "tenants.flows.err.groupsMissing",
        params: { keys: keysOf(e.details) },
        action: "groups",
      };
    case "PROCESS_NOT_PUBLISHED":
      return { key: "tenants.flows.err.notPublished", params: {}, action: "library" };
    case "PROCESS_PUBLISH_INVALID":
      return { key: "tenants.flows.err.publishInvalid", params: {}, action: "library" };
    case "PROCESS_REF_INVALID":
      return { key: "tenants.flows.err.refInvalid", params: {}, action: "groups" };
    default:
      if (e.code?.startsWith("ROUTING_") || e.code === "VERSION_CONFLICT") return null;
      return e.status === 422
        ? { key: "tenants.flows.err.unprocessable", params: app, action: "apps" }
        : null;
  }
}
