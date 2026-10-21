// niti-import2 · `--include-extras`: phần còn lại của MỘT tài khoản mgmt-app (chat + file chat, văn bản ký + chứng thư CKS, thông báo,
// báo giá, quét giá, lịch sử chấm điểm) vào tenant có sẵn, nhãn lô riêng. Nguồn = file export GIẢ (`exportFor`) có bản ghi ở org
// khác (demo) + bản ghi "[E2E]" + góp ý (không nhập). Kiểm: ánh xạ từng loại, đính kèm qua FileBox GIẢ (sha256 đọc lại), thông báo
// đã đọc + KHÔNG phát (vòng fanout thật chạy sau ⇒ 0 giao nhận), my-chat-history tìm được chữ của chat cũ, hội thoại lưu trữ không
// nhận run, chạy lại 0 hàng/0 upload, hoàn tác CHỈ lô (hàng ngoài lô + lô chính giữ nguyên).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type {
  ExtrasReport,
  ExtrasRollbackReport,
} from "../../../apps/admin-api/src/modules/mgmt-import/application/extras.usecase";
import { exportFor } from "../../../apps/admin-api/src/modules/mgmt-import/application/owner-export";
import type {
  Snapshot,
  SourceDoc,
} from "../../../apps/admin-api/src/modules/mgmt-import/domain/context";
import { targetId } from "../../../apps/admin-api/src/modules/mgmt-import/domain/ids.rules";
import {
  type ExtrasRunConfig,
  runExtras,
  runOwner,
} from "../../../apps/admin-api/src/modules/mgmt-import/owner.run";
import { searchChat } from "../../../apps/hub-api/src/modules/my-history/my-history.repo";
import { keywords, tsQueryOf } from "../../../apps/hub-api/src/modules/my-history/my-history.rules";
import { dispatchRepo } from "../../../apps/hub-api/src/modules/notify/adapters/dispatch.repo";
import { touchConversation } from "../../../apps/hub-api/src/modules/runs/runs.repo";
import { HUB_API_URL, T } from "../H1/_fixtures";
import { ensureRoles, startHd1 } from "../HD1/_support/hd1";
import type { CtxN1 } from "../N1/_support/n1";
import { ADMIN_API_URL } from "../N5/_support/n5";

const MAIN = "niti-x-main";
const EXTRAS = "niti-x-extras";
const ORG = "0c000000-cccc-4ccc-8ccc-0000000000e1";
const DEMO_ORG = "0c000000-cccc-4ccc-8ccc-0000000000e2";
const OLD = "tien.x@old.test";
const TIEN = "0c000000-0000-4000-8000-00000000e2e2";
const BV = `${ORG}|tax:0909090909`;
const SHA = "a".repeat(64);
const PDF = "%PDF-1.4 bao gia gao";
const TXT = "ghi chu cu";
const HUB_ORG = "ai-system";
const recent = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let c: CtxN1;
let adminDb: Db;
let hubDb: Db;
let root = "";
let exportPath = "";
let actor = "";

const d = (id: string, src: Record<string, unknown>, org: string | null = ORG): SourceDoc => ({
  id,
  src: { id, org_id: org, ...src },
});

