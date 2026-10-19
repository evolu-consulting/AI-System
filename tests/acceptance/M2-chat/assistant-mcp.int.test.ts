// M2-chat · N2-FR-03 · tool ĐỌC của trợ lý (`contracts-search/get/cks/ledger`) qua `/mcp` THẬT (hub-api in-process, DB thật,
// RLS FORCE `contracts_rw`): danh tính = user + tenant của job (không tài khoản dịch vụ). Ca: thấy đúng HĐ tenant mình, thăm dò
// id tenant khác ≡ không có, tenant chưa bật gói ⇒ tool không có trong `tools/list` và gọi ⇒ Unknown tool, job không khai
// tool ⇒ không có. Viết trước phần nối `/mcp` của lát (Luật 1b: phần quyền/tenant test trước).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AG, idGen, insertHubConfig } from "../H1/_hub";
import { insertSqlJob, mcp } from "../H2a/_runtime2";
import { arrange, type CtxN1, insContract, startHd1, T } from "../HD1/_support/hd1";

const READ_TOOLS = ["contracts-search", "contracts-get", "contracts-cks", "contracts-ledger"];
const A1 = "e2c00000-0000-4000-8000-000000000a01";
const B1 = "e2c00000-0000-4000-8000-000000000b01";
const ids = idGen(9_820);

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrange(c);
  await insertHubConfig(c.sql);
  await insContract(c.sql, { id: A1, tenant: T.acme, title: "HĐ Bao bì Phương Nam" });
  await insContract(c.sql, { id: B1, tenant: T.beta, title: "HĐ Canary bí mật" });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Who = "tam" | "an" | "zed" | "lan";
async function jobFor(who: Who, tools: string[] = READ_TOOLS): Promise<string> {
  const j = await insertSqlJob(c.sql, ids, {
    who,
    type: "agent.cli",
    agentId: AG.assistant,
    agentKey: "assistant",
    tools,
  });
  return j.token;
}
const listNames = async (token: string): Promise<string[]> =>
  ((await mcp(c.hub, token, "tools/list")).json?.result?.tools ?? []).map(
    (t: { name: string }) => t.name,
  );
async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(c.hub, token, "tools/call", { name, arguments: args });
  const text: string | undefined = r.json?.result?.content?.[0]?.text;
  const isError: boolean | undefined = r.json?.result?.isError;
  // Lỗi tool là câu chữ (plan-errors §4), không phải JSON.
  const data = text && !isError ? JSON.parse(text) : null;
  return { r, error: r.json?.error, isError, data };
}

describe("M2-chat · tool đọc gói contracts qua /mcp — quyền NGƯỜI GỌI [N2-FR-03]", () => {
  it("viewer acme (tam): tools/list có đủ 4 tool đọc; search chỉ thấy HĐ acme", async () => {
    const tok = await jobFor("tam");
    expect((await listNames(tok)).filter((n) => READ_TOOLS.includes(n)).sort()).toEqual(
      [...READ_TOOLS].sort(),
    );
    const s = await callTool(tok, "contracts-search", { limit: 20 });
    expect(s.isError ?? false).toBe(false);
    const titles = s.data.items.map((i: { title: string }) => i.title);
    expect(titles).toContain("HĐ Bao bì Phương Nam");
    expect(JSON.stringify(s.data)).not.toContain("Canary");
  });

  it("thăm dò id HĐ tenant khác (B1 dưới acme) ≡ không có", async () => {
    const tok = await jobFor("tam");
    expect((await callTool(tok, "contracts-get", { contract_id: B1 })).data).toEqual({
      found: false,
    });
    const own = await callTool(tok, "contracts-get", { contract_id: A1 });
    expect(own.data.found).toBe(true);
    expect(own.data.contract.id).toBe(A1);
  });

  it("owner beta (an): chỉ thấy HĐ beta", async () => {
    const tok = await jobFor("an");
    const s = await callTool(tok, "contracts-search", {});
    expect(s.data.items.map((i: { id: string }) => i.id)).toEqual([B1]);
    expect((await callTool(tok, "contracts-get", { contract_id: A1 })).data).toEqual({
      found: false,
    });
  });

  it("tenant chưa bật gói (zed/zeta): không có trong tools/list, gọi ⇒ Unknown tool, 0 dữ liệu", async () => {
    const tok = await jobFor("zed");
    expect((await listNames(tok)).some((n) => READ_TOOLS.includes(n))).toBe(false);
    const s = await callTool(tok, "contracts-search", {});
    expect(s.error?.code).toBe(-32602);
    expect(s.data).toBeNull();
  });

  it("job KHÔNG khai tool gói (payload.mcp.tools) ⇒ không có, dù người gọi có quyền", async () => {
    const tok = await jobFor("lan", ["contracts-get"]);
    const names = await listNames(tok);
    expect(names.filter((n) => READ_TOOLS.includes(n))).toEqual(["contracts-get"]);
    expect((await callTool(tok, "contracts-search", {})).error?.code).toBe(-32602);
  });

  it("tham số sai (id không phải uuid) ⇒ lỗi tool, không lộ chi tiết", async () => {
    const tok = await jobFor("tam");
    const r = await callTool(tok, "contracts-get", { contract_id: "1' or '1'='1" });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.r.json)).not.toContain("Canary");
  });
});
