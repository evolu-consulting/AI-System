// CR-122 p21 · người ký công ty của phong bì ĐANG MỞ thấy HĐ (chế độ thấy `org`, ngoài cây của chủ HĐ): HĐ `needs_review` đã khoá
// bởi bước Ký số ⇒ người ký mở được HĐ + trạng thái ký số + "Ký ngay" (sign-url) + làm mới; editor không phải người ký vẫn 404;
// tenant khác không thấy; phong bì xong/huỷ ⇒ hết thấy theo nhánh này. RLS thật (`contracts_rw`). DocuSign GIẢ cục bộ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrange, CBASE, CK, insContract, insFile, P, pdf, T } from "../HD1/_support/hd1";
import { untilHubSettles } from "../N1/_support/n1";
import { type EsignCtx, startEsign } from "./_support/esign";

let c: EsignCtx;
beforeAll(async () => {
  c = await startEsign();
  await arrange(c);
  // cuc = editor gói nhưng KHÔNG là người ký (đối chứng); hoa = editor + người ký công ty.
  await c.addToRole(T.acme, "editor", [P.cuc]);
  const got = await untilHubSettles(
    c.hub,
    async () => (await c.hubCall(P.cuc, "GET", `/pack/${CK}/me`)).json?.actions ?? [],
    (a: string[]) => a.includes("write"),
  );
  expect(got.includes("write")).toBe(true);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

/** HĐ của lan, `needs_review` + đã khoá (như `lockForSign`), chế độ thấy `org`; phong bì mở với hoa là người ký công ty. */
async function setup(): Promise<{ id: string; env: string }> {
  await arrange(c);
  await c.sql`truncate contracts.esign_envelopes`;
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  expect(
    (await c.hubCall(P.lan, "PUT", "/pack/contracts/esign/settings", { enabled: true })).status,
  ).toBe(200);
  const id = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
  await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: "needs_review",
    fileId: rowId,
    owner: P.lan.id,
  });
  await c.sql`update contracts.contracts set locked_at = now(), locked_by = ${P.lan.id} where id = ${id}`;
  const hoa = { role: "company" as const, name: "Hoa", email: "hoa@acme-esign.test", order: 1 };
  const { envelopeId: env } = await c.ds.fake.createEnvelope({
    subject: "Ký HĐ",
    title: "HĐ",
    number: null,
    document: { name: "hd.pdf", bytes: pdf() },
    signers: [{ ...hoa, clientUserId: P.hoa.id }],
  });
  const signers = [{ ...hoa, client_user_id: P.hoa.id, status: null, signed_at: null }];
  await c.sql`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by)
    values (${T.acme}, ${id}, 'docusign', ${env}, ${c.sql.json(signers)}, ${P.lan.id})`;
  return { id, env };
}

/** Đọc HĐ dưới RLS thật (`contracts_rw`) như `user` của `tenant` ⇒ số hàng. */
async function rlsRead(tenant: string, user: string, id: string): Promise<number> {
  return c.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenant}, true), set_config('app.user_id', ${user}, true)`;
    await tx`set local role contracts_rw`;
    return (await tx`select id from contracts.contracts where id = ${id}`).length;
  });
}

const get = (who: (typeof P)[keyof typeof P], id: string) =>
  c.hubCall(who, "GET", `${CBASE}/${id}`);

describe("CR-122 p21 · người ký công ty thấy HĐ đang chờ ký", () => {
  it("người ký đọc HĐ + trạng thái + Ký ngay + làm mới, editor khác và tenant khác không thấy", async () => {
    const { id, env } = await setup();
    expect({ hoa: (await get(P.hoa, id)).status }).toEqual({ hoa: 200 });
    expect(await rlsRead(T.acme, P.hoa.id, id)).toBe(1);
    const st = await c.hubCall(P.hoa, "GET", `${CBASE}/${id}/esign`);
    expect(st.status).toBe(200);
    expect(st.json.envelope).toMatchObject({ status: "sent" });
    const view = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/sign-url`, {
      return_url: `http://localhost:3100/contracts/${id}`,
    });
    expect(view.status).toBe(200);
    expect(view.json.url).toContain(`/signing/${env}`);
    expect((await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/refresh`)).status).toBe(200);

    // không là người ký ⇒ không thấy (cũ); người ký không sửa được hàng HĐ (UPDATE giữ luật cũ)
    expect({ cuc: (await get(P.cuc, id)).status }).toEqual({ cuc: 404 });
    expect(await rlsRead(T.acme, P.cuc.id, id)).toBe(0);
    expect({ tam: (await get(P.tam, id)).status }).toEqual({ tam: 404 });
    const upd = await c.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${T.acme}, true), set_config('app.user_id', ${P.hoa.id}, true)`;
      await tx`set local role contracts_rw`;
      return (
        await tx`update contracts.contracts set updated_at = now() where id = ${id} returning id`
      ).length;
    });
    expect(upd).toBe(0);
    // tenant khác: cùng user id nhưng `app.tenant_id` khác ⇒ 0; owner tenant khác qua API ⇒ không thấy
    expect(await rlsRead(T.beta, P.hoa.id, id)).toBe(0);
    expect([403, 404]).toContain((await get(P.an, id)).status);
  }, 90_000);

  it("phong bì xong hoặc huỷ ⇒ người ký hết thấy theo nhánh này", async () => {
    for (const st of ["completed", "voided"]) {
      const { id } = await setup();
      expect(await rlsRead(T.acme, P.hoa.id, id)).toBe(1);
      await c.sql`update contracts.esign_envelopes set status = ${st} where contract_id = ${id}`;
      expect({ st, read: await rlsRead(T.acme, P.hoa.id, id) }).toEqual({ st, read: 0 });
      expect({ st, api: (await get(P.hoa, id)).status }).toEqual({ st, api: 404 });
    }
  }, 90_000);
});
