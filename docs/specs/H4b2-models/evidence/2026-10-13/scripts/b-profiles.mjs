// UAT H4b-2 phần B: Studio -> Models -> Profiles (tạo, Lên/Xuống, lưu, xoá, PROVIDER_IN_USE, PROFILE_IN_USE). Chạy sau a-providers.
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
import { token, api } from "./api.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const tok = await token();
const steps = () => page.getByRole("list", { name: "Các bước" }).getByRole("listitem");
const toast = () => page.getByRole("region", { name: "Notifications" });
const plist = () => page.getByRole("list", { name: "Danh sách profile" });
const choose = async (box, label) => {
  const tag = await box.evaluate((e) => e.tagName.toLowerCase());
  if (tag === "select") return box.selectOption({ label });
  await box.click();
  await page.getByRole("option", { name: label, exact: true }).click();
};
const profByKey = async (k) => (await api(tok, "GET", "/model-profiles")).body.items.find((p) => p.key === k);
const AGENT = "pb-doc-fake";
const agent = async () => (await api(tok, "GET", "/agents?limit=200")).body.items.find((a) => a.key === AGENT);

// dọn lần chạy trước
for (const k of ["uat-prof", "uat-fb"]) {
  const p = await profByKey(k);
  if (p) { for (const a of (await api(tok, "GET", "/agents?limit=200")).body.items.filter((a) => a.profile?.key === k)) { const full = (await api(tok, "GET", `/agents/${a.id}`)).body; await api(tok, "PUT", `/agents/${a.id}`, { ...strip(full), profile_id: (await profByKey("fake-1")).id, version: full.version }); } await api(tok, "DELETE", `/model-profiles/${p.id}?version=${p.version}`); }
}
function strip(a) { const { id, key, runtime, knowledge_connection_ids, created_at, updated_at, runnable, orchestrator_of, workflows, warnings, ...r } = a; return r; }

