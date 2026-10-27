// esign-multi · int (quyền/tenant viết TRƯỚC code phần đó): nhiều nhà cung cấp song song (DocuSign GIẢ cục bộ + ký thử selfsign) —
// settings trả providers + default, chỉ owner đổi default (khả dụng), gửi ký theo provider chỉ định vs mặc định công ty, provider không
// khả dụng ⇒ 422, envelope cũ vẫn làm mới bằng provider LƯU sau khi đổi default; người ký công ty = tài khoản gửi (bỏ email client),
// "Ký ngay" chỉ người ký công ty (403); trang ký HTML + anchor; cách ly tenant (default theo công ty, không thấy envelope chéo).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { selfsignProvider } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/esign.selfsign";
import { type EsignCtx, startEsign } from "../cf-esign/_support/esign";
import { arrange, CBASE, insContract, insFile, P, pdf, T } from "../HD1/_support/hd1";

let c: EsignCtx;
beforeAll(async () => {
  c = await startEsign([selfsignProvider()]);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const SET = "/pack/contracts/esign/settings";
const LAN_EMAIL = "lan@acme-multi.test";
const SIGNERS = [
  { role: "company", name: "Giả mạo", email: "spoof@evil.test" },
  { role: "partner", name: "Đối tác <B>", email: "b@partner.test" },
];
const RET = (id: string) => `http://localhost:3100/contracts/${id}`;

async function setup(): Promise<string> {
  await c.sql`truncate contracts.esign_envelopes`;
  await arrange(c);
  await c.sql`update contracts.approval_settings set esign_enabled = false, esign_default_provider = null`;
  await c.sql`update admin.users set email = ${LAN_EMAIL} where id = ${P.lan.id}`;
  const id = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
  await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: "active",
    fileId: rowId,
    title: "HĐ mua băng keo",
  });
  expect((await c.hubCall(P.lan, "PUT", SET, { enabled: true })).status).toBe(200);
  return id;
}
const codeOf = (r: { text: string }) => /"code"\s*:\s*"([A-Z_]+)"/.exec(r.text)?.[1] ?? r.text;

describe("esign-multi · cài đặt nhà cung cấp", () => {
  it("settings trả providers (thứ tự env) + default = khả dụng đầu tiên; owner đổi default; non-owner 403; không khả dụng 422", async () => {
    await setup();
    const s = await c.hubCall(P.tam, "GET", SET);
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({
      configured: true,
      enabled: true,
      default_provider: "docusign",
      provider: "docusign",
      providers: [
        { key: "docusign", label: "DocuSign", kind: "envelope", available: true, legal: true },
        { key: "selfsign", label: "Ký thử", kind: "ca", available: true, legal: false },
      ],
    });
    expect((await c.hubCall(P.hoa, "PUT", SET, { default_provider: "selfsign" })).status).toBe(403);
    const bad = await c.hubCall(P.lan, "PUT", SET, { default_provider: "misa" });
    expect({ s: bad.status, code: codeOf(bad) }).toEqual({
      s: 422,
      code: "ESIGN_PROVIDER_UNAVAILABLE",
    });
    const ok = await c.hubCall(P.lan, "PUT", SET, { default_provider: "selfsign" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ enabled: true, default_provider: "selfsign", demo: true });
    // đổi cờ bật không xoá default
    const off = await c.hubCall(P.lan, "PUT", SET, { enabled: false });
    expect(off.json).toMatchObject({ enabled: false, default_provider: "selfsign" });
  });
});

