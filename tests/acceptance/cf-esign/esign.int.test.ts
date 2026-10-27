// cf-esign-docusign · int (quyền/tenant/HMAC viết TRƯỚC code phần đó): đường chính gửi ký → "Ký ngay" → webhook Connect completed
// (HMAC) → có "Bản đã ký" (FileBox + hàng files), idempotent; quyền (viewer không gửi, chỉ owner bật cài đặt); chặn chéo tenant;
// từ chối webhook sai/thiếu HMAC; từ chối ⇒ gửi lại; thiếu cấu hình ⇒ tắt (409, không 500). DocuSign GIẢ cục bộ, không gọi thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { call } from "../H1/_fixtures";
import { arrange, CBASE, insContract, insFile, P, pdf, T } from "../HD1/_support/hd1";
import { type EsignCtx, HMAC_KEY, startEsign } from "./_support/esign";

let c: EsignCtx;
beforeAll(async () => {
  c = await startEsign();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const WEBHOOK = "/pack/contracts/esign/webhook/docusign";
const LAN_EMAIL = "lan@acme-esign.test";
const SIGNERS = [
  { role: "company", name: "Lan", email: LAN_EMAIL },
  { role: "partner", name: "Đối tác B", email: "b@partner.test" },
];

async function setup(o: { status?: string; flag?: boolean } = {}): Promise<string> {
  await c.sql`truncate contracts.esign_envelopes`;
  await arrange(c);
  await c.sql`update contracts.approval_settings set esign_enabled = false`;
  await c.sql`update admin.users set email = ${LAN_EMAIL} where id = ${P.lan.id}`;
  const id = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
  await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: o.status ?? "active",
    fileId: rowId,
    title: "HĐ mua băng keo",
  });
  if (o.flag !== false) {
    const r = await c.hubCall(P.lan, "PUT", "/pack/contracts/esign/settings", { enabled: true });
    expect(r.status).toBe(200);
  }
  return id;
}
const lastEnvelope = () => [...c.ds.fake.envelopes.keys()].at(-1) as string;
const hook = (body: string, sig?: string) =>
  fetch(`${c.hub.base}${WEBHOOK}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sig ? { "x-docusign-signature-1": sig } : {}),
    },
    body,
  });
const signed = (body: string) => createHmac("sha256", HMAC_KEY).update(body).digest("base64");

describe("cf-esign · quyền + cài đặt", () => {
  it("chỉ owner bật/tắt; viewer không gửi ký (403) nhưng xem được trạng thái", async () => {
    const id = await setup();
    expect(
      (await c.hubCall(P.hoa, "PUT", "/pack/contracts/esign/settings", { enabled: true })).status,
    ).toBe(403);
    const s = await c.hubCall(P.tam, "GET", "/pack/contracts/esign/settings");
    expect(s.json).toMatchObject({
      configured: true,
      enabled: true,
      provider: "docusign",
      demo: false,
    });
    expect(
      (await c.hubCall(P.tam, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(403);
    const st = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign`);
    expect(st.status).toBe(200);
    expect(st.json).toMatchObject({ ready: true, envelope: null });
  });

  it("công ty tắt ký số ⇒ 409 ESIGN_DISABLED; HĐ chưa duyệt xong ⇒ 409 ESIGN_STATE", async () => {
    const off = await setup({ flag: false });
    const r = await c.hubCall(P.hoa, "POST", `${CBASE}/${off}/esign`, { signers: SIGNERS });
    expect({ s: r.status, code: r.json?.error?.code ?? r.json?.code }).toMatchObject({ s: 409 });
    expect(r.text).toContain("ESIGN_DISABLED");
    const open = await setup({ status: "needs_review" });
    const r2 = await c.hubCall(P.hoa, "POST", `${CBASE}/${open}/esign`, { signers: SIGNERS });
    expect(r2.status).toBe(409);
    expect(r2.text).toContain("ESIGN_STATE");
  });
});

