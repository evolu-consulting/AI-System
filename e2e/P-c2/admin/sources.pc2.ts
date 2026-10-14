// HUB-FR-129 · HUB-FR-68 · ADM-FR-68 · PC2-R02 · PC2-R10 · P-c2 · e2e admin-web `/sources` (test-plan P-c2 §4 E01–E05; plan-frontend
// §1.1, §3, §5; mockup Pc2-Sources, Pc2-Credential): ô "Khoá nguồn" + "Chế độ áp" trong form nguồn git, tạo khoá trong dialog, bảng
// có "Riêng tư" + cột "Chế độ áp", sheet "Khoá nguồn" (khoá đang dùng ⇒ không xoá được), lỗi SOURCE_* map câu. Chưa có UI ⇒ đỏ ở
// locator `combobox "Khoá nguồn"`.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ACME } from "../../P-a/_pa-data";
import { adminLogin, PC2_E2E, seedPc2Admin, withSql } from "../_pc2-support";

test.beforeAll(() => seedPc2Admin());

const TOKEN = "github_pat_qcPC2e2eZx9Pq7Lm0000";
const table = (p: Page) => p.getByRole("table", { name: "Nguồn" });
const rowOf = (p: Page, key: string) => table(p).getByRole("row").filter({ hasText: key });
const credBox = (d: Locator) => d.getByRole("combobox", { name: "Khoá nguồn" });
const modes = (d: Locator) => d.getByRole("radiogroup", { name: "Chế độ áp" });

async function openSources(p: Page): Promise<void> {
  await adminLogin(p);
  await p
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Nguồn", exact: true })
    .click();
  await expect(table(p)).toBeVisible();
}
async function newGit(p: Page, key: string, url: string): Promise<Locator> {
  await p.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  const d = p.getByRole("dialog", { name: "Thêm nguồn" });
  await d.getByRole("textbox", { name: "Ký hiệu nguồn" }).fill(key);
  await d.getByRole("radio", { name: "Git công khai" }).click();
  await d.getByRole("textbox", { name: "Địa chỉ kho Git (https)" }).fill(url);
  await d.getByRole("textbox", { name: "Nhánh (branch)" }).fill("main");
  await d.getByRole("textbox", { name: "Mô tả" }).fill(`Nguồn e2e ${key}`);
  return d;
}

