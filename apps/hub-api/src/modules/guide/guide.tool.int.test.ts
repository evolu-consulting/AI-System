// app-guide · int: tool `app-guide` qua đường `/mcp` thật (`packMcpTools` + registry gói + DB thật cho vai trò admin).
// Đường chính: thành viên thường hỏi "tạo hợp đồng" ⇒ có tool, nhận đúng mục Sổ Hợp Tác. Chặn: thành viên thường KHÔNG thấy mục Quản trị
// (tìm lẫn lấy theo id); admin thấy; tenant chưa bật gói hợp đồng ⇒ không có mục Sổ Hợp Tác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, tenants, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { packMcpTools } from "../mcp/pack-tools.provider";
import type { PackAccessView } from "../packs/kit/adapters/pack-guard.middleware";
import { PackToolRegistry } from "../packs/kit/adapters/pack-tools.registry";
import { guideDeps } from "./guide.mount";
import { guideTools } from "./guide.tools";

const A = tenantId(971); // đã bật gói contracts, group g-a được cấp read
const B = tenantId(972); // chưa bật gói contracts
const MEMBER_A = userId(971);
const ADMIN_A = userId(972);
const MEMBER_B = userId(973);
const FEAT = "7e5d0000-0000-4000-8000-0000000000f9";
const KEYS = ["app-guide"];

const view: PackAccessView = {
  catalog: async () => ({
    features: [{ id: FEAT, key: "contracts-read", status: "on" }],
    entitled: new Set([`${A}:${FEAT}`]),
    grantGroups: new Map([[`${A}:${FEAT}`, ["g-a"]]]),
  }),
  user: async (id) =>
    ({
      [MEMBER_A]: { tenantId: A, groupIds: new Set(["g-a"]) },
      [ADMIN_A]: { tenantId: A, groupIds: new Set(["g-a"]) },
      [MEMBER_B]: { tenantId: B, groupIds: new Set(["g-a"]) },
    })[id],
};

let db: Db;
let owner: Sql;
let mcp: ReturnType<typeof packMcpTools>;
const ctx = (tenant: string, user: string) => ({
  tenantId: tenant,
  userId: user,
  runId: "r1",
  tools: KEYS,
});
type Out = { found: boolean; sections?: { id: string; title: string; text: string }[] };
const call = async (
  tenant: string,
  user: string,
  args: Record<string, unknown>,
): Promise<Out | null> => {
  const t = await mcp.accepts(ctx(tenant, user), "app-guide");
  if (!t) return null;
  const r = await t.call(args);
  expect(r.isError).toBe(false);
  return JSON.parse(r.content[0]?.text ?? "{}") as Out;
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  await tenants(owner, 2, 971);
  await users(owner, A, 1, { from: 971 }); // member
  await users(owner, A, 1, { from: 972, role: "tenant_admin" });
  await users(owner, B, 1, { from: 973 });
  db = createDb(urls().hubApi, { max: 2 });
  const reg = new PackToolRegistry(view);
  for (const t of guideTools(guideDeps(db, view))) reg.register(t);
  mcp = packMcpTools(reg);
});
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("app-guide · tool cho agent chat", () => {
  it("đường chính: thành viên có tool (không cần entitlement gói app), hỏi tạo hợp đồng ⇒ mục Upload hợp đồng", async () => {
    expect((await mcp.tools(ctx(A, MEMBER_A))).map((t) => t.name)).toEqual(KEYS);
    const r = await call(A, MEMBER_A, { query: "Làm sao để tạo hợp đồng mới và để AI đọc file?" });
    expect(r?.found).toBe(true);
    expect(r?.sections?.[0]?.text).toContain("Upload hợp đồng");
  });

  it("thành viên thường không thấy mục Quản trị (tìm + lấy theo id); admin thấy", async () => {
    const q = "tạo người dùng mới users mật khẩu tạm";
    const m = await call(A, MEMBER_A, { query: q });
    expect(JSON.stringify(m)).not.toContain("Tạo user");
    const a = await call(A, ADMIN_A, { query: q });
    const sec = a?.sections?.find((s) => s.text.includes("Tạo user"));
    expect(sec).toBeDefined();
    expect((await call(A, MEMBER_A, { id: sec?.id ?? "" }))?.found).toBe(false);
    expect((await call(A, ADMIN_A, { id: sec?.id ?? "" }))?.found).toBe(true);
  });

  it("tenant chưa bật gói hợp đồng ⇒ không có mục Sổ Hợp Tác (vẫn có hướng dẫn AI System)", async () => {
    const r = await call(B, MEMBER_B, { query: "tạo hợp đồng mới upload hợp đồng" });
    expect(JSON.stringify(r)).not.toContain("Upload hợp đồng");
    const chat = await call(B, MEMBER_B, { query: "đính kèm tệp khi hỏi AI" });
    expect(chat?.sections?.[0]?.id.startsWith("ai-system/")).toBe(true);
  });
});
