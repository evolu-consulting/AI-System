// UAT CR-095 B1 + B6 · Luật 4b: UI theo quyền, backend giả `page.route`. B1: /partners — viewer (`actions=[read]`) không thấy
// "+ Ghi việc" / "Chấm điểm", editor thấy. B6: thẻ duyệt — người không quyết được (`can_act=false`, vd người gửi ở cấp 2)
// không thấy "Xác nhận"/"Duyệt"; sau khi bấm "Xác nhận" ở cấp 1 mà bước kế là cấp 2 không quyết được thì nút biến mất.
import { expect, type Page, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";
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
  await page.goto("/partners");
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

test("B6 · Xác nhận cấp 1 → cấp 2 người gửi không quyết được: hết nút, hiện ghi chú chờ", async ({
  page,
}) => {
  await base(page, "owner");
  let state = approvalAsHub("level1");
  const posts: string[] = [];
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/approval") && req.method() === "POST") {
      posts.push(JSON.stringify(req.postDataJSON()));
      state = approvalAsHub("level2", { can_act: false });
      return json(r, 200, state);
    }
    if (path.endsWith("/approval")) return json(r, 200, state);
    if (req.method() === "PATCH")
      return json(r, 200, {
        id: contract.id,
        version: 4,
        updated_at: "2026-10-18T03:00:00Z",
        fields: {},
      });
    return json(r, 200, contractAsHub());
  });
  await page.goto(`/contracts/${contract.id}`);
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(
    page.getByText("Đang chờ Ban giám đốc duyệt (bạn không thể duyệt bước này)."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Xác nhận|Duyệt|Từ chối)$/ })).toHaveCount(0);
  expect(posts).toEqual(['{"action":"approve"}']);
});
