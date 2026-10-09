// UAT CR-054 — Evolu Control: trang Agents (tenant_admin julian.bui + platform_admin).
import { chromium, expect, ADMIN, PW, platformCreds, makeRunner, login, ensureVi } from "./lib.mjs";

const OUT = process.argv[2];
const R = makeRunner(OUT, "admin");
const b = await chromium.launch();
const mk = () => b.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
const ctxA = await mk(), ctxB = await mk();
const A = await ctxA.newPage(), B = await ctxB.newPage();
R.pages.push(A, B);
const row = (p, key) => p.getByRole("row").filter({ hasText: `@${key}` });
const sw = (p, name) => p.getByRole("switch", { name: `Bật ${name} cho công ty` });
const notes = {};

await R.step("01", "julian.bui (tenant_admin) mở trang Agents: chỉ agent của evolu, đúng 1 mặc định, model thật, công tắc khoá", async () => {
  await login(A, ADMIN, "evolu", "julian.bui", PW, (u) => !u.pathname.startsWith("/login"));
  await ensureVi(A);
  await A.goto(`${ADMIN}/agents`);
  await expect(A.getByRole("heading", { level: 2, name: "Agent của công ty" })).toBeVisible();
  await expect(A.getByRole("row").filter({ hasText: "@" }).first()).toBeVisible({ timeout: 20000 });
  const rows = await A.getByRole("row").filter({ hasText: "@" }).allInnerTexts();
  notes.julianRows = rows.map((r) => r.replace(/\s+/g, " ").trim());
  await R.snap(A, "01-A-julian-agents");
  expect(await A.getByRole("table").getByText("★ Mặc định").count()).toBe(1);
  await expect(row(A, "consultant")).toBeVisible();
  await expect(row(A, "invoices")).toBeVisible();
  // model thật, không rỗng
  const txt = notes.julianRows.join("\n");
  expect(txt).toMatch(/haiku/i);
  expect(txt).toMatch(/sonnet/i);
  // công tắc khoá
  for (const s of await A.getByRole("switch").all()) await expect(s).toHaveAttribute("aria-disabled", "true");
  notes.julianOrchestratorRows = notes.julianRows.filter((r) => /Điều phối|Orchestrator/.test(r)).length;
  // chỉ 1 Orchestrator (không lộ của tenant khác)
  expect(notes.julianOrchestratorRows).toBe(1);
});

await R.step("02", "julian bấm công tắc bật/tắt: không đổi được", async () => {
  const s = sw(A, "Invoices");
  const before = await s.getAttribute("aria-checked");
  await s.click({ force: true });
  await A.waitForTimeout(1200);
  expect(await s.getAttribute("aria-checked")).toBe(before);
  await R.snap(A, "02-A-julian-switch-locked");
});