describe("esign-multi · gửi ký theo nhà cung cấp", () => {
  it("vắng provider ⇒ mặc định công ty; chỉ định ⇒ dùng; người ký công ty = tài khoản; trang ký HTML + anchor", async () => {
    const id = await setup();
    const before = c.ds.creates.length;
    const sent = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS });
    expect(sent.status).toBe(201);
    expect(sent.json.envelope).toMatchObject({ provider: "docusign", provider_label: "DocuSign" });
    expect(sent.json.envelope.signers[0]).toMatchObject({
      role: "company",
      email: LAN_EMAIL,
      embedded: true,
    });
    const body = c.ds.creates[before];
    expect(body?.recipients.signers.map((x) => x.email)).toEqual([LAN_EMAIL, "b@partner.test"]);
    expect(body?.documents[1]?.fileExtension).toBe("html");
    const html = Buffer.from(body?.documents[1]?.documentBase64 ?? "", "base64").toString("utf8");
    expect(html).toContain("TRANG KÝ / SIGNATURE PAGE");
    expect(html).toContain("Đối tác &lt;B&gt;");
    expect(html).not.toContain("spoof@evil.test");
    expect(body?.recipients.signers.map((x) => x.tabs?.signHereTabs?.[0]?.anchorString)).toEqual([
      "\\s1\\",
      "\\s2\\",
    ]);
    expect(body?.recipients.signers.map((x) => x.tabs?.dateSignedTabs?.[0]?.anchorString)).toEqual([
      "\\d1\\",
      "\\d2\\",
    ]);

    // HĐ thứ hai: chỉ định selfsign (mặc định vẫn docusign) ⇒ không gọi DocuSign
    const id2 = crypto.randomUUID();
    const f2 = crypto.randomUUID();
    const up = c.fb.put(pdf(), "hd2.pdf", `t_${T.acme}`);
    await insFile(c.sql, T.acme, f2, up.file_id, "hd2.pdf");
    await insContract(c.sql, {
      id: id2,
      tenant: T.acme,
      status: "active",
      fileId: f2,
      title: "HĐ 2",
    });
    const n = c.ds.creates.length;
    const s2 = await c.hubCall(P.lan, "POST", `${CBASE}/${id2}/esign`, {
      signers: SIGNERS,
      provider: "selfsign",
    });
    expect(s2.status).toBe(201);
    expect(s2.json.envelope).toMatchObject({ provider: "selfsign", demo: true });
    expect(c.ds.creates.length).toBe(n);
  });

  it("provider không khả dụng / lạ ⇒ 422 ESIGN_PROVIDER_UNAVAILABLE; tài khoản không email ⇒ 422 ESIGN_SIGNER_NO_EMAIL", async () => {
    const id = await setup();
    for (const p of ["misa", "vnpt"]) {
      const r = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, {
        signers: SIGNERS,
        provider: p,
      });
      expect({ p, s: r.status, code: codeOf(r) }).toEqual({
        p,
        s: 422,
        code: "ESIGN_PROVIDER_UNAVAILABLE",
      });
    }
    await c.sql`update admin.users set email = null where id = ${P.hoa.id}`;
    try {
      const r = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS });
      expect({ s: r.status, code: codeOf(r) }).toEqual({ s: 422, code: "ESIGN_SIGNER_NO_EMAIL" });
    } finally {
      await c.sql`update admin.users set email = 'hoa@example.test' where id = ${P.hoa.id}`;
    }
  });

  it("đổi default sau khi gửi ⇒ envelope DocuSign cũ vẫn làm mới bằng DocuSign (provider lưu)", async () => {
    const id = await setup();
    expect(
      (await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    expect((await c.hubCall(P.lan, "PUT", SET, { default_provider: "selfsign" })).status).toBe(200);
    c.ds.fake.complete([...c.ds.fake.envelopes.keys()].at(-1) as string);
    const r = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/refresh`);
    expect(r.status).toBe(200);
    expect(r.json.envelope).toMatchObject({
      provider: "docusign",
      status: "completed",
      has_signed_file: true,
    });
    expect(r.json.default_provider).toBe("selfsign");
  });
});

describe("esign-multi · Ký ngay chỉ người ký công ty", () => {
  it("user khác ⇒ 403 ESIGN_NOT_SIGNER; người gửi ⇒ ký thử hoàn tất; provider loại envelope khác ⇒ 422", async () => {
    const id = await setup();
    expect((await c.hubCall(P.lan, "PUT", SET, { default_provider: "selfsign" })).status).toBe(200);
    expect(
      (await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    const other = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/sign-url`, {
      return_url: RET(id),
    });
    expect({ s: other.status, code: codeOf(other) }).toEqual({ s: 403, code: "ESIGN_NOT_SIGNER" });
    const wrong = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign/sign-url`, {
      return_url: RET(id),
      provider: "docusign",
    });
    expect({ s: wrong.status, code: codeOf(wrong) }).toEqual({
      s: 422,
      code: "ESIGN_PROVIDER_UNAVAILABLE",
    });
    const mine = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign/sign-url`, {
      return_url: RET(id),
      provider: "selfsign",
    });
    expect(mine.status).toBe(200);
    const st = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign`);
    expect(st.json.envelope).toMatchObject({ provider: "selfsign", status: "completed" });
  });
});

describe("esign-multi · cách ly tenant", () => {
  it("default theo công ty (beta không bị acme đổi); beta không thấy/ký/làm mới envelope của acme (404)", async () => {
    const id = await setup();
    expect((await c.hubCall(P.lan, "PUT", SET, { default_provider: "selfsign" })).status).toBe(200);
    expect(
      (await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    const b = await c.hubCall(P.an, "GET", SET);
    expect(b.json.default_provider).toBe("docusign");
    expect(
      (await c.hubCall(P.an, "PUT", SET, { enabled: true, default_provider: "docusign" })).status,
    ).toBe(200);
    expect((await c.hubCall(P.lan, "GET", SET)).json.default_provider).toBe("selfsign");
    for (const [m, p, body] of [
      ["GET", `${CBASE}/${id}/esign`, undefined],
      ["POST", `${CBASE}/${id}/esign/refresh`, undefined],
      ["POST", `${CBASE}/${id}/esign/sign-url`, { return_url: RET(id) }],
      ["POST", `${CBASE}/${id}/esign`, { signers: SIGNERS, provider: "selfsign" }],
    ] as const) {
      const r = await c.hubCall(P.an, m, p, body);
      expect({ p, s: r.status }).toEqual({ p, s: 404 });
    }
    const [x] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.esign_envelopes
      where tenant_id = ${T.beta}`;
    expect(x?.n).toBe(0);
  });
});
