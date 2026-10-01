// ADM-FR-55 · M3-AC08 · ConflictDialog cho Feature (editor + đổi trạng thái ở danh sách) — câu CÓ {user} (A4).
// Test-plan E-CF. Ca 1 thay ca M2 E-F.10 cũ ("Tải lại để xem bản mới nhất." đã bị ConflictDialog thay ở FE1d).
import { expect, type Page, test } from "@playwright/test";
import {
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { apiAsAdmin, ID, loginAdmin, openPage, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const KT = ID.feature.keToan;

/** Mở editor ke-toan, đổi Tên = "Kế toán A"; người kia tạo command trong feature bằng API (version feature tăng, command_ids đổi). */
async function conflictOnEditor(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto(`/features/${KT}`);
  const name = page.getByRole("textbox", { name: "Tên", exact: true });
  await expect(name).toBeVisible();
  await name.fill("Kế toán A");
  const mine = await versionOf("features", KT);
  const api = await apiAsAdmin(request);
  const created = await api.post("/admin/commands", {
    name: "dich-xung-dot",
    description: { vi: "Tạo từ phiên kia" },
    workflow_id: ID.workflow.reportTax,
    output: { field: "text", render: "text" },
    enabled: false,
    feature_ids: [KT],
  });
  expect(created.status()).toBe(201);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  return { mine, latest: mine + 1, name };
}

test("ADM-FR-55 · M3-AC08 · feature editor (thay E-F.10): ConflictDialog CÓ {user}; diff có name.vi và command_ids; DB chưa bị ghi đè; không còn chữ 'Tải lại để xem bản mới nhất.'; Ghi đè → Tên của mình", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnEditor(page, request);
  await expectConflictBody(page, { entity: "feature", latest, mine, user: "admin" });
  await expect(page.getByText("Tải lại để xem bản mới nhất.")).toHaveCount(0);
  expect(await dbValue("features", KT, "name->>'vi'")).toBe("Kế toán");
  await expectDiff(page, {
    latest,
    fields: ["name.vi", "command_ids"],
    absent: ["icon", "version"],
  });
  await overwrite(page, { latest, user: "admin" });
  expect(await dbValue("features", KT, "name->>'vi'")).toBe("Kế toán A");
});

test("ADM-FR-55 · M3-AC08 · feature danh sách: tắt ke-toan (xác nhận kill switch) khi người kia đã đổi tên → ConflictDialog (diff status); Ghi đè → status 'off'", async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  const row = page
    .getByRole("table", { name: "Features" })
    .getByRole("row")
    .filter({ hasText: "ke-toan" });
  const mine = await versionOf("features", KT);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/features/${KT}`, {
    version: mine,
    name: { vi: "Kế toán mới" },
  });
  expect(theirs.status()).toBe(200);
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Tắt", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: /Tắt Kế toán/ })
    .getByRole("button", { name: "Tắt feature" })
    .click();
  await expectConflictBody(page, { entity: "feature", latest: mine + 1, mine, user: "admin" });
  await expectDiff(page, { latest: mine + 1, fields: ["status"], absent: ["icon"] });
  await overwrite(page, { latest: mine + 1, user: "admin" });
  expect(await dbValue("features", KT, "status")).toBe("off");
});

test("ADM-FR-55 · M3-AC08 · feature editor: Tải bản mới → toast, ô Tên về 'Kế toán', DB giữ bản của người kia", async ({
  page,
  request,
}) => {
  const { latest, name } = await conflictOnEditor(page, request);
  await reloadLatest(page, latest);
  await expect(name).toHaveValue("Kế toán");
  expect(await versionOf("features", KT)).toBe(latest);
});
