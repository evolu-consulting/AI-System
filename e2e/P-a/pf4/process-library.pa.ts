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

    // giao diện đơn giản: không còn cột Ký hiệu; trạng thái + "đang dùng" bằng chữ; mặc định ghim đầu; nút tạo từ mặc định
    await expect(table.getByRole("columnheader", { name: "Ký hiệu" })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Trạng thái" })).toBeVisible();
    await expect(base.getByText("Mặc định cho mọi tenant chưa gán")).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toContainText("Quy trình HĐ mặc định");
    await expect(p.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
    await expect(p.getByText("Nhân bản → chỉnh → xuất bản → gán cho tenant")).toBeVisible();
    await expect(p.getByRole("button", { name: "Tạo từ quy trình mặc định" })).toBeVisible();

    // Nhân bản ⇒ hộp thoại nhập TÊN (ký hiệu tự sinh) ⇒ mở nháp mới
    await base.getByRole("button", { name: "Nhân bản" }).click();
    const cloneDlg = p.getByRole("dialog");
    await expect(cloneDlg.getByRole("textbox", { name: "Tên quy trình mới" })).toHaveValue(
      "Quy trình HĐ mặc định – bản mới",
    );
    await cloneDlg.getByRole("textbox", { name: "Tên quy trình mới" }).fill("Quy trình HĐ e2e");
    await expect(cloneDlg.getByText("Ký hiệu tự sinh: quy-trinh-hd-e2e")).toBeVisible();
    await cloneDlg.getByRole("button", { name: "Nhân bản", exact: true }).click();
    await expect(p.getByText("Đã nhân bản thành bản nháp mới")).toBeVisible();
    const toolbar = p.getByTestId("library-toolbar");
    await expect(toolbar.getByText("Nháp", { exact: true })).toBeVisible();
    const name = (await p.getByRole("heading", { level: 1 }).innerText()).trim();
    // thanh trên: không lỗi i18n; chỉ MỘT công tắc (Sơ đồ / Danh sách); gợi ý "Lưu nháp…" hiện khi chưa xuất bản
    await expect(toolbar).toContainText("0 tenant đã gán");
    await expect(toolbar).not.toContainText("returned an object");
    await expect(p.getByRole("tab", { name: "Danh sách" })).toHaveCount(0);
    await expect(toolbar.getByText(/Lưu nháp chưa áp dụng cho tenant/)).toBeVisible();
    expect(name).toBe("Quy trình HĐ e2e");

    // Canvas: bước duyệt (cũng là stage gọi contracts-route) KHÔNG khoá ⇒ sửa tên + hạn, Lưu ⇒ Hub dựng lại slot_body từ stages
    const canvas = p.getByRole("application", { name: "Canvas quy trình" });
    await canvas.getByRole("button", { name: /^Bước 2: Duyệt cấp 2/ }).click();
    const slotForm = p.getByTestId("slot-stage-form");
    await slotForm.getByRole("textbox", { name: "Tên bước" }).fill("Duyệt cấp 2 (canvas)");
    await slotForm.getByRole("spinbutton", { name: "Hạn quyết (giờ)" }).fill("24");
    await p.getByRole("button", { name: "Lưu nháp", exact: true }).click();
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
    await p.getByRole("button", { name: "Thêm bước duyệt", exact: true }).click();
    await slotForm.getByRole("textbox", { name: "Tên bước" }).fill("Pháp chế (canvas)");
    await slotForm
      .getByRole("combobox", { name: "Mã phòng ban", exact: true })
      .fill("contracts-owner");
    await p.getByRole("button", { name: "Lưu nháp", exact: true }).click();
    await expect(p.getByText(/Đã lưu · v\d+/)).toBeVisible();
    const three = await draftSteps();
    expect(three.map((s) => s.name)).toEqual([
      "Kiểm tra hợp đồng",
      "Duyệt cấp 2 (canvas)",
      "Pháp chế (canvas)",
    ]);
    expect(three[2]?.department_group_key).toBe("contracts-owner");

    // Form hiện đúng 3 bước vừa lưu từ Canvas (vòng đi–về giữ chỉnh sửa)
    await toolbar.getByRole("button", { name: "Danh sách", exact: true }).click();
    await expect(
      p.getByTestId("flow-step-2").getByRole("textbox", { name: "Tên bước" }),
    ).toHaveValue("Pháp chế (canvas)");
    await toolbar.getByRole("button", { name: "Sơ đồ", exact: true }).click();
    // Xuất bản (hiện tác động) ⇒ "Đã xuất bản v1"
    await toolbar.getByRole("button", { name: "Xuất bản", exact: true }).click();
    const pub = p.getByRole("dialog");
    await expect(pub.getByTestId("publish-impact")).toContainText("tenant đang dùng");
    await pub.getByRole("button", { name: "Xuất bản", exact: true }).click();
    await expect(toolbar.getByText(/Đã xuất bản v\d+/)).toBeVisible();
    await expect(toolbar.getByText(/Lưu nháp chưa áp dụng cho tenant/)).toHaveCount(0); // đã xuất bản, không thay đổi
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
    await toolbar.getByRole("button", { name: "Sơ đồ", exact: true }).click();
    const sys = canvas.getByRole("button").filter({ hasText: "Hệ thống" });
    await expect(sys.first()).toBeVisible();
    expect(await sys.count()).toBe(2); // contracts-route + contracts-finalize, không phải mọi giai đoạn
    await expect(
      canvas.getByRole("button", { name: /^Bước 2: Duyệt cấp 2 \(canvas\)/ }),
    ).not.toContainText("Hệ thống");
    await sys.first().focus();
    await p.keyboard.press("Delete");
    await expect(p.getByRole("alertdialog")).toHaveCount(0);
    await sys.first().click();
    await expect(
      p.getByText("Nút hệ thống của Sổ Hợp Tác: khoá, không xoá hoặc đổi."),
    ).toBeVisible();

    // danh sách: "Tenant đang dùng" của bản nhân bản = "1 tenant: Acme Corp" (chữ dễ đọc)
    // ở trang editor có thêm link "Quy trình" trên đường dẫn ⇒ chọn đúng link ở thanh bên
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    await expect(table.getByRole("row").filter({ hasText: name }).first()).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: name }).first()).toContainText(
      "1 tenant",
    );

    // Dọn rác: xoá quy trình KHÔNG dùng (nháp hoặc đã xuất bản) bằng gõ lại tên; mặc định / đang gán thì nút Xoá bị khoá
    await expect(
      table.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "Xoá" }),
    ).toBeDisabled();
    await expect(base.getByRole("button", { name: "Xoá" })).toBeDisabled(); // mặc định của khe: khoá (tooltip nêu lý do)
    await base.getByRole("button", { name: "Nhân bản" }).click();
    await p.getByRole("textbox", { name: "Tên quy trình mới" }).fill("Nháp tạm e2e");
    await p.getByRole("dialog").getByRole("button", { name: "Nhân bản", exact: true }).click();
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Nháp tạm e2e");
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    const tmp = table.getByRole("row").filter({ hasText: "Nháp tạm e2e" });
    await tmp.getByRole("button", { name: "Xoá" }).click();
    // xác nhận bằng cách GÕ LẠI TÊN (nút Xoá chỉ bật khi gõ đúng)
    const confirm = p.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Xoá" })).toBeDisabled();
    await confirm.getByRole("textbox").fill("Nháp tạm e2e");
    await confirm.getByRole("button", { name: "Xoá" }).click();
    await expect(tmp).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
