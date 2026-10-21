// my-activity-rag · int (làn rủi ro cao: cách ly tenant + riêng tư) — `my-activity` / `my-chat-history` qua đường `/mcp` thật
// (`packMcpTools` + registry gói + DB thật: `withHubScope(user)` RLS hội thoại, `PackUow` contracts RLS + luật thấy M1 org).
// Tenant A (chế độ org): ua1 (chủ HĐ 2023/12-MP) · ua3 quản lý ua1 (thấy HĐ ua1) · ua2 ngang hàng (không thấy) · ua4 không
// có quyền gói. Tenant B: ub1 có HĐ CÙNG SỐ 2023/12-MP. Mọi dữ liệu "của người khác" mang CANARY-* — không được lọt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import {
  contracts,
  enablePack,
  managers,
  members,
  tenants,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { packMcpTools } from "../../../apps/hub-api/src/modules/mcp/pack-tools.provider";
import { myHistoryDeps } from "../../../apps/hub-api/src/modules/my-history/my-history.mount";
import { myHistoryTools } from "../../../apps/hub-api/src/modules/my-history/my-history.tools";
import { contractsActivitySource } from "../../../apps/hub-api/src/modules/packs/contracts/activity.mount";
import type { PackAccessView } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-guard.middleware";
import { PackToolRegistry } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-tools.registry";

const FEAT = "7e5d0000-0000-4000-8000-0000000001a1";
const KEYS = ["my-activity", "my-chat-history"];
const NUM = "2023/12-MP";

let owner: Sql;
let db: Db;
let mcp: ReturnType<typeof packMcpTools>;
let A = "";
let B = "";
let ua1 = "";
let ua2 = "";
let ua3 = "";
let ua4 = "";
let ub1 = "";
let hA = "";

const ctx = (tenantId: string, userId: string, runId = "r1") => ({
  tenantId,
  userId,
  runId,
  tools: KEYS,
});
type Json = Record<string, unknown>;
async function call(
  tenant: string,
  user: string,
  tool: string,
  args: Json,
  runId?: string,
): Promise<Json> {
  const t = await mcp.accepts(ctx(tenant, user, runId), tool);
  if (!t) throw new Error(`tool ${tool} không có cho ${user}`);
  const r = await t.call(args);
  expect(r.isError).toBe(false);
  return JSON.parse(r.content[0]?.text ?? "{}") as Json;
}
const chat = (t: string, u: string, args: Json) => call(t, u, "my-chat-history", args);
const act = (t: string, u: string, args: Json) => call(t, u, "my-activity", args);

