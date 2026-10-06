// HUB-FR-60 · HUB-FR-61 · HUB-FR-64 · H4a-AC-02, AC-04, AC-06 · H4a-R05, R09, R11 · plan-frontend §3, §6 · test-plan H4a §3
// E06–E11: danh sách agent (runtime, badge Orchestrator / Chưa cấp, không cột 24 giờ), editor agentic-cli với tick Bash bắt
// buộc xác nhận, xung đột phiên bản hai tab (ConflictDialog, không đè), picker workflow chỉ catalog bật.
import { expect, test } from "@playwright/test";
import { ID, isStudioWrite, mockStudio, openAuthed, seedStore } from "./_support";

const table = (page: import("@playwright/test").Page) =>
  page.getByRole("table", { name: "Danh sách agent" });
const row = (page: import("@playwright/test").Page, key: string) =>
  table(page).getByRole("row").filter({ hasText: key });

test("HUB-FR-60 · E06 · danh sách: mỗi agent seed một dòng đúng runtime; badge Orchestrator ở `orchestrator`; Chưa cấp ở agent 0 tenant; không cột 24 giờ [H4a-AC-02 · H4a-R11]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  for (const [key, rt] of [
    ["orchestrator", "agentic-cli"],
    ["hoadon", "agentic-cli"],
    ["helper", "llm"],
    ["dify-tom", "dify-workflow"],
  ] as const)
    await expect(row(page, key)).toContainText(rt);
  await expect(row(page, "orchestrator")).toContainText("Orchestrator");
  await expect(row(page, "hoadon")).not.toContainText("Orchestrator");
  await expect(row(page, "helper")).toContainText("Chưa cấp");
  await expect(row(page, "hoadon")).not.toContainText("Chưa cấp");
  await expect(table(page).getByRole("columnheader", { name: /24/ })).toHaveCount(0);
});

test("HUB-FR-60 · E07 · công tắc + Xoá của agent đang là Orchestrator bị khoá; tìm `dify` chỉ còn dify-tom [H4a-R06 · H4a-R11]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  await expect(page.getByRole("switch", { name: "Bật orchestrator" })).toBeDisabled();
  await page.getByRole("searchbox", { name: "Tìm agent" }).fill("dify");
  await expect(table(page).getByRole("row").filter({ hasText: "dify-tom" })).toHaveCount(1);
  await expect(table(page).getByRole("row").filter({ hasText: "hoadon" })).toHaveCount(0);
});

test("HUB-FR-61 · E08 · tạo agentic-cli tick Bash: chưa tick xác nhận ⇒ không gửi, báo lỗi trường; tick xác nhận ⇒ POST có bash_ack=true [H4a-AC-06 · H4a-R05]", async ({
  page,
}) => {
  const s = await mockStudio(page, { session: true });
  await openAuthed(page, "/agents/new");
  await expect(page.getByRole("heading", { name: "Tạo agent" })).toBeVisible();
  await page.getByRole("textbox", { name: "Key" }).fill("qc-bash-ui");
  await page.getByRole("textbox", { name: "Tên hiển thị (VI)" }).fill("Agent Bash");
  await page.getByRole("textbox", { name: "Tên hiển thị (EN)" }).fill("Bash agent");
  await page
    .getByRole("textbox", { name: "Mô tả cho Orchestrator" })
    .fill("Chạy lệnh hệ thống để kiểm tra máy Worker khi được yêu cầu.");
  await page
    .getByRole("radiogroup", { name: "Runtime" })
    .getByRole("radio", { name: "agentic-cli" })
    .check();
  await page.getByRole("combobox", { name: "Model profile" }).click();
  await page.getByRole("option", { name: /fake-1/ }).click();
  await page.getByRole("checkbox", { name: "Bash" }).check();
  const ack = page.getByRole("checkbox", {
    name: "Tôi hiểu agent chạy được lệnh hệ thống trên máy Worker",
  });
  await expect(ack).toBeVisible();

  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(ack).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Xác nhận bạn hiểu rủi ro khi bật Bash")).toBeVisible();
  expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(0);

  await ack.check();
  const post = page.waitForRequest((r) => isStudioWrite(r) && r.method() === "POST");
  await page.getByRole("button", { name: "Lưu" }).click();
  const body = (await post).postDataJSON();
  expect(body).toMatchObject({
    key: "qc-bash-ui",
    runtime: "agentic-cli",
    bash_ack: true,
    profile_id: ID.profFake,
  });
  expect(body.runtime_options.allowed_tools).toContain("Bash");
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(
    "Đã lưu agent · hub config v8",
  );
});