describe("cf-esign · đường chính (DocuSign giả)", () => {
  it("gửi ký → Ký ngay → webhook completed (HMAC) → Bản đã ký; webhook lặp idempotent; sai HMAC 401", async () => {
    const id = await setup();
    const sent = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS });
    expect(sent.status).toBe(201);
    expect(sent.json.envelope).toMatchObject({
      status: "sent",
      provider: "docusign",
      has_signed_file: false,
    });
    expect(sent.json.envelope.signers.map((s: { embedded: boolean }) => s.embedded)).toEqual([
      true,
      false,
    ]);
    const env = lastEnvelope();
    expect(c.ds.fake.envelopes.get(env)?.signers.map((s) => s.order)).toEqual([1, 2]);
    // gửi lần hai khi đang chờ ⇒ 409
    expect(
      (await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(409);

    const view = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign/sign-url`, {
      return_url: `http://localhost:3100/contracts/${id}`,
    });
    expect(view.status).toBe(200);
    expect(view.json.url).toContain(`/signing/${env}`);
    expect(
      (
        await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/sign-url`, {
          return_url: `http://localhost:3100/contracts/${id}`,
        })
      ).status,
    ).toBe(403); // esign-multi · hoa không phải người ký công ty ⇒ ESIGN_NOT_SIGNER (trước: 409)

    c.ds.fake.complete(env);
    const body = JSON.stringify({
      event: "envelope-completed",
      data: { envelopeId: env, status: "voided" },
    });
    expect((await hook(body)).status).toBe(401);
    expect((await hook(body, "AAAA")).status).toBe(401);
    expect((await hook(body, signed(body))).status).toBe(200);
    expect((await hook(body, signed(body))).status).toBe(200); // lặp ⇒ không thêm tệp

    const st = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign`);
    expect(st.json.envelope).toMatchObject({ status: "completed", has_signed_file: true });
    expect(st.json.envelope.completed_at).toBe("2026-10-27T03:00:00.000Z");
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.files where name like '%-da-ky.pdf'`;
    expect(n?.n).toBe(1);
    const link = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign/signed-link`);
    expect(link.status).toBe(200);
    expect(typeof link.json.url).toBe("string");
    expect(c.ds.tokenCalls()).toBe(1); // token cache tới hết hạn
  });

  it("đối tác từ chối ⇒ Làm mới trạng thái hiện lý do ⇒ gửi lại được", async () => {
    const id = await setup();
    expect(
      (await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    c.ds.fake.decline(lastEnvelope(), "Sai đơn giá");
    // esign-fix · làm mới có ghi ⇒ viewer 403 (trạng thái không đổi), editor làm mới được.
    expect((await c.hubCall(P.tam, "POST", `${CBASE}/${id}/esign/refresh`)).status).toBe(403);
    const r = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign/refresh`);
    expect(r.json.envelope).toMatchObject({ status: "declined", reason: "Sai đơn giá" });
    expect(
      (await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
  });
});

describe("esign-fix · webhook thân lớn + xoá HĐ", () => {
  it("webhook thân > 256 KiB ⇒ 413 trước khi đọc/xác thực", async () => {
    const big = JSON.stringify({ data: { envelopeId: "x" }, pad: "a".repeat(300 * 1024) });
    const r = await hook(big, signed(big));
    expect(r.status).toBe(413);
  });

  it("owner xoá HĐ ⇒ không còn hàng esign_envelopes của HĐ (cùng tx)", async () => {
    const id = await setup();
    expect(
      (await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    const del = await c.hubCall(P.lan, "DELETE", `${CBASE}/${id}`, {});
    expect({ s: del.status, t: del.status >= 300 ? del.text : "" }).toEqual({ s: 200, t: "" });
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n
      from contracts.esign_envelopes where contract_id = ${id}`;
    expect(n?.n).toBe(0);
  });
});

describe("cf-esign · cách ly tenant", () => {
  it("tenant khác không xem/làm mới/gửi ký/huỷ trên HĐ của acme (404); bảng không lộ chéo", async () => {
    const id = await setup();
    expect(
      (await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    expect(
      (await c.hubCall(P.an, "PUT", "/pack/contracts/esign/settings", { enabled: true })).status,
    ).toBe(200);
    for (const [m, p, b] of [
      ["GET", `${CBASE}/${id}/esign`, undefined],
      ["POST", `${CBASE}/${id}/esign/refresh`, undefined],
      ["POST", `${CBASE}/${id}/esign`, { signers: SIGNERS }],
      ["POST", `${CBASE}/${id}/esign/void`, { reason: "x" }],
      ["GET", `${CBASE}/${id}/esign/signed-link`, undefined],
    ] as const) {
      const r = await c.hubCall(P.an, m, p, b);
      expect({ p, s: r.status }).toEqual({ p, s: 404 });
    }
    const [x] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.esign_envelopes where tenant_id = ${T.beta}`;
    expect(x?.n).toBe(0);
  });
});

describe("cf-esign · thiếu cấu hình ⇒ tắt", () => {
  it("hub không cấu hình: settings configured=false, gửi ký 409 (không 500), webhook 404", async () => {
    const id = await setup();
    const tok = await c.tok(P.lan);
    const s = await call(c.offHub, "GET", "/pack/contracts/esign/settings", { token: tok });
    expect(s.json).toMatchObject({ configured: false, provider: null });
    const r = await call(c.offHub, "POST", `${CBASE}/${id}/esign`, {
      token: tok,
      body: { signers: SIGNERS },
    });
    expect(r.status).toBe(409);
    const w = await fetch(`${c.offHub.base}${WEBHOOK}`, { method: "POST", body: "{}" });
    expect(w.status).toBe(404);
  });
});
