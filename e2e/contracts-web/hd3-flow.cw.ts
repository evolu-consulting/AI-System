// HD-FR-36 · HD-FR-34 · S05 · Luật 4b: thẻ duyệt của contracts-web (backend giả `page.route`, không AI thật). "Xác nhận" (cấp 1)
// lưu ô đã đổi TRƯỚC rồi quyết như mgmt-app; "Duyệt" (cấp 2); "Từ chối" bắt buộc lý do; người không quyết được thấy ghi chú, không
// thấy nút; lỗi engine (người bắt đầu) hiện câu riêng. Chỉ chạy ở chế độ so (contracts-web).
import type { ContractApproval } from "@ai/contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Sent = { method: string; path: string; body: unknown };
type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function install(
  page: Page,
  state: ContractApproval,
  reply?: (body: { action: string }) => { status: number; body: unknown },
): Promise<Sent[]> {
  const sent: Sent[] = [];
  const d = asHub("editor");
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
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postDataJSON() });
    if (path.endsWith("/approval") && req.method() === "POST") {
      const out = reply?.(req.postDataJSON()) ?? { status: 200, body: approvalAsHub("done") };
      return json(r, out.status, out.body);
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
  return sent;
}

const approvalPath = `/pack/contracts/contracts/${contract.id}/approval`;

test("HD-FR-36 · cấp 1 · Xác nhận: PATCH ô đã đổi rồi POST approve, báo «Đã lưu và xác nhận hợp đồng.»", async ({
  page,
}) => {
  const sent = await install(page, approvalAsHub("level1"));
  await page.goto(`/contracts/${contract.id}`);
  // review m8 · cấp 1 hiện rõ giá trị AI đọc + trích dẫn để người xác nhận đối chiếu (kiểm soát chèn văn bản).
  const ex = page.locator("[data-approval=extracted]");
  await expect(ex).toContainText("Giá trị AI đọc được");
  await expect(ex).toContainText("“Tổng giá trị theo bảng giá đính kèm”");
  await page.getByLabel("Giá trị").fill("250.000.000");
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu và xác nhận hợp đồng.");
  expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
    [
      "PATCH",
      `/pack/contracts/contracts/${contract.id}/fields`,
      { version: 3, fields: { total_value: 250_000_000 } },
    ],
    ["POST", approvalPath, { action: "approve" }],
  ]);
});

test("HD-FR-34 · cấp 2 · Duyệt ⇒ POST approve; người bắt đầu ⇒ câu lỗi riêng, không thông điệp thô", async ({
  page,
}) => {
  const sent = await install(page, approvalAsHub("level2"), () => ({
    status: 403,
    body: {
      error: { code: "STARTER_CANNOT_REVIEW", message: "The run starter cannot review this stage" },
    },
  }));
  await page.goto(`/contracts/${contract.id}`);
  await expect(page.getByRole("button", { name: "Xác nhận" })).toHaveCount(0);
  await page.getByRole("button", { name: "Duyệt" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Bạn đã gửi hợp đồng này nên không thể duyệt bước này.",
  );
  expect(sent).toEqual([{ method: "POST", path: approvalPath, body: { action: "approve" } }]);
});

test("HD-FR-34 · Từ chối: thiếu lý do ⇒ báo, không gửi; có lý do ⇒ POST reject + feedback, «Đã từ chối hợp đồng.»", async ({
  page,
}) => {
  const sent = await install(page, approvalAsHub("level1"), () => ({
    status: 200,
    body: approvalAsHub("rejected", { feedback: "Sai đối tác" }),
  }));
  await page.goto(`/contracts/${contract.id}`);
  // ux-excel E4: "Từ chối" nằm trong menu ⋯.
  await page.getByRole("button", { name: "Thêm thao tác" }).click();
  await page.getByRole("menuitem", { name: "Từ chối" }).click();
  const form = page.locator("form[data-approval=reason]");
  await form.getByRole("button", { name: "Từ chối" }).click();
  await expect(form.getByRole("alert")).toHaveText("Vui lòng nhập lý do.");
  expect(sent).toEqual([]);
  await page.getByLabel("Lý do từ chối").fill("Sai đối tác");
  await form.getByRole("button", { name: "Từ chối" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã từ chối hợp đồng.");
  expect(sent).toEqual([
    { method: "POST", path: approvalPath, body: { action: "reject", feedback: "Sai đối tác" } },
  ]);
});

test("HD-FR-36 · không quyết được cấp 2 ⇒ ghi chú chờ, không nút Duyệt/Từ chối", async ({
  page,
}) => {
  await install(page, approvalAsHub("level2", { can_act: false }));
  await page.goto(`/contracts/${contract.id}`);
  await expect(
    page.getByText("Đang chờ Ban giám đốc duyệt (bạn không thể duyệt bước này)."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Duyệt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Từ chối" })).toHaveCount(0);
});
