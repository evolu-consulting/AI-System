// HD4-NFR-02 · HD4-AC05 · N1 D-12: role quét chéo tenant `contracts_job` — NOBYPASSRLS/NOINHERIT/NOLOGIN, chỉ đọc (tenant_id,
// remind_at) của hàng có lịch, không đọc nội dung HĐ, không ghi, không chạm bảng khác / schema hub / cổng notify. Policy mới chỉ
// gắn `contracts_job` (contracts_rw vẫn cách ly như HD1). Chạy qua `hub_api` + SET ROLE như đường thật (`withPackJobScope`).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { asRole, pgCode } from "@ai/test-kit/db";
import { setupX2a } from "../X2a/_x2a";
import { addContract, JOB_ROLE, needHd4, resetHd4, type Sql, T } from "./_support/hd4";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  await sql?.end();
});
let a1 = "";
beforeEach(async () => {
  await needHd4(sql);
  await resetHd4(sql);
  a1 = await addContract(sql, { tenant: T.acme });
  await addContract(sql, { tenant: T.beta });
  await addContract(sql, { tenant: T.acme, status: "needs_review" }); // remind_at null ⇒ ngoài policy
});
const job = <R>(fn: (tx: Sql) => Promise<R>) => asRole(JOB_ROLE, null, fn, { rollback: true });

describe("HD4-NFR-02 · role contracts_job (D-12)", () => {
  it("cờ role: NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOINHERIT, NOLOGIN; hub_api SET được, không INHERIT", async () => {
    const [r] =
      await sql`select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin
      from pg_roles where rolname = ${JOB_ROLE}`;
    expect(r).toEqual({
      rolbypassrls: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolcanlogin: false,
    });
    const [m] = await sql`select m.inherit_option as inh, m.set_option as set from pg_auth_members m
      join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
      where r.rolname = ${JOB_ROLE} and u.rolname = 'hub_api'`;
    expect(m).toEqual({ inh: false, set: true });
  });
  it("đọc chéo tenant CHỈ (tenant_id, remind_at) của hàng có lịch: thấy 2 hàng (acme + beta), không thấy hàng needs_review", async () => {
    const rows = await job(
      (tx) => tx`select tenant_id from contracts.contracts order by tenant_id`,
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([T.acme, T.beta].sort());
  });
  it("không đọc nội dung HĐ (title/fields/source_text/id, select *) ⇒ 42501", async () => {
    for (const col of ["title", "fields", "source_text", "owner_user_id", "*"])
      expect({
        col,
        code: await pgCode(() => job((tx) => tx.unsafe(`select ${col} from contracts.contracts`))),
      }).toEqual({
        col,
        code: "42501",
      });
  });
  it("không ghi: UPDATE remind_at / INSERT / DELETE ⇒ 42501", async () => {
    expect(
      await pgCode(() =>
        job((tx) => tx`update contracts.contracts set remind_at = null where id = ${a1}`),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() =>
        job(
          (tx) =>
            tx`insert into contracts.contracts (tenant_id, title, created_by) values (${T.acme}, 'x', ${T.acme})`,
        ),
      ),
    ).toBe("42501");
    expect(await pgCode(() => job((tx) => tx`delete from contracts.contracts`))).toBe("42501");
  });
  it("không chạm bảng khác của gói, schema hub, cổng notify.enqueue ⇒ 42501", async () => {
    for (const t of [
      "contracts.contract_items",
      "contracts.contract_events",
      "contracts.contract_reminders",
      "contracts.contract_categories",
      "contracts.files",
      "hub.notifications",
    ])
      expect({
        t,
        code: await pgCode(() => job((tx) => tx.unsafe(`select 1 from ${t} limit 1`))),
      }).toEqual({
        t,
        code: "42501",
      });
    expect(
      await pgCode(() => job((tx) => tx`select notify.enqueue('contracts', '[]'::jsonb)`)),
    ).toBe("42501");
  });
  it("policy mới chỉ gắn contracts_job: contracts_rw tenant beta vẫn thấy 0 hàng của acme", async () => {
    const pols = await sql<{ name: string; roles: string[] }[]>`select polname as name,
      array(select rolname::text from pg_roles where oid = any(polroles)) as roles
      from pg_policy where polrelid = 'contracts.contracts'::regclass order by 1`;
    expect(pols).toEqual([
      { name: "contracts_job_due", roles: [JOB_ROLE] },
      { name: "contracts_tenant", roles: ["contracts_rw"] },
    ]);
    const n = await asRole(
      "contracts_rw",
      T.beta,
      (tx) => tx`select count(*)::int as n from contracts.contracts
      where tenant_id = ${T.acme}`,
      { rollback: true },
    );
    expect(n[0]?.n).toBe(0);
  });
});
