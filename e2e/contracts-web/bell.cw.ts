// N3-FR-04 · N3-FR-09 · e2e chuông thông báo S16 có dữ liệu: số chưa đọc, danh sách, đánh dấu đã đọc, tùy chọn kênh, lỗi API ⇒ rỗng.
// Backend giả bằng `page.route` (cùng cách `scenes.cw.ts`); chỉ chạy ở chế độ so (không phải CW_MODE=ref, vì đó là web mgmt-app).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chế độ chụp tham chiếu mgmt-app");

const ID1 = "a3000000-0000-4000-8000-000000000001";
const ID2 = "a3000000-0000-4000-8000-000000000002";
const item = (id: string, seq: number, title: string, read: boolean, link: string | null) => ({
  id,
  seq,
  source: "contracts",
  kind: "remind.deadline",
  title,
  body: "Còn 30 ngày",
  link,
  created_at: "2026-10-17T02:00:00.000Z",
  read,
});

/** gap-c #11: GET prefs trả dạng "view" (mốc hiệu lực + mặc định tenant). */
const PREFS = {
  email: true,
  push: false,
  remind_days: [60, 30, 7, 1, 0],
  remind_days_custom: false,
  remind_days_default: [60, 30, 7, 1, 0],
  price_alerts: true,
  include_managed: false,
};

type Api = { posts: unknown[]; puts: unknown[]; unread: number; failList: boolean };

type Json = (r: Route, status: number, body: unknown) => Promise<void>;
const json: Json = (r, status, body) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** `/notifications*` giả có trạng thái: đánh dấu đã đọc làm giảm `unread`. Bảng theo "METHOD đường-dẫn". */
function notifyRoutes(api: Api): Record<string, (r: Route) => Promise<void>> {
  const body = (r: Route) => r.request().postDataJSON();
  return {
    "GET /notifications": (r) =>
      api.failList
        ? json(r, 500, { error: { code: "INTERNAL_ERROR", message: "x" } })
        : json(r, 200, {
            items: [
              item(ID2, 2, "Giá nguyên liệu thay đổi", api.unread < 2, null),
              item(ID1, 1, "Hợp đồng sắp hết hạn", api.unread < 1, "/contracts"),
            ],
            unread: api.unread,
            next_before: null,
          }),
    "POST /notifications/read": (r) => {
      const b = body(r);
      api.posts.push(b);
      api.unread = b.all ? 0 : Math.max(0, api.unread - b.ids.length);
      return json(r, 200, { updated: 1 });
    },
    "GET /notifications/prefs": (r) => json(r, 200, PREFS),
    "PUT /notifications/prefs": (r) => {
      api.puts.push(body(r));
      return json(r, 200, { ...PREFS, ...body(r) });
    },
  };
}

/** Đăng nhập giả + `/notifications*` giả. */
async function install(page: Page, initialUnread = 2): Promise<Api> {
  const d = asHub("editor");
  const api: Api = { posts: [], puts: [], unread: initialUnread, failList: false };
  const table = notifyRoutes(api);
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(
    (u) => u.pathname.startsWith("/notifications"),
    (r) => {
      const key = `${r.request().method()} ${new URL(r.request().url()).pathname}`;
      return (
        table[key] ?? ((x: Route) => json(x, 404, { error: { code: "NOT_FOUND", message: "x" } }))
      )(r);
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem("ai.locale", "vi");
    localStorage.setItem("assistant:open", "0");
  });
  return api;
}
const bell = (page: Page) => page.locator('header button[aria-label^="Thông báo"]');

test("N3-FR-09 · chuông hiện số chưa đọc và danh sách; mục chưa đọc có chấm 'Chưa đọc'", async ({
  page,
}) => {
  await install(page);
  await page.goto("/contracts");
  await expect(bell(page)).toHaveAttribute("aria-label", "Thông báo, 2 chưa đọc");
  await expect(bell(page)).toContainText("2");
  await bell(page).click();
  const dialog = page.getByRole("dialog", { name: /Thông báo/ });
  await expect(dialog.getByText("Hợp đồng sắp hết hạn")).toBeVisible();
  await expect(dialog.getByText("Giá nguyên liệu thay đổi")).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Chưa đọc" })).toHaveCount(2);
});

