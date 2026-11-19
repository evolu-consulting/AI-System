// CR-189 · BR-189-6 · Group của phòng ban còn được Hub dùng (agent, quy trình, việc duyệt): xoá phòng không làm mất cấu hình,
// việc duyệt đang mở chặn xoá; `access {gained, lost}` tính cả agent + quy trình; hàm DEFINER `hub.org_group_refs` chỉ đúng công ty;
// N2: dữ liệu do quản trị A tạo, quản trị B (người được giao) thêm/chuyển/bỏ người.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations, withScope } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { resetTestDb } from "@ai/db/test-db";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import type { OrgCall } from "./org.service";
import { addDeptMembers, removeDeptMember } from "./org-dept.members";
import { createDept, deleteDept } from "./org-dept.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000f3001";
const OTHER = "01900000-0000-7000-8000-0000000f3002";
const ADMIN = "01900000-0000-7000-8000-0000000f3011"; // người tạo dữ liệu
const ADMIN2 = "01900000-0000-7000-8000-0000000f3012"; // người được giao
const U1 = "01900000-0000-7000-8000-0000000f3021";
const U2 = "01900000-0000-7000-8000-0000000f3022";
const AGENT = "01900000-0000-7000-8000-0000000f3051";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const callOf = (userId: string, tid = TID): OrgCall => ({
  ctx: { db },
  actor: { userId, tenantId: tid, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: tid },
});
const creator = callOf(ADMIN);
const assignee = callOf(ADMIN2);
const user = (id: string, name: string, role = "member") =>
  owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${id}, ${TID}, ${name}, 'x', ${name}, ${role}, ${`${name}@x.test`})`;
const mk = async (name: string, parent: string | null = null) =>
  (await createDept(creator, undefined, { name, parent_group_id: parent })).group_id;
const n = async (q: PromiseLike<Record<string, unknown>[]>) => (await q)[0]?.n as number;
// biome-ignore lint/suspicious/noExplicitAny: lỗi bắt được (AppError hoặc lỗi PG) đọc theo trường
const err = async (p: Promise<unknown>): Promise<any> => p.catch((e) => e);

/** Cấp agent cho nhóm (bỏ kiểm khoá ngoại tới hub.agents — chỉ cần hàng để kiểm tham chiếu nhóm). */
async function agentGrant(tenant: string, ...groups: string[]) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const g of groups)
      await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values (${AGENT}, ${tenant}, 'group', ${g})`;
  });
}

