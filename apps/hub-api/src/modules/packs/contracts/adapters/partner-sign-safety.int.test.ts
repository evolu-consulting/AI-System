// CR-182 · soát cuối #1 + #7 (DB thật, role gói `contracts_rw`): (1) tắt thông báo ở prod ⇒ log không có link/token, người tải lên «Sao chép link» (gửi lại)
// lấy được link gốc dùng được; (2) Bên A chưa ký đủ ⇒ Lưu 409 NGAY (không in PDF, không ghi tệp). Khuôn harness: partner-sign.int.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackSystemUow, PackUow } from "../../kit/public";
import type { PartnerSignRepos } from "../application/partner-sign.deps";
import { type PartnerSignFail, partnerSignUsecases } from "../application/partner-sign.usecase";
import { noDigitalSigner, produceSigned } from "../domain/digital-signer";
import { hashLinkToken } from "../domain/partner-sign.rules";
import { contractFilesRepo } from "./contract-files.repo";
import { partnerSignRepo } from "./partner-sign.repo";
import { signDocRepo } from "./sign-doc.repo";
import { signDocsRepo } from "./sign-docs.repo";
import { signFieldsRepo } from "./sign-fields.repo";
import { sha256Hex, stampPdf } from "./sign-stamp.pdf";
import { signVersionsRepo } from "./sign-versions.repo";

const NIL = "00000000-0000-0000-0000-000000000000";
const RUN = "7a1d0000-0000-4000-8000-0000000000bb";
const TOKEN_RE = /\/ky\/([A-Za-z0-9_-]{43})$/;
let o: Sql;
let db: Db;
let T = "";
let U1 = "";
let U2 = "";
let logLink = false;
let aDone = true;
let pdfBytes = new Uint8Array();
let produced = 0;
let puts = 0;
const logs: unknown[] = [];

const part = { page: 1, x: 40, y: 40, w: 120, h: 50, cx: 40, cy: 40, cw: 120, ch: 50 };
const png = (): Uint8Array => {
  const c = createCanvas(120, 50);
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(10, 10, 80, 20);
  return c.toBuffer("image/png");
};
const uc = () =>
  partnerSignUsecases({
    uow: createPackUow(db, "contracts", (tx, t) => ({
      contractFiles: contractFilesRepo(tx, t),
      signDoc: signDocRepo(tx, t),
      docs: signDocsRepo(tx, t),
      fields: signFieldsRepo(tx, t),
      versions: signVersionsRepo(tx, t),
      partnerSign: partnerSignRepo(tx, t),
    })) as never as PackUow<PartnerSignRepos> & PackSystemUow<PartnerSignRepos>,
    lookup: (fn) =>
      withPackScope(db, { packKey: "contracts", tenantId: NIL, userId: null }, (tx) =>
        fn(partnerSignRepo(tx, NIL)),
      ),
    files: {
      read: async () => pdfBytes,
      put: async () => {
        puts++;
        return { fileId: `out-${puts}`, versionId: "v1" };
      },
      remove: async () => undefined,
    },
    maxBytes: 50_000_000,
    produce: async (i) => {
      produced++;
      return produceSigned({ ...i, signer: noDigitalSigner, stamp: stampPdf, sha256: sha256Hex });
    },
    mailer: () => null, // HUB_NOTIFY_MODE=off
    baseUrl: () => "https://app.test",
    logLink: () => logLink,
    counts: async () => ({ a_done: aDone, b_total: 1, b_open: 1, run_id: RUN }),
    complete: async () => undefined,
    log: { info: (m, f) => void logs.push({ m, f }), warn: (m, f) => void logs.push({ m, f }) },
    newId: () => Bun.randomUUIDv7(),
    now: () => new Date(),
    orgOf: (t) => `t_${t}`,
  });