function oldApp(): Snapshot {
  const at = recent(40);
  return {
    graph: {},
    docs: {
      contracts: [
        d("x1", {
          created_at: at,
          kind: "contract",
          owner_email: OLD,
          created_by: OLD,
          title: "Bán CKS Bếp Việt",
          status: "active",
          direction: "sale",
          fields: {
            number: { value: "X-01" },
            buyer_name: { value: "Bếp Việt" },
            total_value: { value: 3_000_000 },
          },
        }),
      ],
      companies: [d(BV, { name: "Công ty Bếp Việt", tax_id: "0909090909" })],
      chats: [
        d("ch1", {
          user_email: OLD,
          title: "Giá gạo",
          created_at: recent(30),
          messages: [
            {
              role: "user",
              content: "Giá gạo của Bình An tháng này?",
              at: recent(30),
              files: ["bao-gia.pdf"],
            },
            { role: "assistant", content: "Khoảng 20.000 đồng/kg theo báo giá." },
            { role: "assistant", content: "", cards: [] },
          ],
        }),
        d(
          "ch-demo",
          { user_email: OLD, title: "Demo", messages: [{ role: "user", content: "x" }] },
          DEMO_ORG,
        ),
        d("ch-e2e", {
          user_email: OLD,
          title: "[E2E] chạy thử",
          messages: [{ role: "user", content: "y" }],
        }),
      ],
      chat_files: [
        d("cf1", {
          by: OLD,
          name: "bao-gia.pdf",
          mime: "application/pdf",
          size: PDF.length,
          created_at: recent(30),
        }),
        d("cf2", {
          by: OLD,
          name: "ghi-chu.txt",
          mime: "text/plain",
          size: TXT.length,
          created_at: recent(20),
        }),
      ],
      cks_certificates: [
        d("k1", {
          created_by: OLD,
          company_id: BV,
          serial: "54010B72AA",
          ca: "vnpt",
          holder_name: "Bếp Việt",
          valid_to: "2027-10-01",
          sale_contract_id: "x1",
          sale_price: 1_500_000,
          lot_id: "lot-x",
        }),
      ],
      signed_docs: [
        d("s1", {
          by: OLD,
          company_id: BV,
          certificate_id: "k1",
          serial: "54010B72AA",
          kind: "invoice",
          title: "HĐ 77",
          signed_at: "2026-09-01",
          filename: "hd-77.xml",
          source: "xml",
          sha256: SHA,
        }),
      ],
      notifications: [
        {
          id: "n1",
          src: {
            id: "n1",
            user_email: OLD,
            contract_id: "x1",
            title: "Sắp hết hạn",
            body: "HĐ X-01",
            created_at: recent(10),
          },
        },
      ],
      quotes: [
        d("q1", {
          by: OLD,
          product: `${ORG}|name:gao|`,
          product_name: "Gạo",
          unit: "kg",
          supplier_name: "Bình An",
          price: 20_000,
          quoted_at: "2026-09-15",
        }),
      ],
      market_scans: [d("ms1", { by: OLD, ca: "vnpt", years: 1, state: "done", n_found: 1 })],
      market_observations: [
        d("mo1", {
          product_kind: "cks",
          scan_id: "ms1",
          ca: "vnpt",
          years: 1,
          seller: "VNPT",
          price_ex_vat: 1_400_000,
          seen: "2026-09-20",
        }),
      ],
      score_config_history: [
        d("h1", {
          by: OLD,
          role: "supplier",
          version: 2,
          summary: "đổi trọng số",
          before: {},
          after: {},
        }),
      ],
      feedback: [d("fb1", { by: OLD, kind: "lỗi", description: "test" })],
    },
  };
}

const cfg = (x: { apply: boolean; rollback?: boolean; source?: string }): ExtrasRunConfig => ({
  source: x.source ?? EXTRAS,
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
  filebox: { url: c.fb.origin, token: c.fb.token },
  statePath: null,
  tenantKey: "acme",
  ownerEmail: OLD,
  ownerUsername: "tienx",
  exportFile: exportPath,
  rollback: x.rollback ?? false,
  linkSource: MAIN,
  extrasOrg: ORG,
  dataDir: root,
  hubFileOrg: HUB_ORG,
});
const imp = async (apply: boolean) =>
  (await runExtras(adminDb, hubDb, cfg({ apply }))) as ExtrasReport;
const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? -1;

