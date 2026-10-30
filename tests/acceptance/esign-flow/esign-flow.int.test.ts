// esign-flow · int (quyền/tenant/engine viết TRƯỚC code phần đó): bước Ký số cuối luồng duyệt. Lượt duyệt `done` có mẫu chụp
// [review, esign] ⇒ `afterApproved` tự gửi ký (nhà cung cấp GIẢ `fakeESign`) với người ký công ty theo cấu hình (KHÔNG phải người
// bấm) + email đối tác từ liên hệ đối tác; chuông người ký; completed ⇒ bước xong; declined ⇒ cần quyết + chuông người phụ trách;
// mở lại HĐ (K4, HTTP thật, DocuSign GIẢ cục bộ) ⇒ phong bì đang mở bị huỷ. Lưu mẫu: người duyệt cụ thể của tenant + quyền gói ⇒ 200;
// người tenant khác / không quyền ghi ⇒ 422 `USER_NOT_MEMBER`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { urls } from "@ai/test-kit/env";
import { fakeESign } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/esign.fake";
import {
  type ESignModule,
  esignModule,
} from "../../../apps/hub-api/src/modules/packs/contracts/esign.mount";
import { fileboxClients } from "../../../apps/hub-api/src/modules/packs/packs.filebox";
import { type EsignCtx, startEsign } from "../cf-esign/_support/esign";
import { arrange, CBASE, insFile, P, pdf, T } from "../HD1/_support/hd1";