test("HUB-FR-129 · PC2-R02 · FC5 · E01 · form git: 'Khoá nguồn' có 'Không — repo công khai' + '+ Tạo khoá mới…'; 'Chế độ áp' 3 lựa chọn; host gitlab ⇒ 'Mở PR'/'Mở PR và tự gộp' tắt + gợi ý", async ({
  page: p,
}) => {
  await openSources(p);
  const d = await newGit(p, "pc2-e01", "https://github.com/pc2-e2e/e01.git");
  await credBox(d).click();
  await expect(p.getByRole("option", { name: "Không — repo công khai" })).toBeVisible();
  await expect(p.getByRole("option", { name: "+ Tạo khoá mới…" })).toBeVisible();
  await p.keyboard.press("Escape");
  for (const name of ["Mở PR", "Mở PR và tự gộp", "Chỉ nhánh"])
    await expect(modes(d).getByRole("radio", { name, exact: true })).toBeEnabled();
  await d
    .getByRole("textbox", { name: "Địa chỉ kho Git (https)" })
    .fill("https://gitlab.com/pc2-e2e/e01.git");
  await expect(modes(d).getByRole("radio", { name: "Mở PR", exact: true })).toBeDisabled();
  await expect(
    modes(d).getByRole("radio", { name: "Mở PR và tự gộp", exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByText("Chỉ GitHub (github.com) hỗ trợ mở PR. Máy chủ git khác chỉ đẩy nhánh."),
  ).toBeVisible();
});

test("HUB-FR-68 · PC2-R10 · FC2 · E02 · '+ Tạo khoá mới…' ⇒ dialog 'Tạo khoá nguồn' (Tên khoá, Token) ⇒ tự chọn khoá; 'Mở PR và tự gộp'; Lưu ⇒ dòng 'Riêng tư' + chế độ; DB lưu id khoá, không token", async ({
  page: p,
}) => {
  await openSources(p);
  const d = await newGit(p, "pc2-e02", "https://github.com/pc2-e2e/e02.git");
  await credBox(d).click();
  await p.getByRole("option", { name: "+ Tạo khoá mới…" }).click();
  const c = p.getByRole("dialog", { name: "Tạo khoá nguồn" });
  await c.getByRole("textbox", { name: "Tên khoá" }).fill("gh-e2e-pat");
  await c.getByRole("textbox", { name: "Token" }).fill(TOKEN);
  await c.getByRole("button", { name: "Lưu khoá" }).click();
  await expect(c).toHaveCount(0);
  await expect(credBox(d)).toContainText("gh-e2e-pat");
  await modes(d).getByRole("radio", { name: "Mở PR và tự gộp", exact: true }).click();
  await d.getByRole("button", { name: "Lưu", exact: true }).click();
  const row = rowOf(p, "pc2-e02");
  await expect(row).toContainText("Riêng tư");
  await expect(row).toContainText("Mở PR và tự gộp");
  await expect(p.getByText(TOKEN)).toHaveCount(0);
  const [src] = await withSql(
    (sql) => sql`select s.config, k.id as cred from hub.sources s
      left join hub.secrets k on k.name = 'gh-e2e-pat' and k.tenant_id = ${ACME}
      where s.key = 'pc2-e02' and s.tenant_id = ${ACME}`,
  );
  expect({ cred: src?.config?.credential_secret_id, mode: src?.config?.apply_mode }).toEqual({
    cred: src?.cred,
    mode: "auto_merge",
  });
  expect(JSON.stringify(src?.config ?? {})).not.toContain(TOKEN);
});

test("HUB-FR-129 · FC7 · E03 · bảng: nguồn local_path hiện chế độ 'Chỉ nhánh'; nguồn có khoá 'pc2-used' có nhãn 'Riêng tư'; cột 'Chế độ áp'", async ({
  page: p,
}) => {
  await openSources(p);
  await expect(
    table(p).getByRole("columnheader", { name: "Chế độ áp", exact: true }),
  ).toBeVisible();
  await expect(rowOf(p, "pc2-local")).toContainText("Chỉ nhánh");
  await expect(rowOf(p, "pc2-used")).toContainText("Riêng tư");
  await expect(rowOf(p, "pc2-repo")).not.toContainText("Riêng tư");
});

test("HUB-FR-68 · PC2-R10 · E04 · sheet 'Khoá nguồn': khoá đang dùng ⇒ 'Xoá khoá' tắt + câu đang dùng; 'Thay token' ⇒ ô 'Token mới', 'Lưu' tắt tới khi nhập", async ({
  page: p,
}) => {
  await openSources(p);
  await p.getByRole("button", { name: "Khoá nguồn", exact: true }).click();
  const sheet = p.getByRole("dialog", { name: "Khoá nguồn" });
  await expect(sheet.getByRole("button", { name: "Tạo khoá" })).toBeVisible();
  const row = sheet
    .getByRole("listitem")
    .filter({ hasText: "gh-e2e-used" })
    .or(sheet.getByRole("row").filter({ hasText: "gh-e2e-used" }));
  await expect(row.getByRole("button", { name: "Xoá khoá" })).toBeDisabled();
  await expect(
    sheet.getByText(
      "Khoá đang được 1 nguồn dùng nên chưa xoá được. Gỡ khoá khỏi các nguồn đó trước.",
    ),
  ).toBeVisible();
  await row.getByRole("button", { name: "Thay token" }).click();
  const tokenBox = p.getByRole("textbox", { name: "Token mới" });
  await expect(tokenBox).toBeVisible();
  const save = p.getByRole("button", { name: "Lưu", exact: true }).last();
  await expect(save).toBeDisabled();
  await tokenBox.fill("github_pat_qcPC2e2eRotateZx9");
  await expect(save).toBeEnabled();
  expect(PC2_E2E.credUsed).toBeTruthy();
});

test("HUB-FR-129 · PC2-R10 · PC2-R02 · E05 · 422 SOURCE_CREDENTIAL_INVALID / SOURCE_APPLY_UNSUPPORTED ⇒ alert câu nguyên văn ở form", async ({
  page: p,
}) => {
  let codeName = "SOURCE_CREDENTIAL_INVALID";
  await p.route(/\/admin\/sources(\?.*)?$/, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const path =
      codeName === "SOURCE_CREDENTIAL_INVALID"
        ? "config.credential_secret_id"
        : "config.apply_mode";
    return route.fulfill({
      status: 422,
      json: { error: { code: codeName, message: "mock", details: { path } } },
    });
  });
  await openSources(p);
  const d = await newGit(p, "pc2-e05", "https://github.com/pc2-e2e/e05.git");
  await d.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    p
      .getByRole("alert")
      .filter({ hasText: "Khoá nguồn không dùng được. Chọn khoá khác của công ty này." }),
  ).toBeVisible();
  codeName = "SOURCE_APPLY_UNSUPPORTED";
  await d.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    p
      .getByRole("alert")
      .filter({ hasText: 'Máy chủ git này chưa hỗ trợ mở PR. Chọn "Chỉ nhánh".' }),
  ).toBeVisible();
});
