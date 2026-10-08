// HUB-FR-78 · ADM-FR-37 · H3b-R11 · HUB-H3b-AC-06 · test-plan-cases H3b §2.4 A55–A62: GET `/agent-grants` — agent có
// entitlement chưa thu hồi của T (không Orchestrator), grant theo agent, lọc subject, grant mồ côi ẩn (Q-K8), đọc DB
// ngay sau POST (PL5), version hiện tại, cắt 200 agent / 500 grant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type AgentGrantListResponse, AgentGrantListResponseSchema } from "@ai/contracts/hub-admin";
import type { Res } from "../H1/_fixtures";
import { PROFILE } from "../H1/_hub";
import {
  AGT,
  type Ctx,
  clearGrants,
  GRP,
  type GrantRef,
  grantRow,
  idGen3,
  insertGrant,
  listGrants,
  postGrant,
  startH3b,
  T,
  USERS,
  versionOf,
} from "./_h3b";

let x: Ctx;
beforeAll(async () => {
  x = await startH3b();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const id = idGen3(2000);
const G: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.keToan };
function parsed(res: Res): AgentGrantListResponse {
  expect(res.status).toBe(200);
  return AgentGrantListResponseSchema.parse(res.json);
}
const itemOf = (p: AgentGrantListResponse, agent: string) =>
  p.items.find((i) => i.agent.id === agent);
const subjectIds = (p: AgentGrantListResponse, agent: string) =>
  (itemOf(p, agent)?.grants ?? []).map((g) =>
    // CR-054: thêm subject `tenant` (chỉ đổi kiểu).
    g.subject.type === "group"
      ? g.subject.group.id
      : g.subject.type === "user"
        ? g.subject.user.id
        : "*",
  );

describe("A55–A59 · nội dung danh sách [HUB-FR-78 · ADM-FR-37 · H3b-R11 · HUB-H3b-AC-06]", () => {
  it("ADM-FR-37 · A55 · tadmin GET ⇒ items {cli-x, hoadon, tatt} sắp key; không Orchestrator/cu/khodu/chua; tatt.enabled false, cli-x.runnable false [H3b-R11]", async () => {
    const p = parsed(await listGrants(x, "tadmin"));
    expect(p.items.map((i) => i.agent.key)).toEqual(["cli-x", "hoadon", "tatt"]);
    expect({ tenant: p.tenant_id, truncated: p.truncated }).toEqual({
      tenant: T.acme,
      truncated: false,
    });
    const flags = p.items.map((i) => [i.agent.key, i.agent.enabled, i.agent.runnable]);
    expect(flags).toEqual([
      ["cli-x", true, false],
      ["hoadon", true, true],
      ["tatt", false, true],
    ]);
  });

  it("HUB-BR-14 · A56 · grant beta trên cùng agent (owner) · badmin GET ⇒ acme không thấy grant beta, beta không thấy grant acme [H3b-R03, R11]", async () => {
    await x.sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${AGT.hoadon}, ${T.beta})`;
    await insertGrant(x.sql, T.acme, G);
    await insertGrant(x.sql, T.beta, { agent: AGT.hoadon, type: "group", subject: GRP.banHang });
    try {
      const acme = parsed(await listGrants(x, "tadmin"));
      const beta = parsed(await listGrants(x, "badmin"));
      expect(subjectIds(acme, AGT.hoadon)).toEqual([GRP.keToan]);
      expect(subjectIds(beta, AGT.hoadon)).toEqual([GRP.banHang]);
      expect(beta.items.map((i) => i.agent.key)).toEqual(["hoadon", "khodu"]);
    } finally {
      await x.sql`delete from hub.agent_entitlements where agent_id = ${AGT.hoadon} and tenant_id = ${T.beta}`;
      await clearGrants(x.sql);
    }
  });

  it("ADM-FR-37 · A57 · ?subject_type=group&subject_id=<ke-toan> ⇒ chỉ grant ke-toan · chỉ subject_type ⇒ 400 VALIDATION_ERROR [H3b-R11]", async () => {
    await insertGrant(x.sql, T.acme, G);
    await insertGrant(x.sql, T.acme, { agent: AGT.hoadon, type: "user", subject: USERS.hoa.id });
    await insertGrant(x.sql, T.acme, { agent: AGT.tatt, type: "group", subject: GRP.kho });
    try {
      const p = parsed(
        await listGrants(x, "tadmin", { subject_type: "group", subject_id: GRP.keToan }),
      );
      expect(p.items.flatMap((i) => i.grants.map((g) => [i.agent.key, g.subject.type]))).toEqual([
        ["hoadon", "group"],
      ]);
      expect(itemOf(p, AGT.hoadon)?.grants_total).toBe(1);
      const bad = await listGrants(x, "tadmin", { subject_type: "group" });
      expect([bad.status, bad.json?.error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    } finally {
      await clearGrants(x.sql);
    }
  });

  it("ADM-FR-37 · A59 · cu (ent. thu hồi) có grant ⇒ không trong items [H3b-R11 · AC-A11]", async () => {
    await insertGrant(x.sql, T.acme, { agent: AGT.cu, type: "group", subject: GRP.keToan });
    try {
      const p = parsed(await listGrants(x, "tadmin"));
      expect(p.items.map((i) => i.agent.key)).not.toContain("cu");
    } finally {
      await clearGrants(x.sql);
    }
  });
});

describe("A60–A62 · đọc DB, version, giới hạn [HUB-FR-78 · H3b-R11 · PL5]", () => {
  it("HUB-FR-78 · A60 · POST rồi GET ngay (không chờ) ⇒ thấy grant mới (đọc DB, PL5) [H3b-R11]", async () => {
    try {
      expect((await postGrant(x, "tadmin", G)).status).toBe(201);
      expect(subjectIds(parsed(await listGrants(x, "tadmin")), AGT.hoadon)).toEqual([GRP.keToan]);
    } finally {
      await clearGrants(x.sql);
    }
  });

  it("HUB-FR-78 · A61 · hub_config_version = config_meta hiện tại [H3b-R11]", async () => {
    const p = parsed(await listGrants(x, "tadmin"));
    expect(p.hub_config_version).toBe(await versionOf(x.sql));
  });

  it("HUB-FR-78 · A58 · grant kho rồi owner xoá group kho ⇒ không xuất hiện; hàng DB còn (Q-K8) [H3b-R11]", async () => {
    const g: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.kho };
    await insertGrant(x.sql, T.acme, g);
    await x.sql`delete from admin.groups where id = ${GRP.kho}`;
    const p = parsed(await listGrants(x, "tadmin"));
    expect(subjectIds(p, AGT.hoadon)).not.toContain(GRP.kho);
    expect(itemOf(p, AGT.hoadon)?.grants_total).toBe(0);
    expect(await grantRow(x.sql, T.acme, g)).toBeDefined();
    await clearGrants(x.sql);
  });

  it("HUB-FR-78 · A62 · 201 agent có ent. acme · 501 grant user trên hoadon ⇒ items 200 + truncated; grants 500, grants_total 501 [H3b-R11]", async () => {
    const agents = Array.from({ length: 201 }, (_, i) => ({
      id: id(),
      key: `zz-${String(i).padStart(3, "0")}`,
      name: x.sql.json({ vi: `zz ${i}`, en: `zz ${i}` }),
      description: "Agent đệm để kiểm tra giới hạn 200 mục.",
      runtime: "agentic-cli",
      profile_id: PROFILE.fake,
      system_prompt: "",
    }));
    await x.sql`insert into hub.agents ${x.sql(agents)}`;
    await x.sql`insert into hub.agent_entitlements ${x.sql(agents.map((a) => ({ agent_id: a.id, tenant_id: T.acme })))}`;
    const users = Array.from({ length: 501 }, (_, i) => ({
      id: id(),
      tenant_id: T.acme,
      username: `u${String(i).padStart(3, "0")}`,
      email: `u${i}@example.test`,
      password_hash: "x",
      display_name: `U ${i}`,
      role: "member",
    }));
    await x.sql`insert into admin.users ${x.sql(users)}`;
    await x.sql`insert into hub.agent_grants ${x.sql(
      users.map((u) => ({
        agent_id: AGT.hoadon,
        tenant_id: T.acme,
        subject_type: "user",
        subject_id: u.id,
      })),
    )}`;
    const p = parsed(await listGrants(x, "tadmin"));
    expect({ n: p.items.length, truncated: p.truncated }).toEqual({ n: 200, truncated: true });
    const h = itemOf(p, AGT.hoadon);
    expect({ n: h?.grants.length, total: h?.grants_total }).toEqual({ n: 500, total: 501 });
  });
});
