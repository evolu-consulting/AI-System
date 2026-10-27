// trello-config-ui · e2e khối "Tích hợp › Trello" trên /feedback (platform_admin). API `/admin/integrations/trello*` được MOCK
// bằng page.route (không gọi Trello thật, không ghi DB). Kiểm: ô mật khẩu, để trống = giữ nguyên, kiểm tra kết nối, xoá về env,
// trang không bao giờ hiện giá trị secret. Không waitForTimeout.
import { expect, type Page, type Route, test } from "@playwright/test";
import { loginAdmin, openPage, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const SECRET_KEY = "E2EKEYLEAK1234";
const SECRET_TOKEN = "E2ETOKLEAK5678";

type View = {
  source: "db" | "env" | "none";
  env_configured: boolean;
  api_key: { set: boolean; last4: string | null };
  token: { set: boolean; last4: string | null };
  list_id: string | null;
  updated_at: string | null;
};
const ENV_VIEW: View = {
  source: "env",
  env_configured: true,
  api_key: { set: false, last4: null },
  token: { set: false, last4: null },
  list_id: null,
  updated_at: null,
};
const DB_VIEW: View = {
  source: "db",
  env_configured: true,
  api_key: { set: true, last4: "1234" },
  token: { set: true, last4: "5678" },
  list_id: "list1",
  updated_at: "2026-10-27T00:00:00.000Z",
};

async function mockTrello(page: Page) {
  let view: View = ENV_VIEW;
  const puts: unknown[] = [];
  let checks = 0;
  let deletes = 0;
  await page.route("**/admin/integrations/trello/check", (r: Route) => {
    checks++;
    return r.fulfill({ json: { ok: true, source: view.source, list_name: "Mới", error: null } });
  });
  await page.route("**/admin/integrations/trello", (r: Route) => {
    const m = r.request().method();
    if (m === "PUT") {
      puts.push(r.request().postDataJSON());
      view = DB_VIEW;
      return r.fulfill({ json: view });
    }
    if (m === "DELETE") {
      deletes++;
      view = ENV_VIEW;
      return r.fulfill({ status: 204, body: "" });
    }
    return r.fulfill({ json: view });
  });
  return { puts, counts: () => ({ checks, deletes }) };
}

test("platform_admin lưu cấu hình Trello (ô mật khẩu), kiểm tra kết nối, xoá về env; không lộ secret", async ({
  page,
}) => {
  const m = await mockTrello(page);
  await loginAdmin(page);
  await openPage(page, "/feedback", "Góp ý");
  const box = page.getByRole("region", { name: "Tích hợp › Trello" });
  await expect(box).toBeVisible();
  await expect(box.getByText("Đang dùng biến môi trường")).toBeVisible();
  await expect(box.getByLabel("API key")).toHaveAttribute("type", "password");
  await expect(box.getByLabel("Token")).toHaveAttribute("type", "password");

  await box.getByLabel("API key").fill(SECRET_KEY);
  await box.getByLabel("Token").fill(SECRET_TOKEN);
  await box.getByLabel("List ID").fill("list1");
  await box.getByRole("button", { name: "Lưu cấu hình" }).click();
  await expect(box.getByText("Đang dùng cấu hình đã lưu")).toBeVisible();
  expect(m.puts[0]).toEqual({ api_key: SECRET_KEY, token: SECRET_TOKEN, list_id: "list1" });
  await expect(box.getByLabel("API key")).toHaveValue("");
  await expect(box.getByText("Đã lưu, kết thúc bằng …1234")).toBeVisible();

  // để trống key/token = giữ nguyên: body không có api_key/token
  await box.getByLabel("List ID").fill("list2");
  await box.getByRole("button", { name: "Lưu cấu hình" }).click();
  await expect.poll(() => m.puts.length).toBe(2);
  expect(m.puts[1]).toEqual({ list_id: "list2" });

  await box.getByRole("button", { name: "Kiểm tra kết nối" }).click();
  await expect(page.getByText('Kết nối được list "Mới"')).toBeVisible();
  expect(m.counts().checks).toBe(1);

  await box.getByRole("button", { name: "Xoá cấu hình" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xoá cấu hình" }).click();
  await expect(box.getByText("Đang dùng biến môi trường")).toBeVisible();
  expect(m.counts().deletes).toBe(1);

  expect(await page.content()).not.toContain("LEAK");
});
