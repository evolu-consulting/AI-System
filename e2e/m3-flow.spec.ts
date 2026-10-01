// ADM-FR-55 · ADM-FR-62 · ADM-FR-32 · ADM-FR-35 · ADM-FR-36 · AC-A07 · M3-AC08, M3-AC09 · luồng đầu-cuối M3 (test-plan E-M3).
// Ca 1–2: AC-A07 hai phiên (hai browser context) trên /dich: version 7 → B lưu → 8 → A lưu bị xung đột → Ghi đè thành 9 /
// Tải bản mới. Ca 3: F3 → F4 (tạo group, dán username, cấp trong ma trận, Kiểm tra quyền, "Vì sao không?" → "Cấp … cho group…").
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  conflictDialog,
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { ID, loginAdmin, loginAs, resetFixture, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const CTX = {
  baseURL: "http://localhost:3000",
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
} as const;

/** Hai phiên platform_admin cùng mở editor /dich ở version 7; B lưu trước (→ 8); A đã sửa Mô tả + thêm alias, chưa lưu. */
async function twoSessions(browser: Browser) {
  await withOwner(async (sql) => {
    await sql`update admin.commands set version = 7 where id = ${ID.command.dich}`;
  });
  const ctxA = await browser.newContext(CTX);
  const ctxB = await browser.newContext(CTX);
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];
  for (const p of [a, b]) {
    await loginAdmin(p);
    await p.goto(`/commands/${ID.command.dich}`);
    await expect(p.getByRole("textbox", { name: "Mô tả", exact: true })).toBeVisible();
  }
  await b.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả của B");
  const saved = b.waitForResponse(
    (r) => r.url().includes("/admin/commands/") && r.request().method() === "PATCH",
  );
  await b.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect(await versionOf("commands", ID.command.dich)).toBe(8);
  await a.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả của A");
  await a.getByRole("textbox", { name: "Alias" }).fill("tr2");
  await a.getByRole("button", { name: "Thêm alias" }).click();
  await a.getByRole("button", { name: "Lưu", exact: true }).click();
  return { a, ctxA, ctxB };
}

test("AC-A07 · ADM-FR-55 · M3-AC08 · hai admin cùng sửa /dich: A lưu với v7 sau khi B lưu v8 → modal 'admin vừa sửa command này … (v8). Bản của bạn dựa trên v7.'; diff chỉ có trường khác; bản B CHƯA bị ghi đè; Ghi đè → v9 là bản của A", async ({
  browser,
}) => {
  const { a, ctxA, ctxB } = await twoSessions(browser);
  try {
    await expectConflictBody(a, { entity: "command", latest: 8, mine: 7, user: "admin" });
    expect(await dbValue("commands", ID.command.dich, "description->>'vi'")).toBe("Mô tả của B");
    await expectDiff(a, {
      latest: 8,
      fields: ["description.vi", "aliases"],
      absent: ["workflow_id", "version"],
    });
    await overwrite(a, { latest: 8, user: "admin" });
    expect(await versionOf("commands", ID.command.dich)).toBe(9);
    expect(await dbValue("commands", ID.command.dich, "description->>'vi'")).toBe("Mô tả của A");
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("AC-A07 · ADM-FR-55 · hai admin cùng sửa /dich: A chọn 'Tải bản mới' → toast 'Đã tải bản mới nhất · v8', form hiện bản của B, DB vẫn v8 (bản B không bị ghi đè âm thầm); A lưu tiếp được → v9", async ({
  browser,
}) => {
  const { a, ctxA, ctxB } = await twoSessions(browser);
  try {
    await expect(conflictDialog(a)).toBeVisible();
    await reloadLatest(a, 8);
    await expect(a.getByRole("textbox", { name: "Mô tả", exact: true })).toHaveValue("Mô tả của B");
    expect(await versionOf("commands", ID.command.dich)).toBe(8);
    await a.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả A sau khi tải");
    await a.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(toast(a, /Đã lưu/)).toBeVisible();
    expect(await versionOf("commands", ID.command.dich)).toBe(9);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/** Người dùng chọn một user ở combobox "Người dùng" (RefPicker). */
async function pickUser(page: Page, username: string) {
  const box = page.getByRole("combobox", { name: "Người dùng" });
  await box.click();
  await box.fill(username);
  await page
    .getByRole("option", { name: new RegExp(`(?<![\\w.-])${username}(?![\\w.-])`) })
    .first()
    .click();
}

test("M3-AC09 · ADM-FR-62 · ADM-FR-32 · ADM-FR-35 · ADM-FR-36 · F3 → F4: tạo group 'ke-toan', dán 'lan thu an.vu', cấp Kế toán trong ma trận; Kiểm tra quyền: lan thấy /kiemtra-hoadon; an → 'Vì sao không?' → gợi ý 'Cấp Kế toán cho group…'", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    await sql`delete from admin.groups where key <> 'beta-testers'`;
  });
  await loginAs(page, "acme", "binh");
  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Groups" }).click();
  await page.getByRole("link", { name: "+ Tạo group" }).click();
  await page.getByRole("textbox", { name: "Key", exact: true }).fill("ke-toan");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Kế toán");
  await page.getByRole("button", { name: "Tạo group" }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/);
  const box = page.getByRole("textbox", { name: "Dán danh sách username" });
  await box.fill("lan thu an.vu");
  await page.getByRole("button", { name: "Thêm 3 người" }).click();
  await expect(toast(page, "Đã thêm 2 người, 1 username không tìm thấy")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Không tìm thấy: an.vu" })).toBeVisible();

  await nav.getByRole("link", { name: "Phân quyền" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Kế toán cho group Kế toán" }).check();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, /Đã lưu quyền · 1 cấp, 0 thu/)).toBeVisible();

  await page.getByRole("tab", { name: "Kiểm tra quyền", exact: true }).click();
  await pickUser(page, "lan");
  await expect(page.getByText("Thấy /kiemtra-hoadon")).toBeVisible();
  await pickUser(page, "an");
  await page.getByRole("button", { name: "Hiện command không thấy (3)" }).click();
  await page.getByRole("button", { name: "Vì sao không?" }).first().click();
  const suggest = page.getByRole("button", { name: "Cấp Kế toán cho group…" });
  await expect(suggest).toBeVisible();
  await suggest.click();
  const dialog = page.getByRole("dialog", { name: "Cấp Kế toán cho group" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
