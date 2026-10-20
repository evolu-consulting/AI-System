// niti-attach · lượt 1 nhập KHÔNG kho file (sohoptac2 chưa có FileBox) ⇒ HĐ chưa có file, báo `files.pending`; lượt sau `--filebox`
// gắn file vào ĐÚNG HĐ đã nhập (id tất định), tải lên chỉ HĐ còn `file_id` null, hàng file + `file_id` cùng một câu; mở được qua API
// thường (`GET /pack/contracts/contracts/:id/file` ⇒ 302 ⇒ đúng bytes); đối soát sha256 đọc lại; chạy lại lần nữa 0 upload, 0 gắn.
// hub-api THẬT in-process + FileBox GIẢ (FB1 `_fbfake`); acme đóng vai NitiGroup (gắn org A của nguồn giả).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { targetId } from "../../../apps/admin-api/src/modules/mgmt-import/domain/ids.rules";
import {
  type RunConfig,
  runMgmtImport,
} from "../../../apps/admin-api/src/modules/mgmt-import/mgmt-import.run";
import { HUB_API_URL, T } from "../H1/_fixtures";
import { CBASE, ensureRoles, P, startHd1 } from "../HD1/_support/hd1";
import { fakeReader, fixtureSnapshot, ORG_A, SOURCE } from "../I1/_support/fixture";
import type { CtxN1 } from "../N1/_support/n1";
import { ADMIN_API_URL } from "../N5/_support/n5";

const PDF = "%PDF-1.4 niti-attach";
const C2 = () => targetId(SOURCE, "contract", "c2");
let c: CtxN1;
let adminDb: Db;
let hubDb: Db;
let filesDir = "";
let actor = "";

const cfg = (withFilebox: boolean): RunConfig => ({
  source: SOURCE,
  actorId: actor,
  apply: true,
  batch: 50,
  knowledgeOrg: ORG_A,
  withGraph: false,
  diffSample: 5,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir,
  sinkDir: null,
  filebox: withFilebox ? { url: c.fb.origin, token: c.fb.token } : null,
  statePath: null,
  intoTenant: "acme",
});
const run = (withFilebox: boolean) =>
  runMgmtImport(adminDb, hubDb, cfg(withFilebox), fakeReader(fixtureSnapshot()));
const withoutFile = async () =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts
      where tenant_id = ${T.acme} and id = ${C2()} and file_id is null`
  )[0]?.n;

beforeAll(async () => {
  c = await startHd1();
  await ensureRoles(c);
  const [a] = await c.sql<{ id: string }[]>`select id from admin.users
    where role = 'platform_admin' and active order by created_at limit 1`;
  actor = a?.id as string;
  await c.sql`update admin.tenants set settings = settings
    || ${c.sql.json({ mgmt_source: SOURCE, mgmt_org_id: ORG_A })} where id = ${T.acme}`;
  const root = await mkdtemp(join(tmpdir(), "niti-at-"));
  filesDir = join(root, "contract_files");
  await mkdir(join(filesDir, ORG_A, "c2"), { recursive: true });
  await writeFile(join(filesDir, ORG_A, "c2", "hd.pdf"), PDF);
  adminDb = createDb(ADMIN_API_URL, { max: 2 });
  hubDb = createDb(HUB_API_URL, { max: 2 });
});
afterAll(async () => {
  await adminDb?.close();
  await hubDb?.close();
  await c?.stop();
});

describe("niti-attach · nhập không file rồi gắn file sau", () => {
  test("lượt 1 không kho file: HĐ nhập đủ, chưa file, pending = 1; FileBox không bị gọi", async () => {
    c.fb.reset();
    const r = await run(false);
    expect(r.files).toEqual({ jobs: 1, has_file: 0, uploaded: 0, attached: 0, pending: 1 });
    expect(r.reconcile?.money_ok).toBe(true);
    expect(await withoutFile()).toBe(1);
    expect(c.fb.callsTo("post")).toHaveLength(0);
  });

  test("lượt 2 --filebox: tải lên + gắn đúng HĐ đã nhập, mở được qua API, sha khớp, không hàng nào khác đổi", async () => {
    c.fb.reset();
    const r = await run(true);
    expect(r.files).toEqual({ jobs: 1, has_file: 0, uploaded: 1, attached: 1, pending: 0 });
    expect(c.fb.callsTo("post").map((x) => [x.org, x.name])).toEqual([[`t_${T.acme}`, "hd.pdf"]]);
    expect(Object.values(r.tables).reduce((s, t) => s + (t?.inserted ?? 0), 0)).toBe(0);
    expect(r.reconcile?.files).toEqual({ jobs: 1, found: 1, stored: 1, checksum_ok: 1 });
    expect(await withoutFile()).toBe(0);
    const res = await fetch(`${c.hub.base}${CBASE}/${C2()}/file`, {
      headers: { authorization: `Bearer ${await c.tok(P.lan)}` },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(await (await fetch(new URL(loc, c.fb.origin))).text()).toBe(PDF);
  });

  test("lượt 3 --filebox: 0 upload, 0 gắn (idempotent; HĐ đã có file ⇒ bỏ qua)", async () => {
    c.fb.reset();
    const r = await run(true);
    expect(r.files).toEqual({ jobs: 1, has_file: 1, uploaded: 0, attached: 0, pending: 0 });
    expect(c.fb.callsTo("post")).toHaveLength(0);
    expect(r.reconcile?.files.checksum_ok).toBe(1);
  });
});
