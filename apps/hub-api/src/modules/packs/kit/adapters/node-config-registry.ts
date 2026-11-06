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
const toolValidators = new Map<string, NodeConfigValidator>();

export const nodeConfigRegistry = {
  /** Đăng ký lại cùng khoá node ⇒ thay (mount chạy lại vô hại). */
  register(nodeKey: string, v: NodeConfigValidator): void {
    validators.set(nodeKey, v);
  },
  /** E5d · validator theo KHOÁ TOOL: chạy cho mọi stage gọi tool đó, kể cả def gọi thẳng tool không mang `node` (không lách được kiểm lúc lưu). */
  registerTool(toolKey: string, v: NodeConfigValidator): void {
    toolValidators.set(toolKey, v);
  },
  /** Stage có validator theo `node` hoặc theo khoá tool ⇒ gộp lỗi (≤ 20; cùng một hàm không chạy hai lần). Không có ⇒ bỏ qua. */
  async check(
    tenantId: string,
    stages: readonly { node?: string | undefined; executor: unknown }[],
  ): Promise<NodeConfigIssue[]> {
    const out: NodeConfigIssue[] = [];
    for (const [index, s] of stages.entries()) {
      const tool = (s.executor as { kind?: string; tool_key?: string } | null)?.tool_key;
      const vs = new Set([
        ...(s.node && validators.has(s.node) ? [validators.get(s.node)] : []),
        ...(tool && toolValidators.has(tool) ? [toolValidators.get(tool)] : []),
      ]);
      for (const v of vs)
        out.push(
          ...((await v?.(tenantId, { index, node: s.node ?? "", executor: s.executor })) ?? []),
        );
    }
    return out.slice(0, 20);
  },
  /** Chỉ cho test. */
  clear(key: string): void {
    validators.delete(key);
    toolValidators.delete(key);
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
