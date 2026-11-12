// UAT CR-095 B1 · Luật 4b: UI theo quyền, backend giả `page.route`. B1: /partners — viewer (`actions=[read]`) không thấy
// "+ Ghi việc" / "Chấm điểm", editor thấy.
import { expect, type Page, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { partnersAsHub } from "./dataset-partners";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function base(page: Page, role: Role) {
  const d = asHub(role);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
}

async function partnersAs(page: Page, role: Role) {
  await base(page, role);
  await page.route(
    (u) => u.pathname.startsWith("/pack/contracts/") && !u.pathname.endsWith("/me"),
    (r) => {
      const url = new URL(r.request().url());
      const got = partnersAsHub(url.pathname, url.searchParams);
      return got === undefined
        ? json(r, 404, { error: { code: "NOT_FOUND", message: "x" } })
        : json(r, 200, got);
    },
  );
  await page.goto("/contracts/partners");
  await expect(page.getByText("Kế toán Phương Nam")).toBeVisible();
}

test("B1 · viewer ở /partners: không có nút Ghi việc / Chấm điểm", async ({ page }) => {
  await partnersAs(page, "viewer");
  await expect(page.getByRole("button", { name: /Ghi việc|Chấm điểm/ })).toHaveCount(0);
});

test("B1 · editor ở /partners: vẫn có nút + Ghi việc (V2-I: chấm điểm 0–100 đã thay bằng sao ở tab Đánh giá)", async ({
  page,
}) => {
  await partnersAs(page, "editor");
  await expect(page.getByRole("button", { name: /Ghi việc/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Chấm điểm" })).toHaveCount(0);
});