test("HUB-FR-64 · E09 · picker workflow: chỉ workflow từ catalog (bật); gắn `tom` ⇒ hiện trong danh sách gắn + nút Gỡ tom [H4a-AC-05 · H4a-R04]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents/new");
  await page.getByRole("button", { name: "+ Gắn workflow từ catalog" }).click();
  const dlg = page.getByRole("dialog", { name: "Chọn workflow từ catalog" });
  await expect(dlg).toContainText("tom");
  await expect(dlg).toContainText("dich");
  await expect(dlg).not.toContainText("tat");
  await dlg.getByRole("checkbox", { name: /tom/ }).check();
  await dlg.getByRole("button", { name: "Gắn" }).click();
  await expect(page.getByRole("button", { name: "Gỡ tom" })).toBeVisible();
});

test('HUB-FR-69 · E10 · hai tab cùng sửa `hoadon`: tab 1 lưu (v2), tab 2 lưu bản cũ ⇒ 409 ⇒ modal "Có người vừa lưu bản mới hơn"; dữ liệu tab 1 giữ nguyên [H4a-AC-04 · H4a-R09]', async ({
  browser,
}) => {
  const store = seedStore();
  const ctx = await browser.newContext();
  const t1 = await ctx.newPage();
  const t2 = await ctx.newPage();
  await mockStudio(t1, { session: true, store });
  await mockStudio(t2, { session: true, store });
  await openAuthed(t1, `/agents/${ID.hoadon}`);
  await openAuthed(t2, `/agents/${ID.hoadon}`);
  await expect(t1.getByRole("textbox", { name: "Key" })).toHaveValue("hoadon");
  await expect(t2.getByRole("textbox", { name: "Key" })).toHaveValue("hoadon");

  await t1.getByRole("textbox", { name: "System prompt" }).fill("Bản của tab 1");
  const put1 = t1.waitForResponse(
    (r) => isStudioWrite(r.request()) && r.request().method() === "PUT",
  );
  await t1.getByRole("button", { name: "Lưu" }).click();
  expect((await put1).status()).toBe(200);

  await t2.getByRole("textbox", { name: "System prompt" }).fill("Bản của tab 2");
  const put2 = t2.waitForResponse(
    (r) => isStudioWrite(r.request()) && r.request().method() === "PUT",
  );
  await t2.getByRole("button", { name: "Lưu" }).click();
  expect((await put2).status()).toBe(409);
  const dlg = t2.getByRole("alertdialog", { name: "Có người vừa lưu bản mới hơn" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Tải bản mới" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Ghi đè" })).toBeVisible();
  expect(store.agents.find((a) => a.id === ID.hoadon)?.system_prompt).toBe("Bản của tab 1");

  await dlg.getByRole("button", { name: "Tải bản mới" }).click();
  await expect(t2.getByRole("textbox", { name: "System prompt" })).toHaveValue("Bản của tab 1");
  await ctx.close();
});

test("HUB-FR-60 · E11 · sửa agent: Key readonly; nút Chạy thử disabled (Sắp có H4c) [plan-frontend §3 · QB5]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, `/agents/${ID.hoadon}`);
  await expect(page.getByRole("heading", { name: "Sửa agent" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Key" })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Chạy thử" })).toBeDisabled();
});
