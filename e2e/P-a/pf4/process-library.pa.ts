// CR-105 · L3 `pl-editor-ui` · e2e P-a PF4: platform_admin nhân bản "Quy trình HĐ mặc định", sửa ở Form, xuất bản, gán cho tenant acme
// ⇒ cột "Tenant đang dùng" tăng; Canvas hiện nút hệ thống (contracts-route/contracts-finalize) với huy hiệu "Hệ thống", không xoá được.
// Chỉ chạy được khi backend L1/L2a/L2b đã gộp (seed 0069: def "Quy trình HĐ mặc định" + khe contracts.approval). KHÔNG chạy trong lát.
import { expect, type Page, test } from "@playwright/test";
import { seedAdmin } from "../../support/helpers";
import { ACME, ADMIN_URL, settle, withSql } from "../_pa-support";

test.afterEach(() => settle());

async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Số trong ô "Tenant đang dùng" của dòng quy trình `name` (ô cuối cùng trước "Cập nhật" — đọc theo tên cột). */
async function tenantsUsing(p: Page, name: string): Promise<number> {
  const table = p.getByRole("table", { name: "Quy trình" });
  const col = (await table.getByRole("columnheader").allInnerTexts()).findIndex((h) =>
    h.includes("Tenant đang dùng"),
  );
  expect(col, "có cột Tenant đang dùng").toBeGreaterThanOrEqual(0);
  const cell = table.getByRole("row").filter({ hasText: name }).first().getByRole("cell").nth(col);
  return Number.parseInt((await cell.innerText()).trim(), 10);
}

