// HUB-FR-60 · HUB-FR-62 · HUB-FR-72 · H4a-R07, R09, R12 · QF3 · plan-frontend §3 "Hành vi chi tiết", §6
// E12 Nhân bản, E13/E13b Đặt làm Orchestrator, E15 Hoàn tác tắt agent, E16 banner mất mạng.
import { expect, type Page, test } from "@playwright/test";
import { ID, isStudioWrite, mockStudio, openAuthed } from "./_support";

const table = (page: Page) => page.getByRole("table", { name: "Danh sách agent" });
const row = (page: Page, key: string) => table(page).getByRole("row").filter({ hasText: key });
const menu = (page: Page, key: string) =>
  page.getByRole("button", { name: `Thao tác ${key}` }).click();

test("HUB-FR-60 · E12 · Nhân bản `hoadon`: sang /agents/new?from=<id>, Key trống, tên có (bản sao), agent tắt, mô tả giữ nguyên, chưa ghi gì [H4a-R12]", async ({
  page,
}) => {
  const s = await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  await menu(page, "hoadon");
  await page.getByRole("menuitem", { name: "Nhân bản" }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/agents/new\\?from=${ID.hoadon}$`));
  await expect(page.getByRole("heading", { name: "Tạo agent" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Key" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Tên hiển thị (VI)" })).toHaveValue(
    "Tên hoadon (bản sao)",
  );
  await expect(page.getByRole("textbox", { name: "Mô tả cho Orchestrator" })).toHaveValue(
    "Agent hoadon dùng cho kiểm thử giao diện Studio.",
  );
  await expect(page.getByRole("switch", { name: "Bật agent" })).not.toBeChecked();
  expect(s.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
});

test("HUB-FR-62 · E13 · `⋯` → Đặt làm Orchestrator (hoadon): huỷ ⇒ không ghi; xác nhận ⇒ PUT /orchestrator/default {agent_id=hoadon, version=1}, badge Orchestrator chuyển sang hoadon [H4a-QF3 · H4a-R07]", async ({
  page,
}) => {
  const s = await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  await menu(page, "hoadon");
  await page.getByRole("menuitem", { name: "Đặt làm Orchestrator" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("mặc định");
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await expect(dlg).toBeHidden();
  expect(s.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

  await menu(page, "hoadon");
  await page.getByRole("menuitem", { name: "Đặt làm Orchestrator" }).click();
  const put = page.waitForRequest((r) => isStudioWrite(r) && r.method() === "PUT");
  await page.getByRole("alertdialog").getByRole("button", { name: "Đặt làm Orchestrator" }).click();
  const req = await put;
  expect(new URL(req.url()).pathname).toMatch(/\/studio\/api\/orchestrator\/default$/);
  expect(req.postDataJSON()).toMatchObject({ agent_id: ID.hoadon, version: 1 });
  await expect(row(page, "hoadon").getByText("Orchestrator", { exact: true })).toBeVisible();
  await expect(row(page, "orchestrator").getByText("Orchestrator", { exact: true })).toHaveCount(0);
});

test("HUB-FR-62 · E13b · agent runtime dify-workflow (dify-tom): menu `⋯` không cho Đặt làm Orchestrator (vắng hoặc disabled) [H4a-QB1 · plan-frontend §3]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  await menu(page, "dify-tom");
  await expect(page.getByRole("menuitem", { name: "Nhân bản" })).toBeVisible();
  const item = page.getByRole("menuitem", { name: "Đặt làm Orchestrator" });
  if ((await item.count()) > 0) await expect(item).toBeDisabled();
});

test("HUB-FR-60 · E15 · tắt `hoadon` ⇒ PATCH enabled=false + toast kèm Hoàn tác; Hoàn tác ⇒ PATCH enabled=true với version mới (2), công tắc bật lại [H4a-R09 · plan-frontend §3]", async ({
  page,
}) => {
  const s = await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  const sw = page.getByRole("switch", { name: "Bật hoadon" });
  await expect(sw).toBeChecked();
  await sw.click();
  const toast = page.getByRole("region", { name: "Notifications" });
  await expect(toast).toContainText("Đã tắt Tên hoadon. Orchestrator sẽ không còn chọn agent này.");
  await expect(sw).not.toBeChecked();
  const patches = () => s.calls.filter((c) => c.method === "PATCH");
  expect(patches()).toHaveLength(1);
  expect(patches()[0]?.body).toMatchObject({ enabled: false, version: 1 });

  await toast.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(sw).toBeChecked();
  expect(patches()).toHaveLength(2);
  expect(patches()[1]?.body).toMatchObject({ enabled: true, version: 2 });
  expect(s.agents.find((a) => a.id === ID.hoadon)?.enabled).toBe(true);
});

test("HUB-FR-72 · E16 · mất mạng ở màn Agents ⇒ banner `Mất kết nối, thay đổi chưa được lưu`; có mạng lại ⇒ banner mất [plan-frontend §3 offline]", async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  const banner = page.getByText("Mất kết nối, thay đổi chưa được lưu");
  await expect(banner).toHaveCount(0);
  await page.context().setOffline(true);
  await expect(banner).toBeVisible();
  await page.context().setOffline(false);
  await expect(banner).toHaveCount(0);
});