/** Việc duyệt giả (bỏ kiểm khoá ngoại tới run/stage — chỉ cần hàng để kiểm tham chiếu nhóm). */
async function review(opts: { status: "open" | "closed"; group?: string; assignee?: string }) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const [t] = await tx<{ id: string }[]>`insert into hub.review_tasks
      (tenant_id, process_run_id, stage_run_id, kind, status, question, assignee_group_id)
      values (${TID}, gen_random_uuid(), gen_random_uuid(), 'ask', ${opts.status}, 'q', ${opts.group ?? null}) returning id`;
    if (opts.assignee)
      await tx`insert into hub.review_task_assignees (tenant_id, task_id, group_id) values (${TID}, ${t?.id as string}, ${opts.assignee})`;
  });
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`delete from hub.review_tasks where tenant_id = ${TID}`;
  await owner`delete from hub.agent_grants where tenant_id = ${TID}`;
  await owner`delete from hub.process_defs where tenant_id = ${TID}`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme'), (${OTHER}, 'beta', 'Beta')`;
  await user(ADMIN, "binh", "tenant_admin");
  await user(ADMIN2, "chi", "tenant_admin");
  await user(U1, "lan");
  await user(U2, "thu");
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("CR-189 · xoá phòng khi Group còn được Hub dùng", () => {
  test("agent_grants theo nhóm ⇒ chỉ bỏ đánh dấu phòng ban, Group + quyền agent giữ", async () => {
    const a = await mk("A");
    await agentGrant(TID, a);
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: false });
    expect(await n(owner`select count(*)::int as n from admin.groups where id = ${a}`)).toBe(1);
    expect(
      await n(owner`select count(*)::int as n from admin.departments where group_id = ${a}`),
    ).toBe(0);
    expect(
      await n(owner`select count(*)::int as n from hub.agent_grants where subject_id = ${a}`),
    ).toBe(1);
  });
  test("quy trình có run_group_ids chứa nhóm ⇒ giữ Group", async () => {
    const a = await mk("A");
    await owner`insert into hub.process_defs (tenant_id, key, name, stages, run_group_ids)
      values (${TID}, 'qt-1', 'QT', '[{"key":"s0"}]'::jsonb, ${`{${a}}`}::uuid[])`;
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: false });
    expect(await n(owner`select count(*)::int as n from admin.groups where id = ${a}`)).toBe(1);
  });
  test("việc duyệt đã đóng từng giao cho nhóm (cả hai dạng) ⇒ giữ Group", async () => {
    const a = await mk("A");
    const b = await mk("B");
    await review({ status: "closed", group: a });
    await review({ status: "closed", assignee: b });
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: false });
    expect(await deleteDept(assignee, undefined, b)).toEqual({ group_deleted: false });
  });
  test("việc duyệt ĐANG MỞ giao cho nhóm (assignee_group_id hoặc review_task_assignees) ⇒ 409 DEPT_IN_USE kèm số, không xoá gì", async () => {
    const a = await mk("A");
    const b = await mk("B");
    await review({ status: "open", group: a });
    await review({ status: "open", assignee: b });
    for (const g of [a, b]) {
      const e = await err(deleteDept(assignee, undefined, g));
      expect(isAppError(e, "DEPT_IN_USE" as never)).toBe(true);
      expect(e.status).toBe(409);
      expect(e.details).toEqual({ open_reviews: 1 });
    }
    expect(
      await n(owner`select count(*)::int as n from admin.departments where tenant_id = ${TID}`),
    ).toBe(2);
    await owner`update hub.review_tasks set status = 'closed' where tenant_id = ${TID}`;
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: false });
  });
  test("tham chiếu của công ty khác không làm giữ Group, Group không dùng ở đâu ⇒ xoá hẳn", async () => {
    const a = await mk("A");
    await agentGrant(OTHER, a);
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: true });
    await owner`delete from hub.agent_grants where tenant_id = ${OTHER}`;
  });
});

describe("CR-189 · fail-closed khi không gọi được hàm tham chiếu Hub", () => {
  test("có bảng Hub nhưng hàm hub.org_group_refs không cấp cho admin_rw ⇒ xoá phòng báo lỗi, KHÔNG xoá Group, phòng còn nguyên", async () => {
    const a = await mk("A");
    await agentGrant(TID, a);
    await owner`revoke execute on function hub.org_group_refs(uuid, uuid[]) from admin_rw`;
    try {
      const e = await err(deleteDept(assignee, undefined, a));
      expect(e.code).toBe("INTERNAL_ERROR");
      expect(e.details).toEqual({ reason: "hub_refs_unavailable" });
      expect(await n(owner`select count(*)::int as n from admin.groups where id = ${a}`)).toBe(1);
      expect(
        await n(owner`select count(*)::int as n from admin.departments where group_id = ${a}`),
      ).toBe(1);
      // chuyển người vẫn chạy (access chỉ báo), chỉ thiếu phần Hub
      expect((await addDeptMembers(assignee, undefined, a, { user_ids: [U1] })).added).toEqual([
        U1,
      ]);
    } finally {
      await owner`grant execute on function hub.org_group_refs(uuid, uuid[]) to admin_rw`;
    }
    expect(await deleteDept(assignee, undefined, await mk("B"))).toEqual({ group_deleted: true });
  });
});

