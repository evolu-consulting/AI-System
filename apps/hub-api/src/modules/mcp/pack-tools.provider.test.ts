// N2-FR-03 · N2-AC09 · `/mcp` liệt kê/gọi tool gói chỉ khi khoá ∈ payload.mcp.tools ∧ gói bật ∧ user có quyền read ∧ không
// side_effect (N2-D03); lời gọi chạy bằng tenant/user của job, tham số qua `validateToolArgs`.
import { describe, expect, test } from "bun:test";
import type { PackToolCatalog, PackToolInfo } from "../packs/kit/application/pack-tools.ports";
import { packMcpTools } from "./pack-tools.provider";

const P = [{ name: "title", type: "text", required: true }];
const INFO: Record<string, PackToolInfo> = {
  "pk-a": { key: "pk-a", name: "pk-a", description: "A", sideEffect: false, params: P },
  "pk-s": { key: "pk-s", name: "pk-s", description: "S", sideEffect: true, params: P },
};
function fake(o: { enabled?: boolean; read?: boolean } = {}) {
  const calls: { key: string; ctx: unknown; args: unknown }[] = [];
  const cat: PackToolCatalog = {
    has: (k) => k in INFO,
    info: (k) => INFO[k],
    enabled: async () => o.enabled ?? true,
    available: async () => Object.values(INFO),
    canUse: async () => o.read ?? true,
    call: async (key, ctx, args) => {
      calls.push({ key, ctx, args });
      return { kind: "ok", text: '{"ok":1}' };
    },
  };
  return { cat, calls };
}
const ctx = (tools: string[]) => ({ tenantId: "t1", userId: "u1", runId: "r1", tools });

describe("N2-AC09 · tool gói trong /mcp", () => {
  test("liệt kê: ∈ payload ∧ bật ∧ read ∧ ¬side_effect", async () => {
    const { cat } = fake();
    const p = packMcpTools(cat);
    expect((await p.tools(ctx(["pk-a", "pk-s", "khac"]))).map((t) => t.name)).toEqual(["pk-a"]);
    expect(await p.tools(ctx([]))).toEqual([]);
    expect(await packMcpTools(fake({ enabled: false }).cat).tools(ctx(["pk-a"]))).toEqual([]);
    expect(await packMcpTools(fake({ read: false }).cat).tools(ctx(["pk-a"]))).toEqual([]);
  });

  test("gọi: không đủ điều kiện ⇒ null (lỗi tool lạ ở service); đủ ⇒ chạy bằng tenant/user của job", async () => {
    const { cat, calls } = fake();
    const p = packMcpTools(cat);
    expect(await p.accepts(ctx(["pk-s"]), "pk-s")).toBeNull();
    expect(await p.accepts(ctx([]), "pk-a")).toBeNull();
    const h = await p.accepts(ctx(["pk-a"]), "pk-a");
    expect((await h?.call({}))?.isError).toBe(true); // thiếu tham số bắt buộc
    const ok = await h?.call({ title: "x" });
    expect(ok?.isError).toBe(false);
    expect(calls[0]).toMatchObject({ key: "pk-a", ctx: { tenantId: "t1", userId: "u1" } });
  });
});
