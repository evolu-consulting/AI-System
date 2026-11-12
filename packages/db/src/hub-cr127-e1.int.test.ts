// CR-127 · E1 · migration 0131_cr127_evidence_claim_delegation: cách ly tenant `evidence`/`delegations`/`review_task_votes`/`task_signals`,
// bằng chứng BẤT BIẾN (UPDATE/DELETE bị chặn kể cả role chủ), `hub.record_evidence` kiểm tệp/tenant/uỷ quyền, `hub.evidence_get` và
// `hub.task_holder` sai tenant ⇒ rỗng, `hub.task_signal` idempotent, CHECK mới (kind milestone, claim, notice kind, claim_release_h).
// Hàng nền chèn bằng owner với `session_replication_role = replica` (bỏ FK) — chỉ để thử RLS/hàm (như hub-rls-gap).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_cr127_e1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const hub = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });

const TA = "01900000-0000-7000-8000-00000127ea01";
const TB = "01900000-0000-7000-8000-00000127eb01";
const ix = (t: string, n: number) => `${t.slice(0, -2)}${String(n).padStart(2, "0")}`;
const UA = ix(TA, 11); // người dùng tenant A
const UA2 = ix(TA, 12); // người được uỷ quyền, tenant A
const UB = ix(TB, 11);
const scope = (t: string, u: string): HubScope => ({ kind: "user", tenantId: t, userId: u });
const A = scope(TA, UA);
const B = scope(TB, UB);

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? String(e),
  );
type Row = Record<string, unknown>;
const rows = (r: unknown) => [...(r as Row[])];
const run = <T>(
  s: HubScope,
  f: (tx: Parameters<Parameters<typeof withHubScope>[2]>[0]) => Promise<T>,
) => withHubScope(hub, s, f);

