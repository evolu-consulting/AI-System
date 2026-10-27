// Luồng 18 · CR-101b REP-v3: đọc số xem trước "N đối tác đổi mức nếu bật V2-E" trên máy chủ thật (tenant demo, chỉ đọc —
// `GET /reputation/switch-preview` không ghi gì). In số ra log để người dùng quyết bật cờ REPUTATION_ENGINE=v2e.
import { request as playwrightRequest } from "@playwright/test";
import { CW, expect, password, TENANT, test, USER } from "./_support";

test("[REP-v3] switch-preview trả số đối tác đổi mức (chỉ đọc)", async () => {
  const api = await playwrightRequest.newContext({ baseURL: CW });
  const lr = await api.post("/auth/login", {
    data: { tenant_key: TENANT, username: USER, password: password() },
    headers: { "X-App": "contracts" },
  });
  const token = ((await lr.json()) as { access_token?: string }).access_token;
  expect(token, "đăng nhập API demo").toBeTruthy();
  const r = await api.get("/pack/contracts/reputation/switch-preview", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const b = (await r.json()) as { changed: number; partners: number; moves?: unknown[] };
  console.log(
    `SWITCH-PREVIEW demo: changed=${b.changed} partners=${b.partners} moves=${JSON.stringify(b.moves ?? []).slice(0, 600)}`,
  );
  // Engine hiện hành (sau khi bật cờ trên prod 2026-10-27 phải là v2e; env DEP_REP_ENGINE để đổi kỳ vọng).
  const cfg = await api.get("/pack/contracts/reputation/config", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(cfg.status()).toBe(200);
  const engine = ((await cfg.json()) as { engine?: string }).engine;
  console.log(`REP-ENGINE demo: ${engine}`);
  expect(engine).toBe(process.env.DEP_REP_ENGINE ?? "v2e");
  const partners = await api.get("/pack/contracts/reputation/partners", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(partners.status()).toBe(200);
  await api.dispose();
});