await studioLogin(page);
await page.goto("http://localhost:3200/studio/models?tab=profiles");
await step("B01", "Tab Profiles: danh sách (claude-sub-1, fake-1), mở fake-1: bước, cảnh báo 'chỉ có bước subscription', dòng 'Lúc này sẽ chạy bằng…'", async () => {
  await expect(page.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
  await expect(plist().getByRole("link", { name: "claude-sub-1" })).toBeVisible();
  await plist().getByRole("link", { name: "fake-1" }).click();
  await expect(page.getByRole("textbox", { name: "Tên profile" })).toHaveValue("fake-1");
  await expect(page.getByText("Profile này chỉ có bước subscription.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Lúc này sẽ chạy bằng bước 1 · fake-cli/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu profile" })).toBeDisabled();
  await snap(page, "01-B-profiles-fake1", true);
});
await step("B02", "Validate: tên 'A' + thiếu model ⇒ lỗi dưới ô, không gửi", async () => {
  await page.getByRole("button", { name: "+ Profile mới" }).click();
  await page.getByRole("textbox", { name: "Tên profile" }).fill("A");
  if ((await steps().count()) === 0) await page.getByRole("button", { name: "+ Thêm bước" }).click();
  await choose(steps().nth(0).getByRole("combobox", { name: "Provider" }), "fake-cli");
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(page.getByText("Bắt đầu bằng chữ thường; chỉ chữ thường, số và - (2–48 ký tự)")).toBeVisible();
  await expect(page.getByText("Nhập model")).toBeVisible();
  await snap(page, "02-B-validate");
});
await step("B03", "Tạo profile uat-prof (2 bước: fake-cli m1 → uat-fake-api m2): toast, vào danh sách", async () => {
  await page.getByRole("textbox", { name: "Tên profile" }).fill("uat-prof");
  await steps().nth(0).getByRole("textbox", { name: "Model" }).fill("m1");
  await page.getByRole("button", { name: "+ Thêm bước" }).click();
  await choose(steps().nth(1).getByRole("combobox", { name: "Provider" }), "uat-fake-api");
  await steps().nth(1).getByRole("textbox", { name: "Model" }).fill("m2");
  await snap(page, "03-B-new-filled", true);
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(toast()).toContainText("Đã lưu profile uat-prof");
  await expect(plist().getByRole("link", { name: "uat-prof" })).toBeVisible();
  await snap(page, "04-B-created", true);
});
await step("B04", "Mở uat-prof, bước 2 bấm Lên ⇒ thứ tự đổi; Lưu; tải lại vẫn giữ; API trả đúng thứ tự", async () => {
  await plist().getByRole("link", { name: "uat-prof" }).click();
  const prov = steps().getByRole("combobox", { name: "Provider" });
  await expect(prov.nth(0)).toContainText("fake-cli");
  await steps().nth(1).getByRole("button", { name: "Lên" }).click();
  await expect(prov.nth(0)).toContainText("uat-fake-api");
  await expect(prov.nth(1)).toContainText("fake-cli");
  await snap(page, "05-B-after-up", true);
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(toast()).toContainText("Đã lưu profile uat-prof");
  await expect.poll(async () => (await profByKey("uat-prof")).steps.map((s) => s.provider_key).join()).toBe("uat-fake-api,fake-cli");
  await page.reload();
  await plist().getByRole("link", { name: "uat-prof" }).click();
  await expect(prov.nth(0)).toContainText("uat-fake-api");
});
await step("B05", "Bước 1 bấm Xuống ⇒ đổi lại; Lưu; nút Lên bước đầu / Xuống bước cuối bị vô hiệu", async () => {
  const prov = steps().getByRole("combobox", { name: "Provider" });
  await expect(steps().nth(0).getByRole("button", { name: "Lên" })).toBeDisabled();
  await expect(steps().nth(1).getByRole("button", { name: "Xuống" })).toBeDisabled();
  await steps().nth(0).getByRole("button", { name: "Xuống" }).click();
  await expect(prov.nth(0)).toContainText("fake-cli");
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect.poll(async () => (await profByKey("uat-prof")).steps.map((s) => s.provider_key).join()).toBe("fake-cli,uat-fake-api");
  await snap(page, "06-B-after-down", true);
});
await step("B06", "Xoá provider uat-fake-api đang là bước của uat-prof ⇒ 'Không xoá được uat-fake-api' + badge uat-prof", async () => {
  await page.getByRole("tab", { name: "Providers" }).click();
  const row = page.getByRole("table", { name: "Danh sách provider" }).getByRole("row").filter({ hasText: "uat-fake-api" }).first();
  await row.getByRole("button", { name: "Xoá" }).click();
  await page.getByRole("alertdialog", { name: "Xoá uat-fake-api?" }).getByRole("button", { name: "Xoá" }).click();
  const b = page.getByRole("alertdialog", { name: "Không xoá được uat-fake-api" });
  await expect(b).toBeVisible();
  await expect(b).toContainText("uat-prof");
  await expect(b).toContainText("Gỡ bước, hoặc chỉ tắt provider");
  await snap(page, "07-B-provider-in-use");
  await b.getByRole("button", { name: "Đóng" }).click();
  await expect(row).toBeVisible();
});
await step("B07", "Tạo profile uat-fb (bước 1 uat-fake-api m1, bước 2 fake-cli m2) cho thử dự phòng; gắn cho agent pb-doc-fake", async () => {
  await page.getByRole("tab", { name: "Profiles" }).click();
  await page.getByRole("button", { name: "+ Profile mới" }).click();
  await page.getByRole("textbox", { name: "Tên profile" }).fill("uat-fb");
  if ((await steps().count()) === 0) await page.getByRole("button", { name: "+ Thêm bước" }).click();
  await choose(steps().nth(0).getByRole("combobox", { name: "Provider" }), "uat-fake-api");
  await steps().nth(0).getByRole("textbox", { name: "Model" }).fill("m1");
  await page.getByRole("button", { name: "+ Thêm bước" }).click();
  await choose(steps().nth(1).getByRole("combobox", { name: "Provider" }), "fake-cli");
  await steps().nth(1).getByRole("textbox", { name: "Model" }).fill("m2");
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(toast()).toContainText("Đã lưu profile uat-fb");
  // gắn cho agent (qua API Studio — màn Agents thuộc mốc H4a)
  const a = await agent(); const full = (await api(tok, "GET", `/agents/${a.id}`)).body; const fb = await profByKey("uat-fb");
  const r = await api(tok, "PUT", `/agents/${a.id}`, { ...strip(full), profile_id: fb.id, version: full.version });
  if (r.status !== 200) throw new Error("gắn profile: " + JSON.stringify(r));
  await snap(page, "08-B-uat-fb-created", true);
});
await step("B08", "Xoá profile uat-fb đang được agent dùng ⇒ 'Không xoá được uat-fb' + badge pb-doc-fake", async () => {
  await page.reload();
  await plist().getByRole("link", { name: "uat-fb" }).click();
  await page.getByRole("button", { name: "Xoá profile" }).click();
  await page.getByRole("alertdialog", { name: "Xoá uat-fb?" }).getByRole("button", { name: "Xoá" }).click();
  const b = page.getByRole("alertdialog", { name: "Không xoá được uat-fb" });
  await expect(b).toBeVisible();
  await expect(b).toContainText("pb-doc-fake");
  await snap(page, "09-B-profile-in-use");
  await b.getByRole("button", { name: "Đóng" }).click();
  await expect(plist().getByRole("link", { name: "uat-fb" })).toBeVisible();
});
await step("B09", "Xoá profile uat-prof (rảnh): xác nhận → toast 'Đã xoá profile uat-prof'", async () => {
  await plist().getByRole("link", { name: "uat-prof" }).click();
  await page.getByRole("button", { name: "Xoá profile" }).click();
  const c = page.getByRole("alertdialog", { name: "Xoá uat-prof?" });
  await expect(c).toBeVisible();
  await snap(page, "10-B-delete-confirm");
  await c.getByRole("button", { name: "Xoá" }).click();
  await expect(toast()).toContainText("Đã xoá profile uat-prof");
  await expect(plist().getByRole("link", { name: "uat-prof" })).toHaveCount(0);
  await snap(page, "11-B-deleted", true);
});
save();
await browser.close();