beforeAll(async () => {
  c = await startHd1();
  await ensureRoles(c);
  const [a] = await c.sql<
    { id: string }[]
  >`select id from admin.users where role = 'platform_admin' and active order by created_at limit 1`;
  actor = a?.id as string;
  await c.sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale, active,
      locked_by_tenant, must_change_password)
    values (${TIEN}, ${T.acme}, 'tienx', 'tienx@niti.example.invalid', 'x', 'Tiên', 'member', 'vi', true, false, false)
    on conflict do nothing`;
  root = await mkdtemp(join(tmpdir(), "niti-x-"));
  for (const [id, name, body] of [
    ["cf1", "bao-gia.pdf", PDF],
    ["cf2", "ghi-chu.txt", TXT],
  ] as const) {
    await mkdir(join(root, "chat_files", ORG, id), { recursive: true });
    await writeFile(join(root, "chat_files", ORG, id, name), body);
  }
  exportPath = join(root, "export.json");
  await writeFile(exportPath, JSON.stringify(exportFor(oldApp(), OLD, new Date())));
  adminDb = createDb(ADMIN_API_URL, { max: 2 });
  hubDb = createDb(HUB_API_URL, { max: 2 });
  // lô chính (HĐ x1) để chứng thư CKS nối HĐ bán
  await runOwner(adminDb, hubDb, { ...cfg({ apply: true, source: MAIN }), filebox: null });
});
afterAll(async () => {
  await adminDb?.close();
  await hubDb?.close();
  await c?.stop();
});

describe("niti-import2 · phần còn lại của tài khoản (--include-extras)", () => {
  test("export: gồm phần còn lại; not_imported chỉ còn góp ý", async () => {
    const f = exportFor(oldApp(), OLD, new Date());
    expect(f.not_imported).toEqual({ feedback: 1 });
    expect(f.docs.chats?.map((x) => x.id)).toEqual(["ch1", "ch-demo", "ch-e2e"]);
    expect(f.docs.market_observations?.map((x) => x.id)).toEqual(["mo1"]);
    expect(f.docs.notifications?.[0]?.src._contract_org).toBe(ORG);
  });

  test("dry-run: chỉ org của chủ, bỏ [E2E], không ghi, không tải file", async () => {
    c.fb.reset();
    const r = await imp(false);
    expect(r.counts.chats).toEqual({
      source_all: 3,
      excluded_other_org: 1,
      excluded_e2e: 1,
      source: 1,
      planned: 1,
      target: 0,
    });
    expect(r.counts.conversations?.planned).toBe(2); // chat + hội thoại gom file không lượt nào nhắc
    expect(r.counts.messages?.planned).toBe(3);
    expect(r.counts.chat_files).toMatchObject({ source: 2, planned: 2, target: 0 });
    for (const k of [
      "signed_docs",
      "cks_certificates",
      "notifications",
      "quotes",
      "market_scans",
      "market_prices",
      "score_config_history",
    ])
      expect([k, r.counts[k]?.planned, r.counts[k]?.target]).toEqual([k, 1, 0]);
    expect(r.files).toMatchObject({ jobs: 2, found: 2, pending: 2, uploaded: 0 });
    expect(r.issues_by_code).toEqual({});
    expect(r.notes).toMatchObject({ cert_lot_not_imported: 1, messages_skipped_empty: 1 });
    expect(c.fb.callsTo("post")).toHaveLength(0);
    expect(
      await n(c.sql`select count(*)::int as n from hub.conversations where user_id = ${TIEN}`),
    ).toBe(0);
  });

  test("apply: mỗi loại về đúng bảng, file qua FileBox (sha256 khớp), thông báo đã đọc + không phát", async () => {
    c.fb.reset();
    const r = await imp(true);
    for (const [k, v] of Object.entries(r.counts)) expect([k, v.target]).toEqual([k, v.planned]);
    expect(r.files).toMatchObject({ uploaded: 2, checksum_ok: 2, checksum_bad: 0 });
    expect(c.fb.callsTo("post").map((x) => x.org)).toEqual([HUB_ORG, HUB_ORG]);
    expect(r.issues_by_code).toEqual({});
    const conv = targetId(EXTRAS, "conv", "ch1");
    const [v] = await c.sql<
      { archived: boolean; src: string; flows: number }[]
    >`select archived_at is not null as archived,
      import_source as src, (select count(*)::int from hub.flows f where f.conversation_id = v.id) as flows
      from hub.conversations v where v.id = ${conv}`;
    expect(v).toEqual({ archived: true, src: EXTRAS, flows: 1 });
    const att = await c.sql<
      { filename: string; message_id: string | null }[]
    >`select filename, message_id from hub.attachments
      where user_id = ${TIEN} order by filename`;
    expect(att.map((x) => [x.filename, x.message_id !== null])).toEqual([
      ["bao-gia.pdf", true],
      ["ghi-chu.txt", true],
    ]);
    const [cert] = await c.sql<
      { sale: string; cust: string }[]
    >`select k.sale_contract_id as sale, u.name as cust
      from contracts.cks_certificates k join contracts.cks_customers u on u.id = k.customer_id where k.id = ${targetId(EXTRAS, "cert", "k1")}`;
    expect(cert).toEqual({ sale: targetId(MAIN, "contract", "x1"), cust: "Công ty Bếp Việt" });
    const [sd] = await c.sql<
      { cert: string }[]
    >`select certificate_id as cert from contracts.cks_signed_docs where id = ${targetId(EXTRAS, "signed", "s1")}`;
    expect(sd?.cert).toBe(targetId(EXTRAS, "cert", "k1"));
    const [q] = await c.sql<
      { product_key: string; source: string; party: string }[]
    >`select product_key, source,
      supplier_party_key as party from contracts.price_quotes where id = ${targetId(EXTRAS, "quote", "q1")}`;
    expect(q).toMatchObject({ product_key: "name:gao|", source: "quote" });
    expect(
      await n(c.sql`select count(*)::int as n from contracts.legacy_records where tenant_id = ${T.acme}
      and kind in ('market_scans', 'score_config_history')`),
    ).toBe(2);
    // thông báo: đã đọc, đã "phát" sẵn ⇒ vòng fanout THẬT chạy sau đó không tạo giao nhận email/push
    await dispatchRepo(hubDb).fanout(new Date().toISOString(), 500);
    const [nt] = await c.sql<
      { read: boolean; fanned: boolean; created: string }[]
    >`select read_at is not null as read,
      fanout_at is not null as fanned, created_at::text as created from hub.notifications where user_id = ${TIEN}`;
    expect(nt).toMatchObject({ read: true, fanned: true });
    expect(
      await n(
        c.sql`select count(*)::int as n from hub.notification_deliveries where user_id = ${TIEN}`,
      ),
    ).toBe(0);
    expect(r.deliveries).toBe(0);
  });

  test("my-chat-history tìm được chữ của chat cũ; hội thoại lưu trữ không nhận run mới", async () => {
    const who = { tenantId: T.acme, userId: TIEN };
    const hits = await withHubScope(hubDb, { kind: "user", ...who }, (tx) =>
      searchChat(tx, who, {
        from: null,
        to: null,
        tz: "Asia/Ho_Chi_Minh",
        months: 12,
        tsq: tsQueryOf(keywords("Bình An")),
        roles: ["user", "assistant"],
        excludeRun: null,
        limit: 5,
      }),
    );
    expect(hits.map((h) => [h.conversation_id, h.title])).toContainEqual([
      targetId(EXTRAS, "conv", "ch1"),
      "Giá gạo",
    ]);
    const ok = await withHubScope(hubDb, { kind: "user", ...who }, (tx) =>
      touchConversation(tx, who, targetId(EXTRAS, "conv", "ch1")),
    );
    expect(ok).toBe(false);
  });

  test("chạy lại: 0 hàng mới, 0 upload, đích không đổi", async () => {
    c.fb.reset();
    const r = await imp(true);
    expect(c.fb.callsTo("post")).toHaveLength(0);
    expect(r.files).toMatchObject({ uploaded: 0, existing: 2, checksum_ok: 2 });
    for (const [k, v] of Object.entries(r.counts)) expect([k, v.target]).toEqual([k, v.planned]);
    expect(
      await n(c.sql`select count(*)::int as n from hub.messages where user_id = ${TIEN}`),
    ).toBe(3);
  });

  test("hoàn tác: chỉ lô extras (báo giá ngoài lô + HĐ lô chính giữ nguyên), file FileBox giữ", async () => {
    await c.sql`insert into contracts.price_quotes (tenant_id, product_key, product_name, supplier_name, supplier_party_key,
      price, quoted_at) values (${T.acme}, 'name:gao|', 'Gạo', 'Ngoài lô', 'name:ngoai lo', 1, '2026-09-01')`;
    const dry = (await runExtras(
      adminDb,
      hubDb,
      cfg({ apply: false, rollback: true }),
    )) as ExtrasRollbackReport;
    expect(dry.before.conversation_ids).toHaveLength(2);
    expect(dry.deleted).toEqual({});
    c.fb.reset();
    const r = (await runExtras(
      adminDb,
      hubDb,
      cfg({ apply: true, rollback: true }),
    )) as ExtrasRollbackReport;
    expect(r.error).toBeNull();
    expect(r.deleted).toMatchObject({
      conversations: 2,
      attachments: 2,
      notifications: 1,
      cks_signed_docs: 1,
      cks_certificates: 1,
      cks_customers: 1,
      price_quotes: 1,
      cks_market_prices: 1,
      legacy_records: 2,
    });
    expect(r.after).toMatchObject({
      conversation_ids: [],
      messages: 0,
      attachments: [],
      notifications: 0,
      contracts: {},
    });
    expect(c.fb.callsTo("delete")).toHaveLength(0);
    expect(
      await n(
        c.sql`select count(*)::int as n from contracts.price_quotes where supplier_name = 'Ngoài lô'`,
      ),
    ).toBe(1);
    expect(
      await n(
        c.sql`select count(*)::int as n from contracts.contracts where id = ${targetId(MAIN, "contract", "x1")}`,
      ),
    ).toBe(1);
  });
});