/** Một hội thoại + flow + tin của `user` (owner, bỏ RLS). `ago` = khoảng trước now (interval SQL). */
async function talk(
  tenant: string,
  user: string,
  texts: [string, string, string][],
  deleted = false,
) {
  const [c] = await owner<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm, deleted_at)
    values (${tenant}, ${user}, 'Hỏi đáp', 'hoi dap', ${deleted ? owner`now()` : null}) returning id`;
  const [f] = await owner<
    { id: string }[]
  >`insert into hub.flows (tenant_id, user_id, conversation_id, title)
    values (${tenant}, ${user}, ${c?.id as string}, 'Luồng hỏi') returning id`;
  await owner`insert into hub.messages (tenant_id, user_id, conversation_id, flow_id, role, content, created_at)
    select ${tenant}::uuid, ${user}::uuid, ${c?.id as string}::uuid, ${f?.id as string}::uuid, x.role, x.content,
      now() - x.ago::interval
    from jsonb_to_recordset(${owner.json(texts.map(([role, content, ago]) => ({ role, content, ago })))})
      as x(role text, content text, ago text)`;
}

async function seedContracts() {
  const roles = await enablePack(owner, [A, B], "contracts");
  await members(owner, A, roles.get(A)?.editor as string, [ua1, ua2, ua3]);
  await members(owner, B, roles.get(B)?.editor as string, [ub1]);
  await managers(owner, A, [[ua1, ua3]]);
  await visibility(owner, [A], "org");
  [hA] = (await contracts(owner, A, 1, { from: 1501, createdBy: ua1, owner: ua1 })) as [string];
  const [hA2] = (await contracts(owner, A, 1, { from: 1502, createdBy: ua2, owner: ua2 })) as [
    string,
  ];
  const [hB] = (await contracts(owner, B, 1, { from: 1503, createdBy: ub1, owner: ub1 })) as [
    string,
  ];
  // `number` là cột sinh từ `fields.number.value`.
  const num = (n: string) =>
    owner`jsonb_build_object('number', jsonb_build_object('value', ${n}::text))`;
  await owner`update contracts.contracts set fields = fields || ${num(NUM)}, title = 'HĐ mua phôi thép'
    where id = ${hA}`;
  await owner`update contracts.contracts set fields = fields || ${num("PEER-1")}, title = 'CANARY-PEER-HD'
    where id = ${hA2 as string}`;
  await owner`update contracts.contracts set fields = fields || ${num(NUM)}, title = 'CANARY-B-HD'
    where id = ${hB as string}`;
  await owner`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data) values
    (${A}, ${hA}, 'field_changed', ${ua1}, '{"field":"value","to":1000}'),
    (${A}, ${hA}, 'approved', ${ua3}, '{}'),
    (${A}, ${hA2 as string}, 'field_changed', ${ua2}, '{"note":"CANARY-PEER-EVT"}'),
    (${B}, ${hB as string}, 'field_changed', ${ub1}, '{"note":"CANARY-B-EVT"}')`;
  await owner`insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, contract_id, amount)
    values (${A}, 'tax:0101', 'customer', 'paid', current_date, ${ua1}, ${hA}, 1000)`;
  await owner`insert into contracts.contract_delete_log (tenant_id, contract_id, number, title, deleted_by) values
    (${A}, gen_random_uuid(), '2020/01-DEL', 'HĐ cũ đã xoá', ${ua1}),
    (${A}, gen_random_uuid(), 'X', 'CANARY-DEL-PEER', ${ua2})`;
}

async function seedAudit() {
  await owner`insert into hub.audit_log (tenant_id, actor_id, action, entity, entity_name) values
    (${A}, ${ua1}, 'grant', 'agent_grant', 'Cấp agent cho nhóm KD'),
    (${A}, ${ua2}, 'grant', 'agent_grant', 'CANARY-HUB-PEER'),
    (${B}, ${ub1}, 'grant', 'agent_grant', 'CANARY-HUB-B')`;
  await owner`insert into admin.audit_log (tenant_id, actor_id, action, entity, entity_name) values
    (${A}, ${ua1}, 'update', 'user', 'Đổi tên hiển thị'),
    (${A}, ${ua2}, 'update', 'user', 'CANARY-ADM-PEER'),
    (${B}, ${ub1}, 'update', 'user', 'CANARY-ADM-B')`;
}

async function seedChats() {
  await talk(A, ua1, [
    ["user", "Hạn mức duyệt hợp đồng mua hàng là bao nhiêu? MINE-1", "1 hour"],
    ["assistant", "Theo quy chế, hạn mức duyệt là 500 triệu đồng. MINE-2", "59 minutes"],
    ["user", "Kho còn bao nhiêu phôi thép? MINE-MID", "2 months"],
    ["user", "Hỏi cũ về bảo hiểm hàng hoá MINE-OLD", "13 months"],
  ]);
  await talk(A, ua1, [["user", "Hạn mức duyệt CANARY-DELETED", "2 hours"]], true);
  await talk(A, ua2, [["user", "Hạn mức duyệt bí mật CANARY-UA2", "1 hour"]]);
  await talk(B, ub1, [["user", "Hạn mức duyệt công ty B CANARY-UB1", "1 hour"]]);
}

const view: PackAccessView = {
  catalog: async () => ({
    features: [{ id: FEAT, key: "contracts-read", status: "on" }],
    entitled: new Set([`${A}:${FEAT}`, `${B}:${FEAT}`]),
    grantGroups: new Map([
      [`${A}:${FEAT}`, ["g"]],
      [`${B}:${FEAT}`, ["g"]],
    ]),
  }),
  user: async (id) => {
    if (id === ua4) return { tenantId: A, groupIds: new Set<string>() };
    if (id === ub1) return { tenantId: B, groupIds: new Set(["g"]) };
    return [ua1, ua2, ua3].includes(id) ? { tenantId: A, groupIds: new Set(["g"]) } : undefined;
  },
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  [A, B] = (await tenants(owner, 2, 1501)) as [string, string];
  [ua1, ua2, ua3, ua4] = (await users(owner, A, 4, { from: 1501 })) as [
    string,
    string,
    string,
    string,
  ];
  [ub1] = (await users(owner, B, 1, { from: 1505 })) as [string];
  await seedContracts();
  await seedAudit();
  await seedChats();
  db = createDb(urls().hubApi, { max: 3 });
  const reg = new PackToolRegistry(view);
  const deps = myHistoryDeps(db, {
    view,
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    sources: [contractsActivitySource(db)],
  });
  for (const t of myHistoryTools(deps)) reg.register(t);
  mcp = packMcpTools(reg);
}, 60_000);

afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("my-chat-history · chỉ hội thoại của chính người gọi", () => {
  it("tool lõi có cho mọi thành viên (kể cả không có quyền gói)", async () => {
    expect((await mcp.tools(ctx(A, ua4))).map((t) => t.name).sort()).toEqual(KEYS);
  });

  it("ua1 tìm 'hạn mức duyệt' ⇒ câu hỏi + trả lời của mình, có link; không có tin ua2 / tenant B / hội thoại đã xoá", async () => {
    const r = await chat(A, ua1, { query: "lần trước tôi hỏi gì về hạn mức duyệt" });
    const s = JSON.stringify(r);
    expect(s).toContain("MINE-1");
    expect(s).toContain("MINE-2");
    expect(s).not.toMatch(/CANARY-(UA2|UB1|DELETED)/);
    const items = r.items as { link: string; role: string }[];
    expect(items[0]?.link).toMatch(/^\/c\/[0-9a-f-]{36}\?flow=[0-9a-f-]{36}$/);
  });

  it("ua1 tìm đúng từ khoá riêng của ua2 ⇒ không thấy gì; ub1 (tenant B) chỉ thấy tin của mình", async () => {
    expect((await chat(A, ua1, { query: "CANARY-UA2 bí mật" })).found).toBe(false);
    const b = JSON.stringify(await chat(B, ub1, { query: "hạn mức duyệt" }));
    expect(b).toContain("CANARY-UB1");
    expect(b).not.toMatch(/MINE-|CANARY-UA2/);
    // Danh tính lệch tenant (user A + tenant B) ⇒ RLS không trả gì.
    expect((await chat(B, ua1, { query: "hạn mức duyệt" })).found).toBe(false);
  });

  it("hạn lưu: mặc định 12 tháng bỏ tin 13 tháng; tenant đặt 1 tháng ⇒ bỏ cả tin 2 tháng; role=user chỉ câu hỏi", async () => {
    const all = JSON.stringify(await chat(A, ua1, { limit: 20 }));
    expect(all).toContain("MINE-MID");
    expect(all).not.toContain("MINE-OLD");
    expect((await chat(A, ua1, {})).retention_months).toBe(12);
    await owner`update admin.tenants set settings = settings || '{"chat_history_months": 1}' where id = ${A}`;
    try {
      const r = await chat(A, ua1, { limit: 20, role: "user" });
      expect(r.retention_months).toBe(1);
      expect(JSON.stringify(r)).not.toMatch(/MINE-MID|MINE-OLD|MINE-2/);
      expect(JSON.stringify(r)).toContain("MINE-1");
    } finally {
      await owner`update admin.tenants set settings = settings - 'chat_history_months' where id = ${A}`;
    }
  });
});

describe("my-chat-history · lặp câu hỏi giữa các lượt (my-activity-fix, sohoptac2 2026-10-21)", () => {
  // e2e 08 lượt 2 trong ngày: câu "Hôm nay tôi đã hỏi AI những gì?" của lượt 1 nằm trong kết quả (đúng — là lịch sử), còn câu
  // của CHÍNH run đang gọi tool thì không (excludeRun). Harness e2e dựa vào điều này để cắt câu trả lời theo câu hỏi có `tag`.
  it("bỏ câu hỏi + trả lời của run đang gọi; giữ câu giống hệt của lượt trước và tin mới vừa hỏi", async () => {
    const q = "Hôm nay tôi đã hỏi AI những gì?";
    await talk(A, ua1, [["user", `${q} PREV-RUN`, "50 minutes"]]);
    await talk(A, ua1, [["user", "Ghi nhớ mã JUST-NOW", "30 seconds"]]);
    const [c] = await owner<
      { id: string; f: string }[]
    >`select v.id, f.id as f from hub.conversations v
      join hub.flows f on f.conversation_id = v.id where v.user_id = ${ua1} order by v.created_at limit 1`;
    const [u, a] = await owner<{ id: string }[]>`insert into hub.messages
        (tenant_id, user_id, conversation_id, flow_id, role, content)
      values (${A}, ${ua1}, ${c?.id as string}, ${c?.f as string}, 'user', ${`${q} THIS-RUN`}),
        (${A}, ${ua1}, ${c?.id as string}, ${c?.f as string}, 'assistant', 'đang trả lời THIS-RUN-ANS')
      returning id`;
    const [run] = await owner<
      { id: string }[]
    >`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id,
        status, config_version, user_message_id, answer_message_id)
      values (${A}, ${ua1}, ${c?.id as string}, ${c?.f as string}, 'running', 1, ${u?.id as string},
        ${a?.id as string}) returning id`;
    const r = JSON.stringify(
      await call(A, ua1, "my-chat-history", { role: "user", limit: 20 }, run?.id as string),
    );
    expect(r).toContain("JUST-NOW");
    expect(r).toContain("PREV-RUN");
    expect(r).not.toContain("THIS-RUN");
  });
});

describe("my-activity · thao tác của chính người gọi", () => {
  it("ua1: sửa HĐ, ghi thanh toán, xoá HĐ, audit Hub/Admin của mình — không có thao tác của ua2/ua3/tenant B", async () => {
    const r = await act(A, ua1, { limit: 50 });
    const s = JSON.stringify(r);
    expect(s).toContain("field_changed");
    expect(s).toContain(NUM);
    expect(s).toContain(`/contracts/${hA}`);
    expect(s).toContain("paid");
    expect(s).toContain("HĐ cũ đã xoá");
    expect(s).toContain("Cấp agent cho nhóm KD");
    expect(s).toContain("Đổi tên hiển thị");
    expect(s).not.toMatch(/CANARY-|approved/);
  });

  it("lọc đối tượng / loại thao tác", async () => {
    const p = JSON.stringify(await act(A, ua1, { object: "partner" }));
    expect(p).toContain("paid");
    expect(p).not.toContain("field_changed");
    const f = JSON.stringify(await act(A, ua1, { action: "field_changed" }));
    expect(f).toContain("field_changed");
    expect(f).not.toMatch(/paid|deleted|Đổi tên/);
  });

  it("ua4 không có quyền gói contracts ⇒ chỉ audit của mình (không có hàng gói)", async () => {
    const r = await act(A, ua4, {});
    expect(r.found).toBe(false);
  });
});

describe("my-activity · lịch sử một HĐ — chỉ HĐ người gọi mở được", () => {
  it("ua3 (quản lý ua1, thấy HĐ) ⇒ đủ lịch sử kèm tên người làm", async () => {
    const r = await act(A, ua3, { contract: NUM });
    expect(r.found).toBe(true);
    const s = JSON.stringify(r);
    expect(s).toContain("field_changed");
    expect(s).toContain("approved");
    expect(s).toContain("User 1501");
    expect(s).not.toContain("CANARY-B");
  });

  it("ua2 (ngang hàng, không thấy HĐ ua1) ⇒ không thấy; ua4 không quyền gói ⇒ không thấy", async () => {
    expect((await act(A, ua2, { contract: NUM })).found).toBe(false);
    expect((await act(A, ua2, { contract: hA })).found).toBe(false);
    expect((await act(A, ua4, { contract: NUM })).found).toBe(false);
  });

  it("chéo tenant: ub1 hỏi cùng số ⇒ chỉ HĐ tenant B; hỏi id HĐ tenant A ⇒ không thấy", async () => {
    const b = JSON.stringify(await act(B, ub1, { contract: NUM }));
    expect(b).toContain("CANARY-B-HD");
    expect(b).not.toContain("HĐ mua phôi thép");
    expect((await act(B, ub1, { contract: hA })).found).toBe(false);
  });
});