let c: EsignCtx;
let db: Db;
let m: ESignModule;
const fake = fakeESign();
beforeAll(async () => {
  c = await startEsign();
  db = createDb(urls().hubApi, { max: 2 });
  m = esignModule(db, {
    esign: { provider: fake },
    files: fileboxClients({ url: c.fb.origin, token: c.fb.token }),
  });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const SET = "/pack/contracts/esign/settings";
const TAX = "0301000077";
const PARTNER = "ky@doitac.test";
const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
const review = {
  kind: "review",
  key: "a",
  name: "Duyệt",
  department_group_id: null,
  approver_user_id: P.hoa.id,
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
};
const esign = (signer: Record<string, unknown> = { mode: "owner" }) => ({
  kind: "esign",
  key: "sign",
  name: "Ký số",
  company_signer: signer,
  partner_signs: true,
  order: "company_first",
  provider: null,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
});

let ready = false;
async function setup(): Promise<void> {
  if (ready) return;
  await c.sql`truncate contracts.esign_envelopes`;
  await arrange(c);
  await c.sql`update admin.users set email = 'lan@acme-flow.test' where id = ${P.lan.id}`;
  await c.sql`update admin.users set email = 'hoa@acme-flow.test' where id = ${P.hoa.id}`;
  expect((await c.hubCall(P.lan, "PUT", SET, { enabled: true })).status).toBe(200);
  await c.sql`insert into contracts.partner_contacts (tenant_id, party_key, name, email)
    values (${T.acme}, ${`tax:${TAX}`}, 'Chị Ký', ${PARTNER})`;
  ready = true;
}

/** HĐ mua đã duyệt xong (khoá) + PDF + lượt `done` chế độ engine với mẫu chụp `steps`; `partner=false` ⇒ đối tác không email. */
async function approved(steps: unknown[], o: { partner?: boolean } = {}): Promise<string> {
  await setup();
  const id = crypto.randomUUID();
  const aid = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
  await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
  const tax = o.partner === false ? "0301000099" : TAX;
  await c.sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, status, owner_user_id, created_by,
      fields, file_id)
    values (${id}, ${T.acme}, 'contract', 'HĐ ký luồng', 'purchase', 'buy', 'needs_review', ${P.lan.id}, ${P.lan.id},
      ${c.sql.json({
        number: fv(`EF-${id.slice(-4)}`),
        buyer_name: fv("Công ty Chúng Tôi"),
        buyer_tax_id: fv("0100000000"),
        supplier_name: fv("NCC Ký"),
        supplier_tax_id: fv(tax),
      } as never)}, ${rowId})`;
  await c.sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, flow_steps)
    values (${aid}, ${T.acme}, ${id}, 'done', ${P.lan.id}, 'engine', ${c.sql.json(steps as never)})`;
  await c.sql`update contracts.contracts set run_id = ${aid}, status = 'active' where id = ${id}`;
  return id;
}

const stepOf = async (id: string) =>
  (
    await c.sql<{ st: string | null; why: string | null; signer: string | null }[]>`
      select a.esign_status as st, a.esign_reason as why, a.esign_signer::text as signer
      from contracts.approvals a join contracts.contracts k on k.run_id = a.id where k.id = ${id}`
  )[0];
const envOf = async (id: string) =>
  (
    await c.sql<
      { env: string; sent_by: string; status: string }[]
    >`select envelope_id as env, sent_by::text,
      status from contracts.esign_envelopes where contract_id = ${id} order by created_at desc limit 1`
  )[0];
const bells = async (id: string) =>
  (
    await c.sql<{ user_id: string }[]>`select user_id::text from hub.notifications
      where kind = 'contract.esign' and link = ${`/contracts/${id}`} order by created_at`
  ).map((r) => r.user_id);

describe("esign-flow · duyệt xong ⇒ tự gửi ký", () => {
  it("người ký công ty = người cụ thể cấu hình (không phải người bấm), đối tác ký sau; chuông người ký; completed ⇒ xong", async () => {
    const id = await approved([review, esign({ mode: "user", user_id: P.hoa.id })]);
    expect(await m.flow.afterApproved(T.acme, id)).toBe("sent");
    const e = await envOf(id);
    expect(e?.sent_by).toBe(P.hoa.id);
    const env = fake.envelopes.get(e?.env as string);
    expect(env?.signers.map((s) => [s.role, s.email, s.clientUserId])).toEqual([
      ["company", "hoa@acme-flow.test", P.hoa.id],
      ["partner", PARTNER, null],
    ]);
    expect(await stepOf(id)).toEqual({ st: "sent", why: null, signer: P.hoa.id });
    expect(await bells(id)).toEqual([P.hoa.id]);
    // finalize chạy lại ⇒ không gửi phong bì thứ hai
    expect(await m.flow.afterApproved(T.acme, id)).toBe("none");
    fake.complete(e?.env as string);
    await m.refresh({ tenantId: T.acme, userId: P.lan.id }, id);
    expect((await stepOf(id))?.st).toBe("completed");
  });

  it("mặc định người phụ trách; declined ⇒ cần quyết + chuông người phụ trách; thiếu email đối tác ⇒ cần quyết", async () => {
    const id = await approved([review, esign()]);
    expect(await m.flow.afterApproved(T.acme, id)).toBe("sent");
    const e = await envOf(id);
    expect(e?.sent_by).toBe(P.lan.id);
    fake.decline(e?.env as string, "sai giá");
    await m.refresh({ tenantId: T.acme, userId: P.lan.id }, id);
    expect(await stepOf(id)).toMatchObject({ st: "needs_decision", why: "DECLINED" });
    expect(await bells(id)).toEqual([P.lan.id, P.lan.id]);

    const id2 = await approved([review, esign()], { partner: false });
    expect(await m.flow.afterApproved(T.acme, id2)).toBe("needs_decision");
    expect(await stepOf(id2)).toMatchObject({ st: "needs_decision", why: "NO_PARTNER_EMAIL" });
    expect(await envOf(id2)).toBeUndefined();
    expect(await bells(id2)).toEqual([P.lan.id]);
  });

  it("mẫu không có bước Ký số ⇒ không gửi (hành vi cũ)", async () => {
    const id = await approved([review]);
    expect(await m.flow.afterApproved(T.acme, id)).toBe("none");
    expect(await envOf(id)).toBeUndefined();
  });
});

describe("esign-flow · mở lại HĐ huỷ phong bì đang mở (HTTP)", () => {
  it("gửi ký tay rồi mở lại HĐ ⇒ phong bì voided ở nhà cung cấp + hàng", async () => {
    const id = await approved([review]);
    const s = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, {
      signers: [{ role: "company" }, { role: "partner", name: "Chị Ký", email: PARTNER }],
    });
    expect(s.status).toBe(201);
    const e = await envOf(id);
    const r = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/reopen`, { reason: "sửa giá" });
    expect(r.status).toBe(200);
    expect((await envOf(id))?.status).toBe("voided");
    expect(c.ds.fake.envelopes.get(e?.env as string)?.status).toBe("voided");
  });
});
// CR-105 L4: bỏ "lưu mẫu: người cụ thể thuộc tenant + quyền gói" — PUT /approval-flow đã xoá (mẫu nay là quy trình thư viện, sửa ở ai-admin).