const pc = platformCreds();
await R.step("03", "platform_admin đăng nhập, mở Agents, chọn tenant evolu", async () => {
  await login(B, ADMIN, "platform", pc.user, pc.pass, (u) => !u.pathname.startsWith("/login"));
  await ensureVi(B);
  await B.goto(`${ADMIN}/agents`);
  await B.getByRole("combobox", { name: "Tenant" }).click();
  await B.getByRole("option", { name: "evolu", exact: true }).click();
  await expect(row(B, "consultant")).toBeVisible({ timeout: 20000 });
  await R.snap(B, "03-B-platform-agents-evolu");
  expect(await B.getByRole("table").getByText("★ Mặc định").count()).toBe(1);
  notes.platformRows = (await B.getByRole("row").filter({ hasText: "@" }).allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
  await expect(sw(B, "Invoices")).not.toHaveAttribute("aria-disabled", "true");
});

await R.step("04", "Tắt rồi bật lại entitlement của invoices", async () => {
  const s = sw(B, "Invoices");
  await expect(s).toBeChecked();
  await s.click();
  await expect(B.getByText("Đã tắt Invoices cho công ty.")).toBeVisible();
  await expect(s).not.toBeChecked();
  await R.snap(B, "04-B-invoices-off");
  await s.click();
  await expect(B.getByText("Đã bật Invoices cho công ty.")).toBeVisible();
  await expect(s).toBeChecked();
  await R.snap(B, "04-B-invoices-on");
});

await R.step("05", "Tắt entitlement agent mặc định (Orchestrator): bị chặn (409)", async () => {
  const orchRow = B.getByRole("row").filter({ hasText: "@orchestrator" });
  const s = orchRow.getByRole("switch");
  const disabled = await s.isDisabled();
  notes.defaultSwitchDisabled = disabled;
  if (!disabled) {
    await s.click();
    await expect(B.getByText(/Không tắt được agent đang là mặc định/)).toBeVisible({ timeout: 10000 });
    await expect(s).toBeChecked();
  }
  await R.snap(B, "05-B-default-entitle-blocked");
});

await R.step("06", "Đặt consultant làm mặc định rồi trả Orchestrator", async () => {
  await row(B, "consultant").getByRole("button", { name: /Đặt mặc định/ }).click();
  await expect(B.getByText("Đã đặt Evolu Consultant làm agent mặc định.")).toBeVisible();
  await expect(row(B, "consultant")).toContainText("★ Mặc định");
  expect(await B.getByRole("table").getByText("★ Mặc định").count()).toBe(1);
  await R.snap(B, "06-B-consultant-default");
  await B.reload();
  await expect(row(B, "consultant")).toContainText("★ Mặc định");
  // Orchestrator hiện lại nút Đặt mặc định
  await B.getByRole("button", { name: /Đặt mặc định · Điều phối/ }).click();
  await expect(B.getByText("Đã đặt Điều phối làm agent mặc định.")).toBeVisible();
  await expect(row(B, "orchestrator")).toContainText("★ Mặc định");
  await R.snap(B, "06-B-orchestrator-default-back");
});

await R.step("07", "Chọn fallback / on_no_match (Hỏi lại, Tự trả lời), rồi khôi phục dự phòng = Evolu Consultant", async () => {
  const dr = B.getByRole("row").filter({ hasText: "@orchestrator" });
  const cb = dr.getByRole("combobox");
  // Sau bước 06 (consultant → Orchestrator) dự phòng cũ mất theo thiết kế: về "Tự trả lời".
  notes.nomatchAfterStep06 = await cb.innerText();
  await cb.click();
  notes.noMatchOptions = await B.getByRole("option").allInnerTexts();
  await R.snap(B, "07-B-nomatch-options");
  await B.getByRole("option", { name: "Hỏi lại người dùng" }).click();
  await expect(B.getByText("Đã lưu cách xử lý khi không khớp agent nào.")).toBeVisible();
  await expect(cb).toContainText("Hỏi lại người dùng");
  await R.snap(B, "07-B-nomatch-ask");
  await cb.click();
  await B.getByRole("option", { name: "Tự trả lời" }).click();
  await expect(cb).toContainText("Tự trả lời");
  await cb.click();
  await B.getByRole("option", { name: "Evolu Consultant" }).click();
  await expect(cb).toContainText("Evolu Consultant");
  await R.snap(B, "07-B-nomatch-restored");
});

await R.step("08", "Ngăn Cấp quyền có kiểu 'Cả công ty' (chỉ xem, Huỷ)", async () => {
  await B.getByRole("button", { name: /Cấp quyền · Invoices/ }).click();
  const dlg = B.getByRole("dialog");
  await expect(dlg.getByText("Cả công ty").first()).toBeVisible();
  await R.snap(B, "08-B-grant-sheet");
  await dlg.getByRole("button", { name: "Huỷ" }).click();
});

await R.step("09", "Xác minh trạng thái evolu đã khôi phục sau tải lại", async () => {
  await B.reload();
  await expect(row(B, "orchestrator")).toContainText("★ Mặc định", { timeout: 20000 });
  expect(await B.getByRole("table").getByText("★ Mặc định").count()).toBe(1);
  await expect(row(B, "orchestrator").getByRole("combobox")).toContainText("Evolu Consultant");
  await expect(sw(B, "Invoices")).toBeChecked();
  await expect(sw(B, "Evolu Consultant")).toBeChecked();
  await R.snap(B, "09-B-final-restored");
});

R.finish();
import { writeFileSync } from "node:fs";
writeFileSync(`${OUT}/notes-admin.json`, JSON.stringify(notes, null, 2));
await b.close();
console.log(`DONE ${R.log.filter((x) => x.ok).length}/${R.log.length}`);
