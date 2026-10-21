// niti-import · nhập dữ liệu MỘT tài khoản mgmt-app (chủ HĐ cũ theo email) vào tenant có sẵn, mọi HĐ thuộc user đích tra theo
// username. Nguồn = file export GIẢ (`exportFor` — cùng định dạng mgmt-export.cli) gồm 3 HĐ của chủ (1 có file) + dữ liệu của tài
// khoản demo phải bị loại. Kiểm: user vắng ⇒ lỗi; dry-run không ghi; apply một tx mỗi HĐ, đúng chủ, tiền khớp; vòng nhắc HD4 sau nhập
// KHÔNG gửi thông báo cho hạn đã qua; lượt sau gắn file (FileBox giả, sha256 đọc lại); chạy lại 0 hàng; hoàn tác chỉ xoá lô.
// hub-api THẬT in-process + FileBox GIẢ (FB1 `_fbfake`); acme đóng vai NitiGroup.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { exportFor } from "../../../apps/admin-api/src/modules/mgmt-import/application/owner-export";
import type { OwnerReport } from "../../../apps/admin-api/src/modules/mgmt-import/application/owner-import.usecase";
import type { RollbackReport } from "../../../apps/admin-api/src/modules/mgmt-import/application/owner-rollback.usecase";
import type {
  Snapshot,
  SourceDoc,
} from "../../../apps/admin-api/src/modules/mgmt-import/domain/context";
import { targetId } from "../../../apps/admin-api/src/modules/mgmt-import/domain/ids.rules";
import {
  type OwnerRunConfig,
  runOwner,
} from "../../../apps/admin-api/src/modules/mgmt-import/owner.run";
import { HUB_API_URL, T } from "../H1/_fixtures";
import { ensureRoles, insContract, startHd1 } from "../HD1/_support/hd1";
import { startReminders } from "../HD4/_support/hd4";
import type { CtxN1 } from "../N1/_support/n1";
import { ADMIN_API_URL } from "../N5/_support/n5";

const SOURCE = "niti-owner-test";
const ORG = "0c000000-cccc-4ccc-8ccc-000000000003";
const OLD = "tien@old.test";
const DEMO = "demo@old.test";
const PDF = "%PDF-1.4 niti-import t1";
const TIEN = "0c000000-0000-4000-8000-00000000e1e1";
const CONTROL = "0c000000-0000-4000-8000-0000000c0c0c";
const cid = (m: string) => targetId(SOURCE, "contract", m);

let c: CtxN1;
let adminDb: Db;
let hubDb: Db;
let root = "";
let exportPath = "";
let actor = "";

const d = (id: string, src: Record<string, unknown>): SourceDoc => ({
  id,
  src: { id, org_id: ORG, ...src },
});
const fv = (o: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, { value: v, quote: "", verified: true, edited: false }]),
  );

/** Ảnh chụp mgmt-app giả: 3 HĐ của chủ (t1 có file + hạn đã qua, t2 chưa giao do chủ tạo, t3 phụ lục của t1) + HĐ demo. */
function oldApp(): Snapshot {
  const at = { created_at: "2026-01-02T03:04:05+00:00" };
  return {
    graph: {},
    docs: {
      users: [
        d(OLD, { email: OLD, name: "Lê Thị Thuý Tiên" }),
        d(DEMO, { email: DEMO, name: "Demo" }),
      ],
      contracts: [
        d("t1", {
          ...at,
          kind: "contract",
          owner_email: OLD,
          created_by: OLD,
          title: "Mua hàng Bình An",
          status: "active",
          direction: "purchase",
          fields: fv({
            number: "NITI-01",
            supplier_name: "Bình An",
            supplier_tax_id: "0101010101",
            total_value: 100_000_000,
            start_date: "2025-04-01",
            end_date: "2026-03-31",
          }),
          items: [{ name: "Gạo", unit: "kg", qty: 1000, unit_price: 20_000 }],
          file: { name: "hd-t1.pdf", mime: "application/pdf" },
        }),
        d("t2", {
          ...at,
          kind: "contract",
          owner_email: null,
          created_by: OLD,
          title: "Bán Bếp Việt",
          status: "active",
          direction: "sale",
          fields: fv({
            number: "NITI-02",
            buyer_name: "Bếp Việt",
            total_value: 50_000_000,
            end_date: "2027-12-31",
          }),
        }),
        d("t3", {
          ...at,
          kind: "addendum",
          parent_id: "t1",
          owner_email: DEMO,
          created_by: DEMO,
          title: "Phụ lục giá",
          status: "active",
          fields: fv({ number: "NITI-01/PL1", total_value: 5_000_000 }),
        }),
        d("d1", {
          ...at,
          kind: "contract",
          owner_email: DEMO,
          created_by: DEMO,
          title: "Demo",
          status: "active",
          fields: fv({ total_value: 999 }),
        }),
      ],
      obligations: [
        d("ob1", {
          contract_id: "t1",
          company_id: `${ORG}|tax:0101010101`,
          direction: "pay",
          kind: "payment",
          seq: 1,
          due_date: "2026-02-01",
          amount: 40_000_000,
          status: "open",
        }),
        d("ob9", {
          contract_id: "d1",
          direction: "pay",
          due_date: "2026-02-01",
          amount: 1,
          status: "open",
        }),
      ],
      partner_events: [
        d("101", {
          contract_id: "t1",
          obligation_id: "ob1",
          company_id: `${ORG}|tax:0101010101`,
          role: "supplier",
          type: "paid",
          at: "2026-02-01",
          by: OLD,
          amount: 10_000_000,
        }),
        d("102", {
          company_id: `${ORG}|tax:0202020202`,
          role: "supplier",
          type: "rating",
          at: "2026-02-05",
          by: OLD,
          criterion: "quality",
          value: 5,
        }),
        d("109", {
          company_id: `${ORG}|tax:0303030303`,
          role: "supplier",
          type: "rating",
          at: "2026-02-05",
          by: DEMO,
          value: 1,
        }),
      ],
      companies: [d(`${ORG}|tax:0101010101`, { name: "Công ty Bình An", tax_id: "0101010101" })],
      state: [d(`remind:t1:2026-03-31:7:${OLD}`, { value: { at: "2026-03-24T01:00:00Z" } })],
    },
  };
}

