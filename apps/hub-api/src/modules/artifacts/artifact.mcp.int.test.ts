// CR-114 · hub-agent-handoff · viết TRƯỚC code: MCP `artifact.get` / `artifact.search` trên DB thật (`hub_api`, RLS).
// Ngữ cảnh = `McpContext` mà `McpService.authenticate` dựng từ token job (tenant/user của job) ⇒ job tenant A không đọc
// được artifact tenant B (kể cả đoán đúng khoá đủ 64 ký tự hay tiền tố 8 ký tự).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import {
  ARTIFACT_GET,
  ARTIFACT_SEARCH,
  ARTIFACT_TOOL_KEYS,
  ArtifactMcpTools,
} from "./artifact.mcp";
import { ArtifactStore } from "./artifact.service";

const T = { a: tenantId(1143), b: tenantId(1144) };
const U = { a: userId(1143), b: userId(1144) };
const ctx = (k: "a" | "b") => ({ tenantId: T[k], userId: U[k], tools: [...ARTIFACT_TOOL_KEYS] });
const BODY_B = `Báo cáo tenant B: doanh thu quý 3 là 42 tỷ.\n${"chi tiết ".repeat(400)}`;

let db: Db;
let o: Sql;
let store: ArtifactStore;
let mcp: ArtifactMcpTools;

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(1);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 't1143', 'T1143'), (${T.b}, 't1144', 'T1144')
    on conflict do nothing`;
  db = createDb(urls().hubApi, { max: 2 });
  store = new ArtifactStore({ db });
  mcp = new ArtifactMcpTools(store);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-114 · MCP artifact.get / artifact.search", () => {
  it("ghi trùng nội dung dedup một hàng", async () => {
    const r1 = await store.put(ctx("b"), BODY_B, { summary: "Doanh thu Q3 của B" });
    const r2 = await store.put(ctx("b"), BODY_B, { summary: "khác" });
    expect(r1.key).toBe(r2.key);
    expect(r1.short).toMatch(/^art:[0-9a-f]{8}$/);
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.artifacts
      where tenant_id = ${T.b} and key = ${r1.key}`;
    expect(n?.n).toBe(1);
  });

  it("hai run cùng nội dung đều đọc được, run thứ ba không link thì không", async () => {
    const [r1, r2, r3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const body = `Biên bản dùng chung: phí 5%.\n${"x ".repeat(400)}`;
    const ref = await store.put(ctx("a"), body, { runId: r1 });
    expect((await store.put(ctx("a"), body, { runId: r2 })).key).toBe(ref.key);
    const read = (runId: string) => store.get({ ...ctx("a"), runId }, ref.short);
    expect((await read(r1))?.text).toContain("phí 5%");
    expect((await read(r2))?.text).toContain("phí 5%");
    expect(await read(r3)).toBeNull();
    const [row] = await o<{ run_id: string; links: number }[]>`select a.run_id::text as run_id,
      (select count(*)::int from hub.artifact_runs l where l.tenant_id = a.tenant_id and l.key = a.key) as links
      from hub.artifacts a where a.tenant_id = ${T.a} and a.key = ${ref.key}`;
    expect(row).toEqual({ run_id: r1, links: 2 });
  });

  it("job tenant A không đọc được artifact tenant B", async () => {
    const ref = await store.put(ctx("b"), BODY_B, { summary: "Doanh thu Q3 của B" });
    const call = (k: "a" | "b", name: string, args: unknown) => {
      const h = mcp.accepts(ctx(k), name);
      if (!h) throw new Error(`tool ${name} không nhận`);
      return h.call(args);
    };
    const own = await call("b", ARTIFACT_GET, { key: ref.short, range: { start: 0, len: 44 } });
    expect(own.isError).toBe(false);
    expect(text(own)).toContain("42 tỷ");
    for (const key of [ref.short, ref.key]) {
      const cross = await call("a", ARTIFACT_GET, { key });
      expect(cross.isError).toBe(true);
      expect(text(cross)).not.toContain("42 tỷ");
    }
    const search = await call("a", ARTIFACT_SEARCH, { query: "doanh thu" });
    expect(text(search)).not.toContain(ref.short);
    const ownSearch = await call("b", ARTIFACT_SEARCH, { query: "doanh thu" });
    expect(text(ownSearch)).toContain(ref.short);
    // Token chat chỉ đọc (Dify) không có tool artifact.
    expect(mcp.tools({ ...ctx("a"), readOnly: true })).toEqual([]);
    expect(mcp.tools(ctx("a")).map((t) => t.name)).toEqual([ARTIFACT_GET, ARTIFACT_SEARCH]);
  });
});
