// X1-AC12 · ADM-FR-37 · ADM-FR-62 · `GroupDto.agent_count` tính thật từ `hub.agent_grants` (plan §2.4, B4; test-plan §2 AC12 I).
// DB qc (createM3Env; bảng stub `hub.agent_grants` của migrations-dev, admin_rw có SELECT). Grant dựng bằng owner SQL.
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset3 + xoá grant).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GroupListResponseSchema, GroupSchema } from "@ai/contracts";
import { callerOf, createM3Env, ID3, type M3Env, TENANT_ID, USER_ID } from "../M3/_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
const AGENT = {
  chatbot: "01900000-0000-7000-8000-0000000012a1",
  trello: "01900000-0000-7000-8000-0000000012a2",
  khac: "01900000-0000-7000-8000-0000000012a3",
} as const;
const KT = ID3.group.acmeKeToan;
const KD = ID3.group.acmeKinhDoanh;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
});
beforeEach(async () => {
  await env.reset3();
  await env.owner`delete from hub.agent_grants`;
  // ke-toan (acme): 2 agent khác nhau; thêm grant user + grant group khác tenant để chắc chỉ đếm đúng subject.
  await env.owner`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values
    (${AGENT.chatbot}, ${TENANT_ID.acme}, 'group', ${KT}),
    (${AGENT.trello}, ${TENANT_ID.acme}, 'group', ${KT}),
    (${AGENT.khac}, ${TENANT_ID.acme}, 'user', ${USER_ID.lan}),
    (${AGENT.khac}, ${TENANT_ID.globex}, 'group', ${ID3.group.globexKeToan})`;
});
afterAll(async () => {
  await env.owner`delete from hub.agent_grants`;
  await env.close();
});

const countsOf = async (call: typeof admin, qs: string) => {
  const res = await call("GET", `/admin/groups${qs}`);
  expect(res.status).toBe(200);
  const b = GroupListResponseSchema.parse(res.json);
  return Object.fromEntries(b.items.map((g) => [g.key, g.agent_count]));
};

describe("X1-AC12 · agent_count", () => {
  it("X1-AC12 · ADM-FR-37 · danh sách acme (platform admin): ke-toan 2, kinh-doanh 0, beta-testers 0", async () => {
    expect(await countsOf(admin, `?tenant_id=${TENANT_ID.acme}`)).toEqual({
      "beta-testers": 0,
      "ke-toan": 2,
      "kinh-doanh": 0,
    });
  });

  it("X1-AC12 · ADM-FR-37 · tenant_admin (binh) thấy cùng số; globex ke-toan = 1 (grant khác tenant không cộng chéo)", async () => {
    expect((await countsOf(binh, ""))["ke-toan"]).toBe(2);
    expect((await countsOf(admin, `?tenant_id=${TENANT_ID.globex}`))["ke-toan"]).toBe(1);
  });

  it("X1-AC12 · ADM-FR-62 · chi tiết GET /admin/groups/:id: ke-toan 2, kinh-doanh 0", async () => {
    for (const [id, n] of [
      [KT, 2],
      [KD, 0],
    ] as const) {
      const res = await admin("GET", `/admin/groups/${id}`);
      expect(res.status).toBe(200);
      expect(GroupSchema.parse(res.json).agent_count).toBe(n);
    }
  });

  it("X1-AC12 · plan §2.4 · admin_rw mất quyền SELECT hub.agent_grants → agent_count 0 (không lỗi 500)", async () => {
    try {
      await env.owner.unsafe("revoke select on hub.agent_grants from admin_rw");
      expect(await countsOf(admin, `?tenant_id=${TENANT_ID.acme}`)).toEqual({
        "beta-testers": 0,
        "ke-toan": 0,
        "kinh-doanh": 0,
      });
      const res = await admin("GET", `/admin/groups/${KT}`);
      expect(res.status).toBe(200);
      expect(GroupSchema.parse(res.json).agent_count).toBe(0);
    } finally {
      await env.owner.unsafe("grant select on hub.agent_grants to admin_rw");
    }
  });
});