const cfg = (x: { apply: boolean; filebox?: boolean; rollback?: boolean }): OwnerRunConfig => ({
  source: SOURCE,
  actorId: actor,
  apply: x.apply,
  batch: 50,
  knowledgeOrg: null,
  withGraph: false,
  diffSample: 0,
  opensearch: { url: "" },
  neo4j: null,
  filesDir: join(root, "contract_files"),
  sinkDir: null,
  filebox: x.filebox ? { url: c.fb.origin, token: c.fb.token } : null,
  statePath: null,
  tenantKey: "acme",
  ownerEmail: OLD,
  ownerUsername: "tien",
  exportFile: exportPath,
  rollback: x.rollback ?? false,
});
const run = (x: Parameters<typeof cfg>[0]) => runOwner(adminDb, hubDb, cfg(x));
const imp = async (x: Parameters<typeof cfg>[0]) => (await run(x)) as OwnerReport;
const inserted = (r: OwnerReport) =>
  Object.values(r.tables).reduce((s, t) => s + (t?.inserted ?? 0), 0);

beforeAll(async () => {
  c = await startHd1();
  await ensureRoles(c);
  const [a] = await c.sql<
    { id: string }[]
  >`select id from admin.users where role = 'platform_admin' and active order by created_at limit 1`;
  actor = a?.id as string;
  root = await mkdtemp(join(tmpdir(), "niti-own-"));
  await mkdir(join(root, "contract_files", ORG, "t1"), { recursive: true });
  await writeFile(join(root, "contract_files", ORG, "t1", "hd-t1.pdf"), PDF);
  exportPath = join(root, "export.json");
  // export GIẢ như mgmt-export.cli: mang cả HĐ demo vào ảnh chụp rồi lọc theo chủ — importer lọc lại lần nữa
  const f = exportFor(oldApp(), OLD, new Date());
  await writeFile(exportPath, JSON.stringify({ ...f, docs: oldApp().docs }));
  adminDb = createDb(ADMIN_API_URL, { max: 2 });
  hubDb = createDb(HUB_API_URL, { max: 2 });
});
afterAll(async () => {
  await adminDb?.close();
  await hubDb?.close();
  await c?.stop();
});