/** HĐ + liên hệ đối tác có email + một tệp cần ký có ô Bên B. */
async function fixture() {
  const tax = String(Math.floor(1e9 + Math.random() * 9e9));
  const pn = `Công ty Đối Tác ${Bun.randomUUIDv7()}`;
  const [f] = await o<{ id: string }[]>`insert into contracts.files ${o({
    tenant_id: T,
    org: `t_${T}`,
    file_id: `fb-${Bun.randomUUIDv7()}`,
    name: "hd.pdf",
    mime: "application/pdf",
    size_bytes: 1,
    created_by: U1,
  } as never)} returning id`;
  const fileId = (f as { id: string }).id;
  const [c] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ soát cuối",
    created_by: U1,
    status: "draft",
    direction: "purchase",
    fields: o.json({ supplier_name: { value: pn }, supplier_tax_id: { value: tax } }) as never,
    file_id: fileId,
  } as never)} returning id`;
  const id = (c as { id: string }).id;
  const email = `lan-${id.slice(0, 6)}@doitac.vn`;
  await o`insert into contracts.partner_contacts (tenant_id, party_key, name, email, created_by)
    values (${T}, contracts.party_key(${pn}, ${tax}), 'Chị Lan', ${email}, ${U1})`;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by) values (${T}, ${id}, ${fileId}, true, 3, ${U1})`;
  const [b] = await o<{ id: string }[]>`insert into contracts.sign_fields ${o({
    tenant_id: T,
    contract_id: id,
    file_id: fileId,
    side: "B",
    signer_kind: "partner",
    signer_ref: email,
    parts: o.json([part]) as never,
    created_by: U1,
  } as never)} returning id`;
  return { id, email, fileId, bField: (b as { id: string }).id };
}

beforeAll(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]);
  pdfBytes = Uint8Array.from(await doc.save());
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9841)) as [string];
  [U1, U2] = (await users(o, T, 2, { from: 9841 })) as [string, string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-182 · soát cuối · link ký của đối tác", () => {
  it("soát #1 · tắt thông báo ở prod: log KHÔNG có link/token, chỉ link_id, «Sao chép link» (gửi lại) trả link gốc dùng được cho người tải lên", async () => {
    const f = await fixture();
    logs.length = 0;
    expect(await uc().ensureLink(T, f.id, { by: U1, force: false })).toBe("created");
    const s = JSON.stringify(logs);
    expect(s).not.toContain("/ky/");
    expect(s).not.toContain(f.email);
    const [l] = await o<
      { id: string }[]
    >`select id from contracts.partner_sign_links where contract_id = ${f.id}`;
    expect(s).toContain((l as { id: string }).id);
    // Người tải lên bấm «Sao chép link»: link mới (cũ bị thu hồi), trả link gốc — dùng được, không vào log.
    const r = await uc().resend({ tenantId: T, userId: U1 }, f.id, false);
    expect(r.sent).toBe(false);
    const token = TOKEN_RE.exec(r.url ?? "")?.[1] as string;
    expect(token).toHaveLength(43);
    expect((await uc().view(await hashLinkToken(token), { audit: false })).ok).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(token);
    // Người khác (không phải người tải lên / quản trị) không lấy được link.
    const e = await uc()
      .resend({ tenantId: T, userId: U2 }, f.id, false)
      .catch((x: unknown) => x);
    expect((e as PartnerSignFail).kind).toBe("forbidden");
  });

  it("soát #1 · bản dev/test: vẫn ghi link ra log để kiểm", async () => {
    const f = await fixture();
    logs.length = 0;
    logLink = true;
    try {
      expect(await uc().ensureLink(T, f.id, { by: U1, force: false })).toBe("created");
      expect(JSON.stringify(logs)).toMatch(/\/ky\/[A-Za-z0-9_-]{43}/);
    } finally {
      logLink = false;
    }
  });

  it("soát #7 · Bên A chưa ký đủ ⇒ 409 NGAY, không in PDF, không ghi tệp", async () => {
    const f = await fixture();
    await uc().ensureLink(T, f.id, { by: U1, force: false });
    const r = await uc().resend({ tenantId: T, userId: U1 }, f.id, false);
    const th = await hashLinkToken(TOKEN_RE.exec(r.url ?? "")?.[1] as string);
    expect((await uc().quick(th, { method: "type", png: png() })).ok).toBe(true);
    aDone = false;
    produced = 0;
    puts = 0;
    try {
      const out = await uc().sign(th, {
        file_id: f.fileId,
        marks: [{ field_id: f.bField, placement: "field", parts: [part], caption: true }],
      } as never);
      expect(out).toMatchObject({ ok: false, status: 409 });
      expect(produced).toBe(0);
      expect(puts).toBe(0);
    } finally {
      aDone = true;
    }
  });
});
