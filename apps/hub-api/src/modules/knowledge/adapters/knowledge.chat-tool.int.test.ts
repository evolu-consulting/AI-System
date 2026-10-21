// ai-tiers-rag · N4-FR-06 · N2-FR-03 · int: tool `knowledge-search` cho agent chat qua đường `/mcp` thật (`packMcpTools` +
// registry gói + DB thật, role `knowledge_rw` RLS FORCE). Quyền của NGƯỜI GỌI: gói knowledge bật cho tenant ∧ user thuộc Group
// được cấp `knowledge-read`. Đường chính: đoạn trả về kèm `title` (tên tài liệu) để trích nguồn. Chéo tenant: user tenant B
// (đủ quyền) không thấy tài liệu của A; user A không có Group / tenant chưa bật gói ⇒ tool không có trong danh sách.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { packMcpTools } from "../../mcp/pack-tools.provider";
import type { PackAccessView } from "../../packs/kit/adapters/pack-guard.middleware";
import { PackToolRegistry } from "../../packs/kit/adapters/pack-tools.registry";
import { knowledgeService } from "../knowledge.mount";
import { knowledgeTools } from "./knowledge.tools";

const A = tenantId(961);
const B = tenantId(962);
const C = tenantId(963); // chưa bật gói knowledge
const UA = userId(961); // tenant A, Group được cấp knowledge-read
const UA2 = userId(964); // tenant A, KHÔNG thuộc Group được cấp
const UB = userId(962); // tenant B, đủ quyền
const UC = userId(963);
const FEAT = "7e5d0000-0000-4000-8000-0000000000f1";
const TITLE_A = "Quy chế phê duyệt và thanh toán hợp đồng — Công ty A";
const DOC_A = `# ${TITLE_A}\n## Hạn mức phê duyệt\nHợp đồng trên 500 triệu đồng phải có chữ ký Giám đốc. CANARY-A-5521\n## Thanh toán\nThanh toán trong 45 ngày kể từ ngày nhận hoá đơn.`;
const DOC_B = `# Quy chế công ty B\n## Hạn mức phê duyệt\nHợp đồng trên 900 triệu đồng do Hội đồng thành viên duyệt.`;

const view: PackAccessView = {
  catalog: async () => ({
    features: [{ id: FEAT, key: "knowledge-read", status: "on" }],
    entitled: new Set([`${A}:${FEAT}`, `${B}:${FEAT}`]),
    grantGroups: new Map([
      [`${A}:${FEAT}`, ["g-a"]],
      [`${B}:${FEAT}`, ["g-b"]],
    ]),
  }),
  user: async (id) =>
    ({
      [UA]: { tenantId: A, groupIds: new Set(["g-a"]) },
      [UA2]: { tenantId: A, groupIds: new Set(["g-other"]) },
      [UB]: { tenantId: B, groupIds: new Set(["g-b"]) },
      [UC]: { tenantId: C, groupIds: new Set(["g-a"]) },
    })[id],
};

let db: Db;
let mcp: ReturnType<typeof packMcpTools>;
const KEYS = ["knowledge-search", "knowledge-get"];
const ctx = (tenantId: string, userId: string) => ({ tenantId, userId, runId: "r1", tools: KEYS });
type Hits = { hits: { title: string; text: string; document_id: string }[] };
const search = async (tenant: string, user: string, query: string): Promise<Hits | null> => {
  const t = await mcp.accepts(ctx(tenant, user), "knowledge-search");
  if (!t) return null;
  const r = await t.call({ query, k: 5 });
  expect(r.isError).toBe(false);
  return JSON.parse(r.content[0]?.text ?? "{}") as Hits;
};

beforeAll(async () => {
  await cloneDb("full");
  db = createDb(urls().hubApi, { max: 2 });
  const tools = knowledgeTools(
    knowledgeService(db, { env: {}, ai: { embedder: null, reranker: null } }),
  );
  const add = tools.find((t) => t.name === "knowledge-add");
  if (!add) throw new Error("thiếu knowledge-add");
  await add.run({ tenantId: A, userId: UA, runId: null }, { title: TITLE_A, content: DOC_A });
  await add.run({ tenantId: B, userId: UB, runId: null }, { title: "Quy chế B", content: DOC_B });
  const reg = new PackToolRegistry(view);
  for (const t of tools) reg.register(t);
  mcp = packMcpTools(reg);
});
afterAll(async () => {
  await db?.close();
});

describe("ai-tiers-rag · knowledge-search cho agent chat [N4-FR-06]", () => {
  it("đường chính: user có quyền thấy tool, hỏi hạn mức duyệt ⇒ đoạn đúng kèm title tài liệu để trích nguồn", async () => {
    const listed = (await mcp.tools(ctx(A, UA))).map((t) => t.name);
    expect(listed).toEqual(KEYS);
    const r = await search(A, UA, "hạn mức phê duyệt hợp đồng trên 500 triệu");
    expect(r?.hits[0]?.title).toBe(TITLE_A);
    expect(r?.hits[0]?.text).toContain("Giám đốc");
  });

  it("chặn chéo tenant: user B không thấy tài liệu A; thiếu Group / tenant chưa bật gói ⇒ không có tool", async () => {
    const b = await search(B, UB, "hạn mức phê duyệt CANARY-A-5521 Giám đốc 500 triệu");
    expect(b?.hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).not.toContain("CANARY-A-5521");
    expect(b?.hits.some((h) => h.title === TITLE_A)).toBe(false);
    expect(await mcp.tools(ctx(A, UA2))).toEqual([]);
    expect(await mcp.accepts(ctx(A, UA2), "knowledge-search")).toBeNull();
    expect(await mcp.accepts(ctx(C, UC), "knowledge-search")).toBeNull();
    // user khai tenant khác tenant thật của mình ⇒ không có Group ⇒ bị chặn
    expect(await mcp.accepts(ctx(B, UA), "knowledge-search")).toBeNull();
  });
});