describe("niti-import · một tài khoản → tenant có sẵn", () => {
  test("user đích (username) chưa có ⇒ OWNER_USER_NOT_FOUND, không ghi gì", async () => {
    await expect(run({ apply: false })).rejects.toThrow("OWNER_USER_NOT_FOUND");
    await c.sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale, active,
        locked_by_tenant, must_change_password)
      values (${TIEN}, ${T.acme}, 'tien', 'tien@niti.example.invalid', 'x', 'Lê Thị Thuý Tiên', 'member', 'vi', true, false, false)`;
  });

  test("dry-run: lọc đúng chủ (3 HĐ, demo bị loại), báo cáo đối soát, không ghi, không tải file", async () => {
    c.fb.reset();
    const r = await imp({ apply: false, filebox: true });
    expect(
      r.contracts.map((x) => [x.number, x.partner, x.value, x.has_file, x.file_found]),
    ).toEqual([
      ["NITI-01", "Bình An", 100_000_000, true, true],
      ["NITI-02", "Bếp Việt", 50_000_000, false, false],
      ["NITI-01/PL1", null, 5_000_000, false, false],
    ]);
    expect(r.counts.contracts).toEqual({ source: 2, planned: 2, target: 0 });
    expect(r.counts.appendices).toEqual({ source: 1, planned: 1, target: 0 });
    expect(r.counts.ratings).toEqual({ source: 1, planned: 1, target: 0 });
    expect(r.excluded).toMatchObject({ contracts: 1, obligations: 1, partner_events: 1 });
    expect(r.money["contracts.total_value"]).toMatchObject({
      source: "155000000",
      planned: "155000000",
      ok: true,
    });
    expect(r.money_ok).toBe(true);
    expect(r.issues_by_code).toEqual({});
    expect(inserted(r)).toBe(0);
    expect(c.fb.callsTo("post")).toHaveLength(0);
  });

  test("apply (chưa có kho file): một tx mỗi HĐ, mọi HĐ thuộc tien, tiền khớp; vòng nhắc sau đó KHÔNG gửi thông báo", async () => {
    const r = await imp({ apply: true });
    expect(r.counts.contracts).toEqual({ source: 2, planned: 2, target: 2 });
    expect(r.counts.obligations).toEqual({ source: 1, planned: 1, target: 1 });
    expect(r.counts.partner_events).toEqual({ source: 2, planned: 2, target: 2 });
    expect(r.money_ok).toBe(true);
    expect(r.files).toMatchObject({ jobs: 1, pending: 1, uploaded: 0 });
    const owners = await c.sql<
      { owner_user_id: string; created_by: string }[]
    >`select owner_user_id, created_by
      from contracts.contracts where tenant_id = ${T.acme} and id in ${c.sql([cid("t1"), cid("t2"), cid("t3")])}`;
    expect(owners.map((x) => [x.owner_user_id, x.created_by])).toEqual(Array(3).fill([TIEN, TIEN]));
    expect((await c.sql`select 1 from contracts.contracts where id = ${cid("d1")}`).length).toBe(0);
    const rem = startReminders({ at: new Date().toISOString() });
    try {
      const t = await rem.r.drain();
      expect(t.failed).toBe(0);
    } finally {
      await rem.stop();
    }
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.notifications where user_id = ${TIEN}`;
    expect(n?.n).toBe(0);
  });

  test("lượt sau --filebox: gắn file vào HĐ đã nhập, sha256 đọc lại khớp; chạy lại: 0 hàng, 0 upload", async () => {
    c.fb.reset();
    const r = await imp({ apply: true, filebox: true });
    expect(r.files).toMatchObject({ uploaded: 1, attached: 1, checksum_ok: 1, checksum_bad: 0 });
    expect(c.fb.callsTo("post").map((x) => [x.org, x.name])).toEqual([
      [`t_${T.acme}`, "hd-t1.pdf"],
    ]);
    expect(inserted(r)).toBe(0);
    expect(r.contracts[0]?.target).toMatchObject({ has_file: true, number: "NITI-01" });
    c.fb.reset();
    const again = await imp({ apply: true, filebox: true });
    expect(inserted(again)).toBe(0);
    expect(c.fb.callsTo("post")).toHaveLength(0);
    expect(again.files.checksum_ok).toBe(1);
    expect(again.counts.contracts?.target).toBe(2);
  });

  test("hoàn tác: dry-run chỉ liệt kê; apply xoá đúng lô (HĐ khác giữ nguyên), sổ được huỷ, file giữ (không HĐ nào trỏ)", async () => {
    await insContract(c.sql, {
      id: CONTROL,
      tenant: T.acme,
      owner: TIEN,
      createdBy: TIEN,
      title: "Ngoài lô",
    });
    const dry = (await run({ apply: false, rollback: true, filebox: true })) as RollbackReport;
    expect(dry.before.contracts).toBe(3);
    expect(dry.deleted_contracts).toBe(0);
    c.fb.reset();
    const r = (await run({ apply: true, rollback: true, filebox: true })) as RollbackReport;
    expect(r.error).toBeNull();
    expect(r.after).toMatchObject({
      contracts: 0,
      items: 0,
      obligations: 0,
      files: 0,
      partner_events: 2,
      partner_events_voided: 2,
    });
    expect(r.files_kept).toHaveLength(1); // app không xoá file (giữ hàng + object, nhập lại dùng lại)
    expect(c.fb.callsTo("delete")).toHaveLength(0);
    expect((await c.sql`select 1 from contracts.contracts where id = ${CONTROL}`).length).toBe(1);
  });
});
