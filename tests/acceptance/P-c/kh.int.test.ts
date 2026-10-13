// HUB-FR-119 · HUB-FR-132 · P-c1 · spec §9 B9 · test-plan §3 K01–K02: KnowledgeHub (K1) giữ nguyên ở stage tự-sửa — agent đã tick
// KH ⇒ job tự-sửa có `kh-query` trong `mcp.tools` CẠNH `payload.autofix` (Runtime thêm 4 `ws_*`; KH gọi qua Hub `/mcp` ngoài
// container) và `kh-query` gọi được bằng token job; KH không vào workspace (không thành nguồn/allowlist). Dựng trên fixture K1
// (2 KH giả, `seed: full` — `hd-read` tick `kh-main`) + nguồn P-b + resolver P-b. Đỏ trước code: `needPc` (0031 vắng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxK1, jobToken, startK1 } from "../K1/_k1";
import { KH_TOOL, khQuery, mcpTools, stageJob, startRun } from "../K1/_run";
import { gitBody } from "../P-b/pfs1/_local";
import { resolver, stopAllResolvers } from "../P-b/pfs3/_local";
import { afDefBody, afOf, afStage, hasPcSchema, P1 } from "./_support/pc";

let c: CtxK1;
let pc = false;
beforeAll(async () => {
  c = await startK1({ seed: "full" });
  pc = c.ready && c.k1 && (await hasPcSchema(c.sql));
  if (!pc) return;
  const s = await c.call("Adm", "POST", "/admin/sources", gitBody("app-repo"));
  expect(s.status).toBe(201);
  const d = await c.call(
    "Adm",
    "POST",
    "/process-defs",
    afDefBody("pc-kh", [afStage({ agent: P1.agRead })]),
  );
  expect(d.status).toBe(201);
}, 60_000);
afterAll(async () => {
  await stopAllResolvers();
  await c?.stop();
});

describe("K01–K02 · KH cạnh ws_* [B9]", () => {
  it("HUB-FR-132 · B9 · K01 · job tự-sửa của agent đã tick KH: mcp.tools có kh-query VÀ payload.autofix có; KH không thành nguồn job", async () => {
    expect({ migration0031: pc }).toEqual({ migration0031: true });
    resolver({ sql: c.sql, base: c.hub.base } as never);
    const runId = await startRun(c, "pc-kh");
    const job = await stageJob(c, runId, 0);
    expect(mcpTools(job)).toContain(KH_TOOL);
    expect(afOf(job)?.branch).toBe(`ai/${runId}/fix`);
    expect(
      ((job.payload as { sources?: { key: string }[] }).sources ?? []).map((s) => s.key),
    ).not.toContain("kh-main");
  }, 45_000);
  it("HUB-FR-132 · B9 · K02 · kh-query gọi được bằng token job tự-sửa (qua Hub /mcp, không lỗi công cụ)", async () => {
    expect({ migration0031: pc }).toEqual({ migration0031: true });
    resolver({ sql: c.sql, base: c.hub.base } as never);
    const runId = await startRun(c, "pc-kh");
    const job = await stageJob(c, runId, 0);
    const token = await jobToken(c.sql, job);
    const r = await khQuery(c, token, { query: "hoá đơn HD-12" });
    expect(r.res.status).toBe(200);
    expect({
      isError: r.result?.isError ?? false,
      project: r.result?.structuredContent?.project,
    }).toEqual({
      isError: false,
      project: "kh-main/proj-a",
    });
  }, 45_000);
});
