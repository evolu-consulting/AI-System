// CR-140 · cr140-sibling-files · `inheritRunFiles`, DB thật (pool hub_api, scope user): lượt con thứ 2 của CÙNG lượt cha thấy tệp của lượt con thứ 1
// (liên kết, không trùng); lượt ngoài cây của cha và công ty khác thì KHÔNG thấy. Hàng lượt/liên kết dựng bằng owner (FK lượt cha tắt trong tx dựng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { inheritRunFiles } from "./public";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let X = "";
let DEF = "";
let seq = 0;
const FA = "0c140000-0000-4000-8000-0000000000a1"; // tệp của con 1 (báo giá)
const FB = "0c140000-0000-4000-8000-0000000000a2"; // tệp thứ hai của con 1
const FP = "0c140000-0000-4000-8000-0000000000a3"; // tệp của cha, KHÔNG truyền qua input_map
const FO = "0c140000-0000-4000-8000-0000000000b1"; // tệp của lượt ngoài cây (cùng công ty)
const FD = "0c140000-0000-4000-8000-0000000000a4"; // tệp đã xoá nội dung
const FF = "0c140000-0000-4000-8000-0000000000a5"; // tệp của anh em lỗi
const FX = "0c140000-0000-4000-8000-0000000000c1"; // tệp của lượt công ty khác

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 1401)) as [string, string];
  [A] = (await users(o, T1, 1, { from: 1401 })) as [string];
  [X] = (await users(o, T2, 1, { from: 1411 })) as [string];
  const [d] = await o<
    { id: string }[]
  >`select id::text as id from hub.process_defs where tenant_id is null and deleted_at is null limit 1`;
  DEF = d?.id as string;
  for (const [id, t, u] of [
    [FA, T1, A],
    [FB, T1, A],
    [FP, T1, A],
    [FD, T1, A],
    [FF, T1, A],
    [FO, T1, A],
    [FX, T2, X],
  ] as const)
    await o`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${t}, ${u}, 'upload', ${`${id}.pdf`}, ${`${id}.pdf`}, 'application/pdf', 5, ${"c".repeat(64)}, ${`${t}/${id}`})`;
  await o`update hub.attachments set purged_at = now() where id = ${FD}`;
  db = connectDb(urls().hubApi, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

/** Lượt chạy (cha / con); `parent` ⇒ gắn cha (FK tắt trong tx vì không dựng stage cha). */
async function mkRun(
  tenant: string,
  user: string,
  parent: string | null = null,
  status = "running",
): Promise<string> {
  const id = Bun.randomUUIDv7();
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm) values (${tenant}, ${user}, 'c', 'c') returning id::text as id`;
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
        conversation_id, flow_id, expires_at, status, parent_run_id, parent_stage_run_id, parent_attempt, parent_round)
      values (${id}, ${tenant}, ${DEF}, 1, '{}'::jsonb, ${user}, 'admin', ${`r${++seq}`}, ${c?.id as string}, gen_random_uuid(), now() + interval '1 day', ${status},
        ${parent}, ${parent ? Bun.randomUUIDv7() : null}, ${parent ? 1 : null}, ${parent ? 1 : null})`;
  });
  return id;
}
const link = (run: string, att: string, tenant: string, user: string) =>
  o`insert into hub.process_run_files (process_run_id, attachment_id, tenant_id, linked_by, source)
    values (${run}, ${att}, ${tenant}, ${user}, 'form')`;
const filesOf = async (run: string) =>
  (
    await o<
      { attachment_id: string; source: string }[]
    >`select attachment_id, source from hub.process_run_files where process_run_id = ${run} order by attachment_id`
  ).map((r) => `${r.attachment_id}:${r.source}`);
/** Như `launch.ts`: tx scope user của người bắt đầu, lượt con vừa tạo (chưa gắn cha). */
const inherit = (parent: string, child: string, ids: string[] = []) =>
  withHubScope(db, { kind: "user", tenantId: T1, userId: A }, (tx) =>
    inheritRunFiles(tx, { tenantId: T1, parentRunId: parent, childRunId: child, ids }),
  );

describe("CR-140 · lượt con kế thừa tệp của lượt con anh em", () => {
  it("bỏ tệp đã xoá và tệp của anh em lỗi / hết hạn / huỷ; giữ anh em đã xong", async () => {
    const parent = await mkRun(T1, A);
    const done = await mkRun(T1, A, parent, "done");
    const bad = await mkRun(T1, A, parent, "failed");
    await link(done, FA, T1, A);
    await link(done, FD, T1, A);
    await link(bad, FF, T1, A);
    const c = await mkRun(T1, A);
    expect(await inherit(parent, c)).toBe(1);
    expect(await filesOf(c)).toEqual([`${FA}:subprocess`]);
  });

  it("con thứ 2 thấy tệp của con thứ 1 (cùng cha), không trùng; tệp cha không truyền thì không", async () => {
    const parent = await mkRun(T1, A);
    const c1 = await mkRun(T1, A, parent);
    await link(parent, FP, T1, A);
    await link(c1, FA, T1, A);
    await link(c1, FB, T1, A);
    const c2 = await mkRun(T1, A);
    expect(await inherit(parent, c2)).toBe(2);
    expect(await filesOf(c2)).toEqual([`${FA}:subprocess`, `${FB}:subprocess`]);
    // con 3: cũng thấy tệp con 1; tệp cha chỉ khi truyền qua input_map; chạy lại không nhân đôi.
    const c3 = await mkRun(T1, A);
    expect(await inherit(parent, c3, [FP])).toBe(3);
    expect(await inherit(parent, c3, [FP])).toBe(0);
    expect((await filesOf(c3)).length).toBe(3);
  });

  it("chặn: lượt ngoài cây của cha và lượt công ty khác không lộ tệp", async () => {
    const parent = await mkRun(T1, A);
    const other = await mkRun(T1, A); // cha khác
    const otherKid = await mkRun(T1, A, other);
    await link(otherKid, FO, T1, A);
    await link(other, FO, T1, A);
    const alien = await mkRun(T2, X, parent); // tenant khác nhưng trỏ cha này (dữ liệu hỏng) — vẫn không được thấy
    await link(alien, FX, T2, X);
    const c = await mkRun(T1, A);
    expect(await inherit(parent, c, [FO, FX])).toBe(0);
    expect(await filesOf(c)).toEqual([]);
  });
});
