// CR-122 · E5b · FLOW2-FR-25 · validator cấu hình THEO NODE app: gói đăng ký lúc mount, luồng lưu def (`processes/defs`) gọi cho mọi stage mang
// `node` — sai ⇒ 422 `FLOW_NODE_CONFIG_INVALID`. Nằm ở kit vì gói cấm import `processes` (cùng khuôn `flowPortRegistry`/`slotRegistry`).
// Validator là hàm ASYNC theo tenant (đọc nhà cung cấp đang bật, thành viên công ty…); lỗi theo `path` kiểu `stages.<i>.executor.args.<khoá>`.
export type NodeConfigIssue = { path: string; code: string };
/** Stage trong def đang lưu (hình tối thiểu): `executor.args` = `{ khoá: { from: "const", value } | nguồn khác }`. */
export type NodeConfigStage = { index: number; node: string; executor: unknown };
export type NodeConfigValidator = (
  tenantId: string,
  stage: NodeConfigStage,
) => Promise<readonly NodeConfigIssue[]>;

const validators = new Map<string, NodeConfigValidator>();

export const nodeConfigRegistry = {
  /** Đăng ký lại cùng khoá node ⇒ thay (mount chạy lại vô hại). */
  register(nodeKey: string, v: NodeConfigValidator): void {
    validators.set(nodeKey, v);
  },
  /** Mọi stage có `node` đã đăng ký validator ⇒ gộp lỗi (≤ 20). Không validator / không `node` ⇒ bỏ qua. */
  async check(
    tenantId: string,
    stages: readonly { node?: string | undefined; executor: unknown }[],
  ): Promise<NodeConfigIssue[]> {
    const out: NodeConfigIssue[] = [];
    for (const [index, s] of stages.entries()) {
      const v = s.node ? validators.get(s.node) : undefined;
      if (v && s.node)
        out.push(...(await v(tenantId, { index, node: s.node, executor: s.executor })));
    }
    return out.slice(0, 20);
  },
  /** Chỉ cho test. */
  clear(nodeKey: string): void {
    validators.delete(nodeKey);
  },
};

type Const = { from: "const"; value: unknown };
/** Giá trị HẰNG của các tham số tool trong `executor.args` (nguồn input/field không kiểm tĩnh được ⇒ bỏ). Không phải stage tool ⇒ null. */
export function constToolArgs(
  executor: unknown,
  toolKey: string,
): Record<string, string | number | boolean> | null {
  const e = executor as { kind?: string; tool_key?: string; args?: Record<string, unknown> } | null;
  if (!e || e.kind !== "tool" || e.tool_key !== toolKey) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, src] of Object.entries(e.args ?? {})) {
    const c = src as Partial<Const>;
    if (c?.from === "const" && ["string", "number", "boolean"].includes(typeof c.value))
      out[k] = c.value as string | number | boolean;
  }
  return out;
}
