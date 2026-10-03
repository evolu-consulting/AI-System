// ADM-FR-08 · helper e2e 2FA (test-plan-cd §0 "Oracle TOTP", test-plan-cd-e2e): mã TOTP theo giờ thật bằng oracle
// độc lập `tests/acceptance/M4/_totp.ts` (KHÔNG dùng `lib/totp.ts` của sản phẩm), chờ sang bước kế theo điều kiện
// (`expect.poll`, không sleep cố định), bật 2FA qua API cho user fixture. Chạy trong Node/Playwright.
import { type APIRequestContext, expect } from "@playwright/test";
import { stepOf, totpAt } from "../../tests/acceptance/M4/_totp";

export {
  b32,
  RFC_SECRET_B32,
  stepOf,
  totpAt,
  unb32,
  wrongCodeAt,
} from "../../tests/acceptance/M4/_totp";

const API_URL = "http://localhost:3001";
const nowS = (): number => Math.floor(Date.now() / 1000);

/** Mã của bước hiện tại + `offsetSteps` (giờ thật). `offsetSteps = 5` = mã chắc chắn sai. */
export function codeFor(secret: string, offsetSteps = 0): string {
  return totpAt(secret, nowS() + offsetSteps * 30);
}

/**
 * Chờ tới khi bước TOTP đổi (≤ 31 s) — để mã kế tiếp không bị chặn "đã dùng". Sau đó dùng `codeFor(secret, 1)`
 * hoặc `codeFor(secret, 0)` đều thuộc bước mới hơn bước đã dùng.
 */
export async function waitNextStep(): Promise<void> {
  const start = stepOf(nowS());
  await expect
    .poll(() => stepOf(nowS()), { timeout: 31_000, intervals: [250] })
    .toBeGreaterThan(start);
}

export type Enabled2fa = { secret: string; backupCodes: string[] };

/** Bật 2FA qua API (login → setup → enable) cho user chưa bật. Trả secret + 10 mã dự phòng. */
export async function enable2faApi(
  request: APIRequestContext,
  tenant: string,
  username: string,
  password: string,
): Promise<Enabled2fa> {
  const login = await request.post(`${API_URL}/auth/login`, {
    data: { tenant_key: tenant, username, password },
  });
  expect(login.status()).toBe(200);
  const token = ((await login.json()) as { access_token: string }).access_token;
  const headers = { authorization: `Bearer ${token}` };
  const setup = await request.post(`${API_URL}/auth/totp/setup`, {
    headers,
    data: { current_password: password },
  });
  expect(setup.status()).toBe(200);
  const secret = ((await setup.json()) as { secret: string }).secret;
  const enable = await request.post(`${API_URL}/auth/totp/enable`, {
    headers,
    data: { code: codeFor(secret, 0) },
  });
  expect(enable.status()).toBe(200);
  const backupCodes = ((await enable.json()) as { backup_codes: string[] }).backup_codes;
  return { secret, backupCodes };
}