test("N3-FR-09 · 'Đánh dấu tất cả đã đọc' gọi API và xóa số chưa đọc", async ({ page }) => {
  const api = await install(page);
  await page.goto("/contracts");
  await bell(page).click();
  await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }).click();
  await expect(bell(page)).toHaveAttribute("aria-label", "Thông báo");
  expect(api.posts).toEqual([{ all: true }]);
});

test("N3-FR-09 · bấm một thông báo có liên kết ⇒ đánh dấu đã đọc đúng id và đi tới đường dẫn trong app", async ({
  page,
}) => {
  const api = await install(page);
  await page.goto("/partners");
  await bell(page).click();
  await page.getByRole("link", { name: /Hợp đồng sắp hết hạn/ }).click();
  await expect(page).toHaveURL(/\/contracts$/);
  expect(api.posts).toEqual([{ ids: [ID1] }]);
});

test("gap-c #13 · chân chuông luôn có 'Xem tất cả' + 'Cài đặt thông báo' (kể cả chưa có thông báo) ⇒ mở trang /notifications", async ({
  page,
}) => {
  const api = await install(page, 0);
  api.failList = true; // chuông rỗng vẫn phải với tới được form tùy chọn
  await page.goto("/contracts");
  await bell(page).click();
  const dialog = page.getByRole("dialog", { name: /Thông báo/ });
  await expect(dialog.getByRole("link", { name: "Cài đặt thông báo" })).toBeVisible();
  await dialog.getByRole("link", { name: "Xem tất cả" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Thông báo", level: 1 })).toBeVisible();
});

test("gap-c #13/#11 · trang /notifications: tắt email ⇒ PUT đúng body; bỏ 'mặc định công ty' ⇒ chọn mốc riêng", async ({
  page,
}) => {
  const api = await install(page);
  await page.goto("/notifications");
  const email = page.getByRole("checkbox", { name: "Email" });
  await expect(email).toBeChecked();
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith("/notifications/prefs"),
  );
  await email.click();
  await put; // chờ đúng tín hiệu request, không chờ giờ
  expect(api.puts[0]).toEqual({ email: false, push: false });
  await page.getByRole("checkbox", { name: "Dùng mặc định của công ty" }).click();
  expect(api.puts[1]).toEqual({ email: false, push: false, remind_days: [60, 30, 7, 1, 0] });
});

test("gap-c #12 · thông báo đẩy chỉ đăng ký khi người dùng tick (không tự xin quyền lúc tải trang)", async ({
  page,
}) => {
  await install(page);
  await page.addInitScript(() => {
    (window as unknown as { __perm: number }).__perm = 0;
    Object.defineProperty(window.Notification, "requestPermission", {
      value: async () => {
        (window as unknown as { __perm: number }).__perm++;
        return "denied";
      },
    });
  });
  await page.goto("/notifications");
  await expect(page.getByRole("checkbox", { name: "Email" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __perm: number }).__perm)).toBe(0);
  await page.getByRole("checkbox", { name: "Thông báo đẩy trên trình duyệt" }).click();
  await expect(page.getByRole("status")).toContainText("chặn thông báo");
});
test("N3-FR-09 · API thông báo lỗi 500 ⇒ chuông vẫn dùng được, hiện trạng thái rỗng (không văng, không toast)", async ({
  page,
}) => {
  const api = await install(page, 0);
  api.failList = true;
  await page.goto("/contracts");
  await bell(page).click();
  await expect(page.getByText("Chưa có thông báo nào.")).toBeVisible();
  await expect(bell(page)).toHaveAttribute("aria-label", "Thông báo");
});
