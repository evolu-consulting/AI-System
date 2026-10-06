// X1-AC11 (combine) · S8 mock · ADM-FR-23 · HUB-FR-51: admin platform sửa NHÁP /mock-dich (chưa lưu) rồi "Chạy thử" qua admin-api →
// Hub thật → Dify mock: 200, Dify mock nhận đúng 1 lời gọi với input nháp; DB không đổi (hub_config_version giữ nguyên).
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { ADMIN_URL, adminLogin, difyRuns, X1_IDS } from "./_support";

const version = async (): Promise<number> => {
  const sql = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql<
      { v: number }[]
    >`select hub_config_version as v from hub.config_meta where id = 1`;
    return r?.v ?? -1;
  } finally {
    await sql.end();
  }
};

test("X1-AC11 · sửa nháp /mock-dich (đổi timeout, chưa lưu) ⇒ 'Chạy thử' 200, Dify mock đúng 1 lời gọi, config_version không đổi", async ({
  page,
}) => {
  const before = await version();
  const base = (await difyRuns()).length;
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/commands/${X1_IDS.cmdDich}`);
  const timeout = page.getByRole("spinbutton", { name: "Timeout (giây)" });
  await expect(timeout).toBeVisible();
  await timeout.fill("20");
  const text = page.getByRole("textbox", { name: "Nội dung sau lệnh" });
  await expect(text).toBeVisible();
  await text.fill("en hello");
  const req = page.waitForResponse(
    (r) => r.url().includes("/admin/commands/test") && r.request().method() === "POST",
  );
  const run = page.getByRole("button", { name: "Chạy thử", exact: true }).first();
  await expect(run).toBeVisible();
  await run.click();
  const res = await req;
  expect(res.status()).toBe(200);
  expect(res.request().postDataJSON()).toMatchObject({ command: { timeout_s: 20 } });
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible();
  const calls = (await difyRuns()).slice(base);
  expect(calls).toHaveLength(1);
  expect(JSON.stringify((calls[0]?.body as { inputs?: unknown })?.inputs)).toContain("hello");
  expect(await version()).toBe(before);
});
