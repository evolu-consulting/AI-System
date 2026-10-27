// Luồng 19 · ký số thật trên máy chủ (nhà cung cấp đang bật, vd DocuSign sandbox): bật ký số cho tenant demo, chọn một HĐ demo đã
// khoá có PDF (`/esign` trả `ready`, chưa có phong bì mở), gửi ký tới ESIGN_TEST_EMAIL (người ký "company"). Nhà cung cấp gửi EMAIL
// THẬT ⇒ chỉ chạy khi đặt ESIGN_TEST_EMAIL (email của chính người chạy), không bao giờ email khách. Không tự huỷ phong bì: người
// nhận ký để kiểm luồng hoàn tất (Làm mới trạng thái ⇒ "Bản đã ký").
import { request as playwrightRequest } from "@playwright/test";
import { CW, expect, password, TENANT, test, USER } from "./_support";

const EMAIL = process.env.ESIGN_TEST_EMAIL ?? "";
const P = "/pack/contracts";

test.skip(!EMAIL, "ESIGN_TEST_EMAIL chưa đặt (nhà cung cấp gửi email thật)");

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
  };
  console.log(`ESIGN settings: configured=${s0.configured} enabled=${s0.enabled}`);
  expect(s0.configured, "máy chủ đã cấu hình nhà cung cấp ký số").toBe(true);
  if (!s0.enabled) {
    const r = await api.put(`${P}/esign/settings`, { headers: h, data: { enabled: true } });
    expect(r.status()).toBe(200);
  }

  const lres = await api.get(`${P}/contracts?page_size=50`, { headers: h });
  expect(lres.status()).toBe(200);
  const list = (await lres.json()) as { items: { id: string; title?: string; locked: boolean }[] };
  let picked: { id: string; title?: string } | undefined;
  for (const it of list.items.filter((x) => x.locked)) {
    const st = (await (await api.get(`${P}/contracts/${it.id}/esign`, { headers: h })).json()) as {
      ready?: boolean;
      envelope?: { status: string } | null;
    };
    const open = st.envelope && !["completed", "declined", "voided"].includes(st.envelope.status);
    if (st.ready && !open) {
      picked = it;
      break;
    }
  }
  expect(picked, "có HĐ demo đã khoá + PDF để ký").toBeTruthy();
  console.log(`ESIGN HĐ: ${picked?.id} ${picked?.title ?? ""}`);

  const send = await api.post(`${P}/contracts/${picked?.id}/esign`, {
    headers: h,
    data: { signers: [{ role: "company", name: "Người ký thử", email: EMAIL }] },
  });
  const body = (await send.json()) as {
    status?: string;
    provider?: string;
    error?: { code?: string };
  };
  console.log(
    `ESIGN gửi: http ${send.status()} status=${body.status ?? "?"} provider=${body.provider ?? "?"} err=${body.error?.code ?? ""}`,
  );
  expect(send.ok()).toBe(true);
  await api.dispose();
});
