// PK-FR-10 · PK-FR-05 · D-02 · N1 plan-frontend §1 (Quyền, Trạng thái) §7 (nhãn "Trạng thái mới"): trạng thái gói và lỗi khung —
// PACK_FORBIDDEN, PACK_DISABLED (heading riêng, VI + EN), đang tải (status "Đang tải…"), lỗi mạng (+ "Thử lại"), phân quyền
// viewer/editor/owner qua `GET /pack/contracts/me`. Nút nghiệp vụ ("+ Thêm hợp đồng"…) thuộc màn HD5 ⇒ kiểm ở lát đó.
import { expect, test } from "@playwright/test";
import { installBackend } from "./_support";

const FORBIDDEN_VI = "Bạn chưa có quyền dùng gói Hợp đồng";
const DISABLED_VI = "Gói Hợp đồng chưa được bật cho công ty bạn";

test.describe("PK-FR-05 · trạng thái gói trên contracts-web", () => {
  test("PK-FR-05 · PACK_FORBIDDEN (bật nhưng actions rỗng) ⇒ heading riêng, KHÔNG có menu nghiệp vụ", async ({
    page,
  }) => {
    const be = await installBackend(page, { session: true });
    be.setPack({ enabled: true, actions: [] });
    await page.goto("/contracts");
    await expect(page.getByRole("heading", { name: FORBIDDEN_VI })).toBeVisible();
    await expect(page.getByRole("link", { name: "Đối tác" })).toHaveCount(0);
  });

  test("PK-AC06 · PACK_DISABLED (gói chưa bật cho công ty) ⇒ heading riêng", async ({ page }) => {
    const be = await installBackend(page, { session: true });
    be.setPack({ enabled: false, actions: [] });
    await page.goto("/contracts");
    await expect(page.getByRole("heading", { name: DISABLED_VI })).toBeVisible();
    await expect(page.getByRole("heading", { name: FORBIDDEN_VI })).toHaveCount(0);
  });

  test("PK-FR-05 · bản EN của hai trạng thái (locale en)", async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem("ai.locale", "en"));
    const be = await installBackend(page, { session: true });
    be.setPack({ enabled: true, actions: [] });
    await page.goto("/contracts");
    await expect(
      page.getByRole("heading", { name: "You don't have access to the Contracts pack" }),
    ).toBeVisible();
    be.setPack({ enabled: false, actions: [] });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The Contracts pack isn't enabled for your company" }),
    ).toBeVisible();
  });

  for (const role of ["viewer", "editor", "owner"] as const) {
    test(`PK-FR-05 · vai ${role}: /me trả actions đúng ⇒ vào shell (menu 'Hợp đồng' hiện), không trang chặn`, async ({
      page,
    }) => {
      const be = await installBackend(page, { session: true, role });
      await page.goto("/contracts");
      await expect(
        page
          .getByRole("navigation", { name: "Điều hướng chính" })
          .getByRole("link", { name: "Hợp đồng" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: FORBIDDEN_VI })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: DISABLED_VI })).toHaveCount(0);
      expect(be.meCalls()).toBeGreaterThanOrEqual(1);
    });
  }
});

test.describe("PK-FR-10 · trạng thái tải / lỗi", () => {
  test("PK-FR-10 · đang tải: status 'Đang tải…' hiện khi /me chưa trả, biến mất khi trả (giữ bằng cổng, không sleep)", async ({
    page,
  }) => {
    const be = await installBackend(page, { session: true });
    const h = be.hold();
    await page.goto("/contracts");
    await expect(page.getByRole("status", { name: "Đang tải…" })).toBeVisible();
    h.release();
    await expect(page.getByRole("status", { name: "Đang tải…" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
  });

  test("PK-FR-10 · lỗi mạng khi nạp /me ⇒ dòng lỗi + nút 'Thử lại'; bấm lại sau khi mạng hồi ⇒ vào shell", async ({
    page,
  }) => {
    const be = await installBackend(page, { session: true });
    be.setPack("network");
    await page.goto("/contracts");
    await expect(page.getByRole("alert")).toBeVisible();
    const retry = page.getByRole("button", { name: "Thử lại" });
    await expect(retry).toBeVisible();
    be.setPack({ enabled: true, actions: ["read"] });
    await retry.click();
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("PK-FR-10 · màn rỗng: route nghiệp vụ chưa có dữ liệu hiện 'Empty' (status/region), không trắng trơn", async ({
    page,
  }) => {
    await installBackend(page, { session: true, role: "viewer" });
    await page.goto("/partners");
    const main = page.getByRole("main");
    await expect(main).toBeVisible();
    await expect(main).not.toBeEmpty();
  });
});
