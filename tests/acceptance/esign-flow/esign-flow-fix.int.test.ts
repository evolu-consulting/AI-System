// esign-flow-fix · int (viết TRƯỚC phần sửa): #2 kẹt `sending` quá hạn ⇒ Gửi lại nhận, chưa quá hạn ⇒ không; #3 người ký công ty bị khoá
// / mất quyền ghi gói ⇒ NO_SIGNER, không gửi; #4 mở lại HĐ mà huỷ ở nhà cung cấp hụt ⇒ phong bì GIỮ mở + đánh dấu chờ huỷ, làm mới thử
// huỷ lại ⇒ voided; #5 trạng thái cuối chỉ đổi khi bước đang `sent` (không ghi đè "cần quyết", không chuông thừa).import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
let failVoid = false;
const provider = {
  ...fake,
  voidEnvelope: (id: string, r: string) =>
    failVoid ? Promise.reject(new Error("void-down")) : fake.voidEnvelope(id, r),
};
beforeAll(async () => {
  c = await startEsign();
  db = createDb(urls().hubApi, { max: 2 });
  m = esignModule(db, {
    esign: { provider },
    files: fileboxClients({ url: c.fb.origin, token: c.fb.token }),
  });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const SET = "/pack/contracts/esign/settings";
const TAX = "0301000078";
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

describe("esign-flow-fix", () => {
  it("#2 kẹt sending quá hạn ⇒ Gửi lại gửi được; mới sending ⇒ 409 not_needed", async () => {
    const id = await approved([review, esign()]);
    await c.sql`update contracts.approvals a set esign_status = 'sending', esign_at = now()
      from contracts.contracts k where k.id = ${id} and a.id = k.run_id`;
    const lan = { tenantId: T.acme, userId: P.lan.id };
    expect(await m.flow.resend(lan, id, false)).toBe("not_needed");
    await c.sql`update contracts.approvals a set esign_at = now() - interval '20 minutes'
      from contracts.contracts k where k.id = ${id} and a.id = k.run_id`;
    expect(await m.flow.resend(lan, id, false)).toBe("sent");
    expect((await stepOf(id))?.st).toBe("sent");
  });

  it("#3 người ký bị khoá ⇒ NO_SIGNER; mất quyền ghi gói ⇒ NO_SIGNER; không gửi phong bì", async () => {
    const a = await approved([review, esign({ mode: "user", user_id: P.hoa.id })]);
    await c.sql`update admin.users set locked_by_tenant = true where id = ${P.hoa.id}`;
    try {
      expect(await m.flow.afterApproved(T.acme, a)).toBe("needs_decision");
    } finally {
      await c.sql`update admin.users set locked_by_tenant = false where id = ${P.hoa.id}`;
    }
    expect(await stepOf(a)).toMatchObject({ st: "needs_decision", why: "NO_SIGNER" });
    expect(await envOf(a)).toBeUndefined();
    const b = await approved([review, esign({ mode: "user", user_id: P.hoa.id })]);
    m.bindWriters(async () => new Set());
    try {
      expect(await m.flow.afterApproved(T.acme, b)).toBe("needs_decision");
    } finally {
      m.bindWriters(async (_w, ids) => new Set(ids));
    }
    expect(await stepOf(b)).toMatchObject({ st: "needs_decision", why: "NO_SIGNER" });
    expect(await envOf(b)).toBeUndefined();
  });

  it("#4 mở lại HĐ: huỷ ở nhà cung cấp hụt ⇒ giữ mở + chờ huỷ; làm mới ⇒ huỷ lại ⇒ voided", async () => {
    const id = await approved([review, esign()]);
    expect(await m.flow.afterApproved(T.acme, id)).toBe("sent");
    const lan = { tenantId: T.acme, userId: P.lan.id };
    failVoid = true;
    try {
      expect(await m.voidOpen(lan, id)).toBe(false);
    } finally {
      failVoid = false;
    }
    const e = await envOf(id);
    expect(e?.status).toBe("sent");
    const [r] = await c.sql<{ reason: string }[]>`select reason from contracts.esign_envelopes
      where envelope_id = ${e?.env as string}`;
    expect(r?.reason).toContain("void-pending");
    await m.refresh(lan, id);
    expect((await envOf(id))?.status).toBe("voided");
    expect(fake.envelopes.get(e?.env as string)?.status).toBe("voided");
  });

  it("#5 trạng thái cuối chỉ áp khi bước đang sent: cần quyết không bị ghi đè, không chuông thừa", async () => {
    const id = await approved([review, esign()]);
    expect(await m.flow.afterApproved(T.acme, id)).toBe("sent");
    await c.sql`update contracts.approvals a set esign_status = 'needs_decision', esign_reason = 'SEND_FAILED'
      from contracts.contracts k where k.id = ${id} and a.id = k.run_id`;
    const before = (await bells(id)).length;
    fake.complete((await envOf(id))?.env as string);
    await m.refresh({ tenantId: T.acme, userId: P.lan.id }, id);
    expect(await stepOf(id)).toMatchObject({ st: "needs_decision", why: "SEND_FAILED" });
    expect((await bells(id)).length).toBe(before);
  });
});