/** Tệp đính kèm giả của tenant `t` (owner, bỏ FK): `size` byte, `mime`. */
async function attachment(t: string, n: number, mime = "image/png", size = 1000): Promise<string> {
  const id = ix(t, n);
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${t}, ${ix(t, 11)}, 'upload', 'f', 'f', ${mime}, ${size}, ${"a".repeat(64)}, ${`${t}/${id}`})`;
  });
  return id;
}

const TASK_A = ix(TA, 30);
const TASK_B = ix(TB, 30);
const GROUP_A = ix(TA, 40);
async function task(t: string, id: string, ref: string, group: string | null): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.review_tasks (id, tenant_id, process_run_id, stage_run_id, kind, subject_ref, assignee_group_id,
        claimed_by, claimed_at)
      values (${id}, ${t}, ${ix(t, 31)}, ${ix(t, 32)}, 'milestone', ${ref}, ${group}, ${t === TA ? UA2 : null},
        ${t === TA ? new Date() : null})`;
    if (group)
      await tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${t}, ${group}, ${ix(t, 11)}),
        (${t}, ${group}, ${ix(t, 12)})`;
    await tx`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via) values (${t}, ${id}, ${ix(t, 13)}, 'initial')`;
  });
}

let sigA = "";
let sigB = "";
beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  sigA = await attachment(TA, 50);
  sigB = await attachment(TB, 50);
  await task(TA, TASK_A, "ob-1", GROUP_A);
  await task(TB, TASK_B, "ob-1", null);
});
afterAll(async () => {
  await hub.close();
  await owner.end();
});

const record = (
  s: HubScope,
  kind: string,
  subject: string,
  sig: string | null,
  files: string[],
  behalf: string | null,
) =>
  run(s, async (tx) => {
    const r = await tx.execute(
      dsql`select hub.record_evidence(${kind}, ${subject}::uuid, ${"ý kiến"}, ${sig}::uuid, ${`{${files.join(",")}}`}::uuid[], ${behalf}::uuid) as id`,
    );
    return (rows(r)[0] as { id: string }).id;
  });

describe("CR-127 E1 · evidence (0131, int)", () => {
  let evA = "";
  test("CR-127 E1 · record_evidence ghi đúng tenant/người ghi; tệp của chính tenant", async () => {
    evA = await record(A, "task_decision", TASK_A, sigA, [], null);
    const [r] =
      await owner`select tenant_id, by_user, signature_attachment_id from hub.evidence where id = ${evA}`;
    expect(r).toMatchObject({ tenant_id: TA, by_user: UA, signature_attachment_id: sigA });
  });
  test("CR-127 E1 · chặn chéo tenant: B không đọc được evidence của A (select + evidence_get rỗng)", async () => {
    expect(rows(await run(B, (tx) => tx.execute(dsql`select id from hub.evidence`)))).toHaveLength(
      0,
    );
    expect(
      rows(
        await run(B, (tx) =>
          tx.execute(dsql`select id from hub.evidence_get(${`{${evA}}`}::uuid[])`),
        ),
      ),
    ).toHaveLength(0);
    expect(
      rows(
        await run(A, (tx) =>
          tx.execute(dsql`select id from hub.evidence_get(${`{${evA}}`}::uuid[])`),
        ),
      ),
    ).toHaveLength(1);
    expect(
      rows(await hub.db.execute(dsql`select id from hub.evidence_get(${`{${evA}}`}::uuid[])`)),
    ).toHaveLength(0);
  });
  test("CR-127 E1 · bất biến: hub_rw UPDATE/DELETE/INSERT thẳng ⇒ 42501; role chủ UPDATE/DELETE ⇒ trigger chặn", async () => {
    expect(
      await code(
        run(A, (tx) => tx.execute(dsql`update hub.evidence set note = 'x' where id = ${evA}`)),
      ),
    ).toBe("42501");
    expect(
      await code(run(A, (tx) => tx.execute(dsql`delete from hub.evidence where id = ${evA}`))),
    ).toBe("42501");
    expect(
      await code(
        run(A, (tx) =>
          tx.execute(dsql`insert into hub.evidence (tenant_id, subject_kind, subject_id, note, by_user)
            values (${TA}, 'milestone', ${TASK_A}, 'x', ${UA})`),
        ),
      ),
    ).toBe("42501");
    expect(await code(owner`update hub.evidence set note = 'x' where id = ${evA}`)).toBe("42501");
    expect(await code(owner`delete from hub.evidence where id = ${evA}`)).toBe("42501");
  });
  test("CR-127 E1 · record_evidence: tệp tenant khác / chữ ký sai loại / quá 5 tệp / việc tenant khác ⇒ lỗi; không scope ⇒ 42501", async () => {
    expect(await code(record(A, "milestone", TASK_A, sigB, [], null))).toBe("42501");
    expect(await code(record(A, "milestone", TASK_A, null, [sigB], null))).toBe("42501");
    const jpg = await attachment(TA, 51, "image/jpeg");
    expect(await code(record(A, "milestone", TASK_A, jpg, [], null))).toBe("42501");
    const many = await Promise.all(
      [60, 61, 62, 63, 64, 65].map((n) => attachment(TA, n, "application/pdf")),
    );
    expect(await code(record(A, "milestone", TASK_A, null, many, null))).toBe("22023");
    expect(await code(record(A, "task_decision", TASK_B, null, [], null))).toBe("42501");
    expect(
      await code(
        hub.db.execute(
          dsql`select hub.record_evidence('milestone', ${TASK_A}::uuid, 'x', null, '{}'::uuid[], null)`,
        ),
      ),
    ).toBe("42501");
    expect(await code(record(A, "bogus", TASK_A, null, [], null))).toBe("23514");
  });
  test("CR-127 E1 · on_behalf_of chỉ khi có uỷ quyền (hoặc assignee delegated của đúng việc)", async () => {
    expect(await code(record(scope(TA, UA2), "milestone", TASK_A, null, [], UA))).toBe("42501");
    await run(A, (tx) =>
      tx.execute(dsql`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
        values (${TA}, ${UA}, ${UA2}, now() - interval '1 day', now() + interval '1 day', '{milestone}', ${UA})`),
    );
    const id = await record(scope(TA, UA2), "milestone", TASK_A, null, [], UA);
    const [r] = await owner`select by_user, on_behalf_of from hub.evidence where id = ${id}`;
    expect(r).toMatchObject({ by_user: UA2, on_behalf_of: UA });
  });
  test("CR-127 E1 · on_behalf_of: uỷ quyền đã huỷ / hết hạn / sai loại việc ⇒ 42501; TRUNCATE evidence bị chặn", async () => {
    const del = (from: string, rel: string, kinds: string, revoked: boolean) =>
      owner`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by, revoked_at)
        values (${TA}, ${from}, ${UA2}, now() - interval '1 day' + ${rel}::interval, now() + ${rel}::interval, ${kinds}::text[], ${UA},
          ${revoked ? new Date() : null})`;
    const U3 = ix(TA, 15);
    const U4 = ix(TA, 16);
    const U5 = ix(TA, 17);
    await del(U3, "0 hours", "{milestone}", true); // đã huỷ
    await del(U4, "-3 days", "{milestone}", false); // hết hạn
    await del(U5, "0 hours", "{esign}", false); // sai loại: milestone cần kind milestone
    for (const u of [U3, U4, U5])
      expect(await code(record(scope(TA, UA2), "milestone", TASK_A, null, [], u))).toBe("42501");
    // TRUNCATE bị chặn: 0A000 (bảng có FK từ review_task_votes) hoặc 42501 (trigger evidence_no_truncate)
    expect(["42501", "0A000"]).toContain(await code(owner`truncate hub.evidence`));
  });
});

describe("CR-127 E1 · delegations / votes / task_signals RLS (0131, int)", () => {
  test("CR-127 E1 · delegations: B không thấy/không ghi/không sửa hàng A; CHECK from<>to, to_at>from_at, kinds", async () => {
    expect(
      rows(await run(B, (tx) => tx.execute(dsql`select id from hub.delegations`))),
    ).toHaveLength(0);
    expect(
      rows(await run(A, (tx) => tx.execute(dsql`select id from hub.delegations`))),
    ).toHaveLength(4); // 1 + 3 từ test on_behalf_of
    expect(
      await code(
        run(B, (tx) =>
          tx.execute(dsql`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
            values (${TA}, ${UB}, ${UA}, now(), now() + interval '1 day', '{approve}', ${UB})`),
        ),
      ),
    ).toBe("42501");
    const upd = await run(B, (tx) =>
      tx.execute(
        dsql`update hub.delegations set revoked_at = now() where tenant_id = ${TA} returning id`,
      ),
    );
    expect(rows(upd)).toHaveLength(0);
    const ins = (from: string, to: string, hours: number, kinds: string) =>
      run(A, (tx) =>
        tx.execute(dsql`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
          values (${TA}, ${from}, ${to}, now(), now() + ${`${hours} hours`}::interval, ${kinds}::text[], ${UA})`),
      );
    expect(await code(ins(UA, UA, 1, "{approve}"))).toBe("23514");
    expect(await code(ins(UA, UA2, -1, "{approve}"))).toBe("23514");
    expect(await code(ins(UA, UA2, 1, "{bogus}"))).toBe("23514");
    expect(await code(ins(UA, UA2, 1, "{}"))).toBe("23514");
  });
  test("CR-127 E1 · review_task_votes: chặn chéo tenant; PK một phiếu mỗi người; không sửa/xoá", async () => {
    const vote = (s: HubScope, t: string, task: string, u: string) =>
      run(s, (tx) =>
        tx.execute(
          dsql`insert into hub.review_task_votes (task_id, tenant_id, user_id, result) values (${task}, ${t}, ${u}, 'pass')`,
        ),
      );
    expect(await code(vote(A, TA, TASK_A, UA))).toBe("ok");
    expect(await code(vote(A, TA, TASK_A, UA))).toBe("23505");
    expect(await code(vote(B, TA, TASK_A, UB))).toBe("42501");
    expect(await code(vote(B, TB, TASK_A, UB))).toBe("23503"); // FK kép (task, tenant): task A không thuộc B
    expect(
      rows(await run(B, (tx) => tx.execute(dsql`select task_id from hub.review_task_votes`))),
    ).toHaveLength(0);
    expect(
      rows(await run(A, (tx) => tx.execute(dsql`select task_id from hub.review_task_votes`))),
    ).toHaveLength(1);
    expect(
      await code(
        run(A, (tx) => tx.execute(dsql`update hub.review_task_votes set result = 'fail'`)),
      ),
    ).toBe("42501");
    expect(await code(run(A, (tx) => tx.execute(dsql`delete from hub.review_task_votes`)))).toBe(
      "42501",
    );
  });
  test("CR-127 E1 · task_signal: ghi cho tenant hiện tại, trùng chưa xử lý ⇒ NULL, B không đọc được, không scope ⇒ 42501", async () => {
    const sig = (s: HubScope, ref: string, result = "done") =>
      run(
        s,
        async (tx) =>
          (
            rows(
              await tx.execute(dsql`select hub.task_signal('milestone', ${ref}, ${result}) as id`),
            )[0] as { id: string | null }
          ).id,
      );
    expect(await sig(A, "ob-1")).not.toBeNull();
    expect(await sig(A, "ob-1")).toBeNull();
    expect(await sig(A, "ob-1", "cancelled")).not.toBeNull();
    expect(await code(sig(A, "ob-1", "bogus"))).toBe("23514");
    expect(await sig(B, "ob-1")).not.toBeNull(); // cùng ref khác tenant = tín hiệu riêng
    expect(
      rows(
        await run(A, (tx) => tx.execute(dsql`select tenant_id from hub.task_signals`)).then(
          (r) => r,
        ),
      ).every((r) => r.tenant_id === TA),
    ).toBe(true);
    expect(
      rows(await run(B, (tx) => tx.execute(dsql`select id from hub.task_signals`))),
    ).toHaveLength(1);
    expect(
      await code(hub.db.execute(dsql`select hub.task_signal('milestone', 'ob-9', 'done')`)),
    ).toBe("42501");
    await owner`update hub.task_signals set processed_at = now() where tenant_id = ${TA} and result = 'done'`;
    expect(await sig(A, "ob-1")).not.toBeNull(); // đã xử lý ⇒ tín hiệu mới được ghi
  });
});

describe("CR-127 E1 · task_holder + CHECK mới (0131, int)", () => {
  const holder = (s: HubScope | null, ref: string) =>
    s
      ? run(s, async (tx) =>
          rows(await tx.execute(dsql`select * from hub.task_holder('milestone', ${ref})`)),
        )
      : hub.db.execute(dsql`select * from hub.task_holder('milestone', ${ref})`).then(rows);
  test("CR-127 E1 · task_holder: người nhận + người được giao (user ∪ thành viên phòng); sai tenant / không scope ⇒ rỗng", async () => {
    const [h] = await holder(A, "ob-1");
    expect(h).toMatchObject({ task_id: TASK_A, claimed_by: UA2 });
    expect([...((h?.assignee_ids ?? []) as string[])].sort()).toEqual([UA, UA2, ix(TA, 13)].sort());
    const [hb] = await holder(B, "ob-1");
    expect(hb?.task_id).toBe(TASK_B); // B chỉ thấy task của B (cùng subject_ref)
    expect(await holder(B, "ob-1-khong-co")).toHaveLength(0);
    expect(await holder(null, "ob-1")).toHaveLength(0);
    await owner`update hub.review_tasks set status = 'closed' where id = ${TASK_A}`;
    expect(await holder(A, "ob-1")).toHaveLength(0); // chỉ task mở
    await owner`update hub.review_tasks set status = 'open' where id = ${TASK_A}`;
  });
  test("CR-127 E1 · CHECK: milestone cần subject_ref; claimed_by ⇔ claimed_at; need; assignee delegated; notice kind; claim_release_h", async () => {
    const ins = (extra: string, vals: string) =>
      code(
        owner.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx.unsafe(
            `insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id, kind${extra})
             values ('${TA}', '${ix(TA, 31)}', gen_random_uuid(), ${vals})`,
          );
        }),
      );
    expect(await ins("", "'milestone'")).toBe("23514"); // thiếu subject_ref
    expect(await ins(", subject_ref", "'milestone', 'x'")).toBe("ok");
    expect(await ins(", subject_ref, claimed_by", `'milestone', 'y', '${UA}'`)).toBe("23514"); // claimed_by mà không claimed_at
    expect(await ins(", reason, need", "'decision', 'timer_invalid', 'bogus'")).toBe("23514");
    expect(await ins(", subject_ref, remind_every_h", "'milestone', 'z', 24")).toBe("ok"); // nhắc lặp áp cho milestone
    expect(
      await code(
        owner.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, on_behalf_of) values (${TA}, ${TASK_A}, ${UA2}, 'delegated', ${UA})`;
          await tx`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, on_behalf_of) values (${TA}, ${TASK_A}, ${ix(TA, 14)}, 'initial', ${UA})`;
        }),
      ),
    ).toBe("23514");
    const notice = (kind: string) =>
      code(
        owner.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id) values (${TA}, ${UA}, ${kind}, ${ix(TA, 31)})`;
        }),
      );
    expect(await notice("task_released")).toBe("ok");
    expect(await notice("milestone_task")).toBe("ok");
    expect(await notice("bogus")).toBe("23514");
    const rel = (n: number, h: number | null) =>
      code(
        h === null
          ? owner`insert into hub.tenant_flow_settings (tenant_id) values (${ix(TB, n)})`
          : owner`insert into hub.tenant_flow_settings (tenant_id, claim_release_h) values (${ix(TB, n)}, ${h})`,
      );
    expect(await rel(70, null)).toBe("ok");
    expect(await rel(71, 168)).toBe("ok");
    expect(await rel(72, 0)).toBe("23514");
    expect(await rel(73, 169)).toBe("23514");
    const [d] =
      await owner`select claim_release_h from hub.tenant_flow_settings where tenant_id = ${ix(TB, 70)}`;
    expect(d?.claim_release_h).toBe(24);
  });
});
