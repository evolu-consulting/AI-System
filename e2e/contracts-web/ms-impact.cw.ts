// MS-impact · CR-101b · Luật 4b: hộp «Xác nhận xong» hiện tác động THẬT do máy chủ tính (`GET /obligations/:id/impact` theo ngày + lỗi):
// uy tín trước → sau, lỗi «Chưa rõ» ⇒ nhắc xác minh; dòng thời gian đọc `rep_delta`. Phụ: banner «Pháp lý» (`legal_warning`) chỉ cảnh
// báo. Backend giả `page.route`; chờ phần tử/yêu cầu, không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const M3 = "d1000000-0000-4000-8000-000000000103";
const node = (page: import("@playwright/test").Page, title: string) =>
  page.locator('li[data-node="milestone"]', { hasText: title });

test("xác nhận mốc trễ: tác động theo lỗi đang chọn (đối tác trừ điểm; chưa rõ ⇒ nhắc xác minh)", async ({
  page,
}) => {
  await installV2f(page);
  const asked: string[] = [];
  await page.route("**/pack/contracts/obligations/*/impact*", (r) => {
    const u = new URL(r.request().url());
    const fault = u.searchParams.get("fault");
    asked.push(`${u.searchParams.get("actual_on")}|${fault}`);
    const after = fault === "partner" ? { score: 72, level: "fair" } : { score: 88, level: "good" };
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        obligation_id: M3,
        at: u.searchParams.get("actual_on"),
        late: 8,
        fault,
        reputation: {
          engine: "v2e",
          role: "supplier",
          party: "tax:0312345678",
          before: { score: 88, level: "good" },
          after,
          counted: true,
          pending_fault: fault === "unknown",
        },
        stock: [
          {
            component_id: "c1000000-0000-4000-8000-000000000001",
            name: "Thùng carton",
            before: "120",
            after: "170",
          },
        ],
        debt: null,
      }),
    });
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }).click();
  const box = page.getByTestId("confirm-box");
  await expect(box.getByTestId("impact-rep")).toContainText("88 TỐT → 72 KHÁ");
  await expect(box.getByTestId("impact-stock")).toHaveText("Kho Thùng carton: 120 → 170");
  await box.getByRole("radio", { name: "Chưa rõ" }).click();
  await expect(box.getByTestId("impact-pending")).toBeVisible();
  await expect(box.getByTestId("impact-rep")).toContainText("88 TỐT → 88 TỐT");
  expect(asked).toEqual(["2026-10-18|partner", "2026-10-18|unknown"]);
});

test("dòng thời gian: mốc đã xác nhận đọc delta máy chủ «a → b»; HĐ có cảnh báo pháp lý ⇒ banner chỉ cảnh báo", async ({
  page,
}) => {
  await installV2f(page, {
    contract: () => {
      const c = activeContract() as {
        milestones: { title: string; rep_delta?: unknown }[];
        legal_warning?: unknown;
      };
      const delta = {
        engine: "v2e",
        role: "supplier",
        before: { score: 90, level: "good" },
        after: { score: 84, level: "fair" },
      };
      return {
        ...c,
        milestones: c.milestones.map((m) =>
          m.title === "Giao đợt 1" ? { ...m, rep_delta: delta } : m,
        ),
        legal_warning: { threshold: 5_000_000, reason: "standalone_deal" },
      };
    },
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(node(page, "Giao đợt 1").locator("[data-points]")).toHaveText("90 → 84");
  const legal = page.getByTestId("legal-warning");
  await expect(legal).toContainText("Pháp lý");
  await expect(legal).toContainText("Cần kế toán xác nhận.");
  await expect(legal).toContainText("5.000.000");
  // Chỉ cảnh báo: vẫn xác nhận mốc được.
  await expect(
    node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }),
  ).toBeVisible();
});
