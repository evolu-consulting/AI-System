// niti-filebox · importer I1 `--filebox`: file HĐ của mgmt-app vào FileBox với org `t_<tenant>` (đúng org upload của app), hàng
// `contracts.files` trỏ file đó ⇒ mở qua API thường của app (`GET /pack/contracts/contracts/:id/file` ⇒ 302 `/d/…` ⇒ đúng bytes
// nguồn); đối soát sha256 đọc lại từ FileBox; chạy lại không upload lần nữa. hub-api THẬT in-process + FileBox GIẢ (FB1 `_fbfake`).
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

const PDF = "%PDF-1.4 niti-filebox";
let c: CtxN1;
let adminDb: Db;
let hubDb: Db;
let filesDir = "";
let actor = "";

const cfg = (apply: boolean): RunConfig => ({
  source: SOURCE,
  actorId: actor,
  apply,
  batch: 50,
  knowledgeOrg: ORG_A,
  withGraph: false,
  diffSample: 5,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir,
  sinkDir: null,
  filebox: { url: c.fb.origin, token: c.fb.token },
  statePath: null,
  intoTenant: "acme",
});
const run = (apply: boolean) =>
  runMgmtImport(adminDb, hubDb, cfg(apply), fakeReader(fixtureSnapshot()));

beforeAll(async () => {
  c = await startHd1();
  await ensureRoles(c); // acme: lan = contracts-owner (thấy mọi HĐ)
  const [a] = await c.sql<{ id: string }[]>`select id from admin.users
    where role = 'platform_admin' and active order by created_at limit 1`;
  actor = a?.id as string;
  // acme đóng vai NitiGroup: gắn org A của nguồn giả (như onboarding `import.org_id`)
  await c.sql`update admin.tenants set settings = settings
    || ${c.sql.json({ mgmt_source: SOURCE, mgmt_org_id: ORG_A })} where id = ${T.acme}`;
  const root = await mkdtemp(join(tmpdir(), "niti-fb-"));
  filesDir = join(root, "contract_files");
  await mkdir(join(filesDir, ORG_A, "c2"), { recursive: true });
  await writeFile(join(filesDir, ORG_A, "c2", "hd-goc.pdf"), PDF);
  adminDb = createDb(ADMIN_API_URL, { max: 2 });
  hubDb = createDb(HUB_API_URL, { max: 2 });
});
afterAll(async () => {
  await adminDb?.close();
  await hubDb?.close();
  await c?.stop();
});

describe("niti-filebox · importer --filebox", () => {
  test("dry-run không upload; apply: 1 file vào FileBox org t_<acme>, mở được qua API thường, sha khớp; chạy lại 0 upload", async () => {
    c.fb.reset();
    const dry = await run(false);
    expect(dry.into?.tenant_id).toBe(T.acme);
    expect(c.fb.callsTo("post")).toHaveLength(0);

    const r = await run(true);
    const posts = c.fb.callsTo("post");
    expect(posts.map((x) => [x.org, x.name, x.auth, x.status])).toEqual([
      [`t_${T.acme}`, "hd-goc.pdf", "ok", 201],
    ]);
    expect(r.reconcile?.files).toEqual({ jobs: 1, found: 1, stored: 1, checksum_ok: 1 });
    expect(r.reconcile?.money_ok).toBe(true);

    const [row] = await c.sql<{ org: string; file_id: string; name: string }[]>`
      select f.org, f.file_id, f.name from contracts.contracts k join contracts.files f on f.id = k.file_id
      where k.id = ${targetId(SOURCE, "contract", "c2")}`;
    expect(row).toMatchObject({ org: `t_${T.acme}`, name: "hd-goc.pdf" });

    // mở như người dùng app: 302 tới link FileBox ⇒ đúng bytes nguồn
    const res = await fetch(`${c.hub.base}${CBASE}/${targetId(SOURCE, "contract", "c2")}/file`, {
      headers: { authorization: `Bearer ${await c.tok(P.lan)}` },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(new URL(loc, c.fb.origin).origin).toBe(new URL(c.fb.origin).origin);
    expect(await (await fetch(new URL(loc, c.fb.origin))).text()).toBe(PDF);

    c.fb.reset();
    const again = await run(true);
    expect(c.fb.callsTo("post")).toHaveLength(0);
    expect(again.reconcile?.files.checksum_ok).toBe(1);
    expect(Object.values(again.tables).reduce((s, t) => s + (t?.inserted ?? 0), 0)).toBe(0);
  });
});