test("sửa Form, xuất bản, gán tenant, canvas khoá nút hệ thống", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await platformLogin(p);
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();

    // danh sách thư viện: có cột "Dùng cho" + nhãn mặc định; mẫu chạy thử nằm ở tab riêng
    await expect(p.getByRole("tab", { name: "Thư viện" })).toBeVisible();
    await expect(p.getByRole("tab", { name: /Mẫu · chạy thử/ })).toBeVisible();
    const table = p.getByRole("table", { name: "Quy trình" });
    await expect(table.getByRole("columnheader", { name: "Dùng cho" })).toBeVisible();
    const base = table.getByRole("row").filter({ hasText: "Quy trình HĐ mặc định" }).first();
    await expect(base.getByText("Mặc định · Sổ Hợp Tác · Duyệt hợp đồng")).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "sdlc" })).toHaveCount(0); // mẫu không lẫn

    // Nhân bản ⇒ mở nháp mới
    await base.getByRole("button", { name: "Nhân bản" }).click();
    await expect(p.getByText("Đã nhân bản thành bản nháp mới")).toBeVisible();
    const toolbar = p.getByTestId("library-toolbar");
    await expect(toolbar.getByText("Chưa xuất bản")).toBeVisible();
    const name = (await p.getByRole("heading", { level: 1 }).innerText()).trim();

    // Canvas: bước duyệt (cũng là stage gọi contracts-route) KHÔNG khoá ⇒ sửa tên + hạn, Lưu ⇒ Hub dựng lại slot_body từ stages
    const canvas = p.getByRole("application", { name: "Canvas quy trình" });
    await canvas.getByRole("button", { name: /^Giai đoạn 3: Duyệt cấp 2/ }).click();
    const slotForm = p.getByTestId("slot-stage-form");
    await slotForm.getByRole("textbox", { name: "Tên bước" }).fill("Duyệt cấp 2 (canvas)");
    await slotForm.getByRole("spinbutton", { name: "Hạn quyết (giờ)" }).fill("24");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(p.getByText(/Đã lưu · v\d+/)).toBeVisible();
    const defId = new URL(p.url()).pathname.split("/").filter(Boolean).at(-1) ?? "";
    const draftSteps = () =>
      withSql(
        async (sql) =>
          (await sql`select slot_body->'steps' as s from hub.process_defs where id = ${defId}`)[0]
            ?.s as { name: string; due_h: number; department_group_key: string }[],
      );
    expect((await draftSteps())[1]).toMatchObject({ name: "Duyệt cấp 2 (canvas)", due_h: 24 });

    // Canvas: thêm một bước duyệt tuần tự (Thêm giai đoạn) với mã phòng ban ⇒ Lưu ⇒ slot_body có 3 bước
    await p.getByRole("button", { name: "Thêm giai đoạn", exact: true }).click();
    await slotForm.getByRole("textbox", { name: "Tên bước" }).fill("Pháp chế (canvas)");
    await slotForm
      .getByRole("combobox", { name: "Mã phòng ban", exact: true })
      .fill("contracts-owner");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(p.getByText(/Đã lưu · v\d+/)).toBeVisible();
    const three = await draftSteps();
    expect(three.map((s) => s.name)).toEqual([
      "Kiểm tra hợp đồng",
      "Duyệt cấp 2 (canvas)",
      "Pháp chế (canvas)",
    ]);
    expect(three[2]?.department_group_key).toBe("contracts-owner");

    // Form hiện đúng 3 bước vừa lưu từ Canvas (vòng đi–về giữ chỉnh sửa)
    await toolbar.getByRole("button", { name: "Form", exact: true }).click();
    await expect(
      p.getByTestId("flow-step-2").getByRole("textbox", { name: "Tên bước" }),
    ).toHaveValue("Pháp chế (canvas)");
    await toolbar.getByRole("button", { name: "Canvas", exact: true }).click();
    // Xuất bản (hiện tác động) ⇒ "Đã xuất bản v1"
    await toolbar.getByRole("button", { name: "Xuất bản", exact: true }).click();
    const pub = p.getByRole("dialog");
    await expect(pub.getByTestId("publish-impact")).toContainText("tenant đang dùng");
    await pub.getByRole("button", { name: "Xuất bản", exact: true }).click();
    await expect(toolbar.getByText(/Đã xuất bản v\d+/)).toBeVisible();
    // bản xuất bản v1 mang đúng nội dung đã sửa trên Canvas (áp cho lượt duyệt mới)
    const rel = await withSql(
      async (sql) =>
        (
          await sql`select slot_body->'steps' as s from hub.process_def_releases
            where def_id = ${defId} and rel_version = 1`
        )[0]?.s as { name: string }[],
    );
    expect(rel.map((s) => s.name)).toContain("Duyệt cấp 2 (canvas)");

    // Gán cho tenant acme: quy trình dùng phòng ban theo MÃ ⇒ acme cần Group `contracts-editor`/`contracts-owner` (fixture P-a chưa có;
    // gói Sổ Hợp Tác tạo chúng khi bật gói — ở đây dựng trực tiếp). Thiếu ⇒ Hub 422 SLOT_GROUPS_MISSING (kiểm ở ca khác).
    await withSql(
      (sql) => sql`insert into admin.groups (tenant_id, key, name) values
        (${ACME}, 'contracts-editor', '{"vi":"contracts-editor"}'::jsonb),
        (${ACME}, 'contracts-owner', '{"vi":"contracts-owner"}'::jsonb)
        on conflict (tenant_id, key) do nothing`,
    );
    // Gán cho tenant acme (hộp thoại)
    await toolbar.getByRole("button", { name: "Gán cho tenant" }).click();
    const asg = p.getByRole("dialog");
    await asg.getByRole("checkbox", { name: /acme/i }).check();
    await asg.getByRole("button", { name: "Lưu gán" }).click();
    await expect(p.getByText(/Đã cập nhật gán cho 1 tenant/)).toBeVisible();

    // Canvas: CHỈ route/finalize khoá (huy hiệu "Hệ thống", Delete không mở hộp xoá, panel báo khoá); bước duyệt không khoá
    await toolbar.getByRole("button", { name: "Canvas", exact: true }).click();
    const sys = canvas.getByRole("button").filter({ hasText: "Hệ thống" });
    await expect(sys.first()).toBeVisible();
    expect(await sys.count()).toBe(2); // contracts-route + contracts-finalize, không phải mọi giai đoạn
    await expect(
      canvas.getByRole("button", { name: /^Giai đoạn 3: Duyệt cấp 2 \(canvas\)/ }),
    ).not.toContainText("Hệ thống");
    await sys.first().focus();
    await p.keyboard.press("Delete");
    await expect(p.getByRole("alertdialog")).toHaveCount(0);
    await sys.first().click();
    await expect(
      p.getByText("Nút hệ thống của Sổ Hợp Tác: khoá, không xoá hoặc đổi."),
    ).toBeVisible();

    // danh sách: cột "Tenant đang dùng" của bản nhân bản = 1
    // ở trang editor có thêm link "Quy trình" trên đường dẫn ⇒ chọn đúng link ở thanh bên
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    await expect(table.getByRole("row").filter({ hasText: name }).first()).toBeVisible();
    expect(await tenantsUsing(p, name)).toBe(1);
  } finally {
    await ctx.close();
  }
});