describe("CR-189 · access {gained, lost} tính cả agent + quy trình", () => {
  test("rời nhóm có agent X + quy trình P, đến nhóm có agent X ⇒ chỉ mất P, không còn nhóm nào ⇒ mất cả hai", async () => {
    const a = await mk("A");
    const b = await mk("B");
    await agentGrant(TID, a, b);
    await owner`insert into hub.process_defs (tenant_id, key, name, stages, run_group_ids) values (${TID}, 'qt-1', 'QT', '[{"key":"s0"}]'::jsonb, ${`{${a}}`}::uuid[])`;
    await addDeptMembers(assignee, undefined, a, { user_ids: [U1] });
    const r = await addDeptMembers(assignee, undefined, b, { user_ids: [U1] });
    expect(r.access).toEqual({ gained: 0, lost: 1 });
    expect((await removeDeptMember(assignee, undefined, b, U1)).access).toEqual({
      gained: 0,
      lost: 1,
    });
  });
  test("vào nhóm có agent + quy trình (2 người × 2 mục) ⇒ gained 4", async () => {
    const a = await mk("A");
    await agentGrant(TID, a);
    await owner`insert into hub.process_defs (tenant_id, key, name, stages, run_group_ids) values (${TID}, 'qt-1', 'QT', '[{"key":"s0"}]'::jsonb, ${`{${a}}`}::uuid[])`;
    expect((await addDeptMembers(assignee, undefined, a, { user_ids: [U1, U2] })).access).toEqual({
      gained: 4,
      lost: 0,
    });
  });
});

describe("CR-189 · hàm hub.org_group_refs chỉ đúng công ty", () => {
  test("quản trị công ty khác gọi với id công ty này ⇒ 42501, đúng công ty ⇒ ok", async () => {
    const a = await mk("A");
    await agentGrant(TID, a);
    const call = (tid: string) =>
      withScope(db, { kind: "tenant", tenantId: tid }, (tx) =>
        tx.execute(sql`select kind from hub.org_group_refs(${TID}::uuid, array[${a}]::uuid[])`),
      );
    const e = (await err(call(OTHER))) as { code?: string; cause?: { code?: string } };
    expect(e.code ?? e.cause?.code).toBe("42501");
    expect((await call(TID)).length).toBe(1);
  });
});

describe("CR-189 · N2: người được giao (khác người tạo) thêm/chuyển/bỏ người", () => {
  test("binh thêm U1,U2 vào A, chi chuyển U1 sang B và bỏ U2 khỏi A (về cha), binh chuyển U2 lại, hàng ghi đúng người", async () => {
    const root = await mk("Gốc");
    const a = await mk("A", root);
    const b = await mk("B", root);
    await addDeptMembers(creator, undefined, a, { user_ids: [U1, U2] });
    const mv = await addDeptMembers(assignee, undefined, b, { user_ids: [U1] });
    expect(mv.moved).toEqual([{ user_id: U1, from_group_ids: [a] }]);
    const rm = await removeDeptMember(assignee, undefined, a, U2);
    expect(rm).toMatchObject({ removed: true, moved_to_group_id: root });
    const back = await addDeptMembers(creator, undefined, a, { user_ids: [U2] });
    expect(back.moved).toEqual([{ user_id: U2, from_group_ids: [root] }]);
    const rows = await owner<
      { user_id: string; group_id: string; added_by: string }[]
    >`select user_id, group_id, added_by
      from admin.group_members where user_id in (${U1}, ${U2}) order by user_id`;
    expect([...rows]).toEqual([
      { user_id: U1, group_id: b, added_by: ADMIN2 },
      { user_id: U2, group_id: a, added_by: ADMIN },
    ]);
    const who = await owner<
      { actor_id: string }[]
    >`select distinct actor_id from admin.audit_log where entity_id = ${b}`;
    expect(who.map((r) => r.actor_id)).toContain(ADMIN2);
  });
});
