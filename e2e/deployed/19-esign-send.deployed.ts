// Luồng 19 · ký số thật trên máy chủ (nhà cung cấp đang bật, vd DocuSign sandbox): bật ký số cho tenant demo, chọn một HĐ demo đã
// khoá có PDF (`/esign` trả `ready`, chưa có phong bì mở), gửi ký qua DocuSign tới ESIGN_TEST_EMAIL (vai đối tác — người ký công ty
// luôn là tài khoản đang gọi, esign-multi). Nhà cung cấp gửi EMAIL THẬT ⇒ chỉ chạy khi đặt ESIGN_TEST_EMAIL (email của chính người
// chạy), không bao giờ email khách. ESIGN_VOID_OLD=1 ⇒ được huỷ phong bì thử cũ (đã gửi tới chính email đó) khi demo hết HĐ trống.
import { type APIRequestContext, request as playwrightRequest } from "@playwright/test";
import { CW, expect, password, TENANT, test, USER } from "./_support";

const EMAIL = process.env.ESIGN_TEST_EMAIL ?? "";
const VOID_OLD = process.env.ESIGN_VOID_OLD === "1";
const P = "/pack/contracts";
const CLOSED = ["completed", "declined", "voided"];

type Row = { id: string; title?: string; locked: boolean };
type St = {
  ready?: boolean;
  envelope?: { status: string; signers?: { email: string }[] } | null;
};

test.skip(!EMAIL, "ESIGN_TEST_EMAIL chưa đặt (nhà cung cấp gửi email thật)");

const stateOf = async (api: APIRequestContext, h: Record<string, string>, id: string) =>
  (await (await api.get(`${P}/contracts/${id}/esign`, { headers: h })).json()) as St;

/** HĐ đã khoá + PDF, chưa có phong bì mở. */
async function pickFree(api: APIRequestContext, h: Record<string, string>, rows: Row[]) {
  for (const it of rows) {
    const st = await stateOf(api, h, it.id);
    if (st.ready && !(st.envelope && !CLOSED.includes(st.envelope.status))) return it;
  }
  return undefined;
}

/** Huỷ phong bì thử còn mở đã gửi tới chính EMAIL, trả HĐ đó. */
async function voidOwnOpen(api: APIRequestContext, h: Record<string, string>, rows: Row[]) {
  for (const it of rows) {
    const st = await stateOf(api, h, it.id);
    const env = st.envelope;
    const mine = env?.signers?.some((s) => s.email === EMAIL);
    if (!st.ready || !env || !mine || CLOSED.includes(env.status)) continue;
    const v = await api.post(`${P}/contracts/${it.id}/esign/void`, {
      headers: h,
      data: { reason: "Thay bằng bản ký thử mới (E2E-DEPLOY)" },
    });
    console.log(`ESIGN huỷ phong bì cũ: http ${v.status()}`);
    return it;
  }
  return undefined;
}

test("[ký số] bật cho demo, gửi ký một HĐ đã khoá có PDF tới email kiểm thử", async () => {
  const api = await playwrightRequest.newContext({ baseURL: CW });
  const lr = await api.post("/auth/login", {
    data: { tenant_key: TENANT, username: USER, password: password() },
    headers: { "X-App": "contracts" },
  });
  const token = ((await lr.json()) as { access_token?: string }).access_token;
  expect(token, "đăng nhập API demo").toBeTruthy();
  const h = { Authorization: `Bearer ${token}` };

  const s0 = (await (await api.get(`${P}/esign/settings`, { headers: h })).json()) as {
    configured: boolean;
    enabled: boolean;
    providers?: unknown;
  };
  console.log(`ESIGN settings: configured=${s0.configured} enabled=${s0.enabled}`);
  console.log(`ESIGN providers: ${JSON.stringify(s0.providers ?? [])}`);
  expect(s0.configured, "máy chủ đã cấu hình nhà cung cấp ký số").toBe(true);
  if (!s0.enabled) {
    const r = await api.put(`${P}/esign/settings`, { headers: h, data: { enabled: true } });
    expect(r.status()).toBe(200);
  }

  const lres = await api.get(`${P}/contracts?page_size=50`, { headers: h });
  expect(lres.status()).toBe(200);
  const rows = ((await lres.json()) as { items: Row[] }).items.filter((x) => x.locked);
  const picked =
    (await pickFree(api, h, rows)) ?? (VOID_OLD ? await voidOwnOpen(api, h, rows) : undefined);
  expect(picked, "có HĐ demo đã khoá + PDF để ký").toBeTruthy();
  console.log(`ESIGN HĐ: ${picked?.id} ${picked?.title ?? ""}`);

  const send = await api.post(`${P}/contracts/${picked?.id}/esign`, {
    headers: h,
    data: {
      provider: "docusign",
      signers: [{ role: "partner", name: "Người ký thử", email: EMAIL }],
    },
  });
  const body = (await send.json()) as { provider?: string; error?: { code?: string } };
  console.log(
    `ESIGN gửi: http ${send.status()} provider=${body.provider ?? "?"} err=${body.error?.code ?? ""}`,
  );
  expect(send.ok()).toBe(true);
  await api.dispose();
});
