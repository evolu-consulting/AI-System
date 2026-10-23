// V2-F · HD-04 · HD-09 · HD-11 · Luật 4b: chi tiết hợp đồng — khối Thông tin (loại khóa, lưu thay đổi = PATCH ô đã đổi), Dòng thời gian mốc
// (bước hiện tại, "+ Thêm mốc", bút sửa chỉ ở mốc chưa xác nhận, "Xác nhận xong" hỏi ngày + lỗi của ai khi trễ), Sản phẩm (Nhập/Xuất kho),
// Tóm tắt. Backend giả `page.route`; chờ phần tử/yêu cầu, không sleep.
import { expect, test } from "@playwright/test";
import { contractAsHub } from "./dataset-contract";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const M3 = "d1000000-0000-4000-8000-000000000103";
const timeline = (page: import("@playwright/test").Page) =>
  page.locator("section", { hasText: "Dòng thời gian" }).first();
const node = (page: import("@playwright/test").Page, title: string) =>
  page.locator('li[data-node="milestone"]', { hasText: title });

test.describe("Thông tin", () => {
  test("loại hợp đồng hiện nhưng khóa; sửa ô ⇒ «Lưu thay đổi» gửi PATCH chỉ ô đã đổi + version", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await expect(page.getByRole("radio", { name: /^Mua/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: /^Bán/ })).toBeDisabled();
    await expect(page.getByText("Loại hợp đồng không đổi được sau khi lưu")).toBeVisible();
    const save = page.getByRole("button", { name: "Lưu thay đổi" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Giá trị").fill("250.000.000");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator("[data-sonner-toast]").first()).toHaveText("Đã lưu.");
    expect(sent).toEqual([
      {
        method: "PATCH",
        path: `/pack/contracts/contracts/${ACTIVE_ID}/fields`,
        body: { version: 3, fields: { total_value: 250_000_000 } },
      },
    ]);
  });
});

test.describe("Dòng thời gian", () => {
  test("bước hiện tại đánh dấu + quá hạn đỏ; xong đúng hạn / trễ; tiến độ n/m (bỏ Nhắc gia hạn)", async ({
    page,
  }) => {
    await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    const t = timeline(page);
    await expect(t.getByTestId("stage-now")).toHaveText("Đang ở: Giao đợt 2");
    await expect(t).toContainText("2/4 mốc");
    await expect(t.getByText("Quá hạn", { exact: true }).first()).toBeVisible();
    const cur = node(page, "Giao đợt 2");
    await expect(cur).toHaveAttribute("data-state", "cur");
    await expect(cur.getByText("Bước hiện tại")).toBeVisible();
    await expect(cur).toContainText("Hạn 10/10/2026 · quá hạn 8 ngày");
    await expect(node(page, "Trả trước 50% khi ký")).toContainText("Xong 05/01/2026, đúng hạn");
    await expect(node(page, "Giao đợt 1")).toContainText("Xong 04/03/2026, trễ 3 ngày");
    await expect(node(page, "Giao đợt 1").getByText("Lỗi: Đối tác")).toBeVisible();
    await expect(node(page, "Thanh toán 50% còn lại")).toHaveAttribute("data-state", "up");
    await expect(t.locator('li[data-node="start"]')).toContainText("01/01/2026");
    await expect(t.locator('li[data-node="end"]')).toContainText("31/12/2026");
  });

  test("bút sửa chỉ ở mốc chưa xác nhận; mốc đã xác nhận giữ nguyên", async ({ page }) => {
    await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await expect(node(page, "Giao đợt 2").getByRole("button", { name: /^Sửa mốc/ })).toBeVisible();
    await expect(
      node(page, "Thanh toán 50% còn lại").getByRole("button", { name: /^Sửa mốc/ }),
    ).toBeVisible();
    await expect(
      node(page, "Trả trước 50% khi ký").getByRole("button", { name: /^Sửa mốc/ }),
    ).toHaveCount(0);
    await expect(node(page, "Giao đợt 1").getByRole("button", { name: /^Sửa mốc/ })).toHaveCount(0);
    await expect(
      node(page, "Giao đợt 1").getByRole("button", { name: "Xác nhận xong" }),
    ).toHaveCount(0);
  });

  test("«+ Thêm mốc» ⇒ POST /contracts/:id/milestones đúng thân (Giao hàng của đối tác có SL)", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await page.getByRole("button", { name: "+ Thêm mốc" }).click();
    const dlg = page.getByRole("dialog", { name: "Thêm mốc" });
    await expect(dlg.getByLabel("Loại mốc")).toHaveValue("delivery");
    await expect(dlg.getByRole("radio", { name: "Bao Bì Phương Nam" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await dlg.getByLabel(/^Tên mốc/).fill("Giao đợt 3");
    await dlg.getByLabel(/^Hạn/).fill("2026-11-15");
    await dlg.getByLabel("Số lượng giao").fill("1,5");
    await dlg.getByRole("button", { name: "Thêm mốc" }).click();
    await expect(dlg).toHaveCount(0);
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/pack/contracts/contracts/${ACTIVE_ID}/milestones`,
        body: {
          kind: "delivery",
          title: "Giao đợt 3",
          due_date: "2026-11-15",
          owner: "partner",
          qty: 1.5,
          amount: null,
        },
      },
    ]);
  });

  test("đổi loại sang Thu tiền ⇒ ô SL biến mất, ô số tiền hiện; tên đổi theo loại nếu chưa tự sửa", async ({
    page,
  }) => {
    await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await page.getByRole("button", { name: "+ Thêm mốc" }).click();
    const dlg = page.getByRole("dialog", { name: "Thêm mốc" });
    await expect(dlg.getByLabel("Số lượng giao")).toBeVisible();
    await dlg.getByLabel("Loại mốc").selectOption("collect");
    await expect(dlg.getByLabel("Số lượng giao")).toHaveCount(0);
    await expect(dlg.getByLabel("Số tiền")).toBeVisible();
    await expect(dlg.getByLabel(/^Tên mốc/)).toHaveValue("Thu tiền");
  });

  test("sửa mốc ⇒ PATCH /milestones/:id; «Xoá mốc» ⇒ DELETE", async ({ page }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await node(page, "Thanh toán 50% còn lại")
      .getByRole("button", { name: /^Sửa mốc/ })
      .click();
    const dlg = page.getByRole("dialog", { name: "Sửa mốc" });
    await dlg.getByLabel(/^Hạn/).fill("2026-12-25");
    await dlg.getByRole("button", { name: "Lưu mốc" }).click();
    await expect(dlg).toHaveCount(0);
    expect(sent.at(-1)).toMatchObject({
      method: "PATCH",
      path: "/pack/contracts/milestones/d1000000-0000-4000-8000-000000000105",
      // Số tiền để trống (chia tự động theo 5.4a) vẫn để trống: chỉ gửi giá trị người dùng đã ghi.
      body: { kind: "pay", due_date: "2026-12-25", owner: "ours", qty: null, amount: null },
    });
    await node(page, "Giao đợt 2")
      .getByRole("button", { name: /^Sửa mốc/ })
      .click();
    await page
      .getByRole("dialog", { name: "Sửa mốc" })
      .getByRole("button", { name: "Xoá mốc" })
      .click();
    await expect.poll(() => sent.at(-1)?.method).toBe("DELETE");
    expect(sent.at(-1)?.path).toBe(`/pack/contracts/milestones/${M3}`);
  });

  test("«Xác nhận xong» mốc trễ ⇒ hỏi ngày + lỗi của ai; gửi settle {at, fault}", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }).click();
    const box = page.getByTestId("confirm-box");
    await expect(box.getByLabel("Ngày hoàn thành")).toHaveValue("2026-10-18");
    await expect(box.getByText("Mốc trễ 8 ngày — lỗi của ai?")).toBeVisible();
    await box.getByRole("radio", { name: "Phía mình" }).click();
    await box.getByRole("button", { name: "Xác nhận" }).click();
    await expect(box).toHaveCount(0);
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: `/pack/contracts/obligations/${M3}/settle`,
      body: { at: "2026-10-18", fault: "ours" },
    });
  });

  test("«Xác nhận xong» đúng hạn (ngày ≤ hạn) ⇒ không hỏi lỗi, không gửi fault", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }).click();
    const box = page.getByTestId("confirm-box");
    await box.getByLabel("Ngày hoàn thành").fill("2026-10-09");
    await expect(box.getByText(/lỗi của ai/)).toHaveCount(0);
    await expect(box.getByText("Sớm 1 ngày so với hạn.")).toBeVisible();
    await box.getByRole("button", { name: "Xác nhận" }).click();
    await expect.poll(() => sent.at(-1)?.method).toBe("POST");
    expect(sent.at(-1)?.body).toEqual({ at: "2026-10-09" });
  });

  test("viewer: xem được, không có «+ Thêm mốc», bút sửa, «Xác nhận xong»", async ({ page }) => {
    await installV2f(page, { role: "viewer" });
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await expect(timeline(page)).toContainText("Giao đợt 2");
    await expect(page.getByRole("button", { name: "+ Thêm mốc" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Sửa mốc/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Xác nhận xong" })).toHaveCount(0);
  });
});

test.describe("Sản phẩm + Tóm tắt", () => {
  for (const [deal, label] of [
    ["buy", "Nhập kho"],
    ["sell", "Xuất kho"],
    ["referral", "Không ảnh hưởng kho"],
  ] as const)
    test(`nhãn kho theo loại: ${deal} ⇒ ${label}`, async ({ page }) => {
      await installV2f(page, { contract: () => activeContract({ deal }) });
      await page.goto(`/contracts/${ACTIVE_ID}`);
      const panel = page.locator("section", { hasText: "Dòng trên hợp đồng" });
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    });

  test("bảng sản phẩm có thành tiền + tổng; Tóm tắt nêu loại, đối tác, giá trị, hiệu lực, tiến độ, bước hiện tại", async ({
    page,
  }) => {
    await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await expect(page.getByTestId("products-total")).toHaveText("168.500.000");
    const s = page.getByTestId("summary");
    await expect(s).toContainText("Mua");
    await expect(s).toContainText("Bao Bì Phương Nam");
    await expect(s).toContainText("245.000.000 đ");
    await expect(s).toContainText("01/01/2026 → 31/12/2026");
    await expect(s).toContainText("2/4 mốc");
    await expect(s).toContainText("Giao đợt 2 · 10/10/2026");
  });

  test("HĐ chờ xác nhận (chưa theo dõi): không có dòng thời gian", async ({ page }) => {
    await installV2f(page, {
      contract: () => ({ ...contractAsHub("needs_review"), id: ACTIVE_ID }),
    });
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await expect(page.getByRole("heading", { name: "Thông tin hợp đồng" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dòng thời gian" })).toHaveCount(0);
    // Bước xác nhận dùng thanh Huỷ/Lưu dính như form nhập tay.
    await expect(page.getByTestId("form-bar").getByRole("button", { name: "Lưu" })).toBeVisible();
  });
});
