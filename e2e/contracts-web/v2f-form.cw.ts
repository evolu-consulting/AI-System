// CR-097 K3a: HD-FR-26 ngừng — `/contracts/new` không còn form nhập tay (POST /manual ⇒ 410); toàn bộ describe nhập tay bên dưới bị bỏ qua
// (CR-097: giữ code form cho Giao dịch sau này). Chỉ test "chỉ upload" chạy.
// V2-F · HD-01 · HD-10 · 5.5a · 5.7e · Luật 4b: form hợp đồng (nhập tay) — thanh Huỷ/Lưu dính, 3 ô loại Mua/Bán/Giới thiệu (nhãn đối tác + kho
// đi theo loại), ô bắt buộc viền đỏ, đối tác kèm điểm uy tín / "Đối tác mới", chọn SP danh mục từng dòng (V2-B match), tồn + "Bán vượt tồn",
// giá trị tự cộng khi để trống. Backend giả `page.route`; chờ phần tử/yêu cầu, không sleep.
import { expect, type Page, test } from "@playwright/test";
import { NEW_ID, P_SIGN, P_TOKEN } from "./dataset-v2f";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const line = (page: Page, n: number) => ({
  name: page.getByLabel("Tên hàng").nth(n),
  qty: page.getByLabel("Số lượng", { exact: true }).nth(n),
  unit: page.getByLabel("Đơn vị", { exact: true }).nth(n),
  price: page.getByLabel("Đơn giá", { exact: true }).nth(n),
  pick: page.getByLabel(`Gắn dòng ${n + 1} với sản phẩm`),
});
const manual = (sent: Sent[]) => sent.find((s) => s.path === "/pack/contracts/contracts/manual");

async function fillHead(page: Page, partner: RegExp = /^Nhà cung cấp/) {
  await page.getByLabel("Tên hợp đồng").fill("HĐ mua token Q4");
  await page.getByLabel(partner).fill("Công ty TNHH Bao Bì Phương Nam");
  await page.getByLabel(/^Hiệu lực từ/).fill("2026-10-20");
}

test.describe
  .skip("thanh Huỷ/Lưu dính + 3 ô loại", () => {
    test("cuộn xuống cuối trang, thanh Huỷ/Lưu vẫn ở đỉnh khung nhìn", async ({ page }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      const bar = page.getByTestId("form-bar");
      await expect(bar.getByRole("button", { name: "Lưu hợp đồng" })).toBeVisible();
      await page.getByRole("button", { name: "+ Thêm dòng" }).click();
      await page.getByRole("button", { name: "+ Thêm dòng" }).click();
      await page.getByRole("button", { name: "+ Thêm dòng" }).click();
      await page.getByRole("button", { name: "+ Thêm dòng" }).click();
      await page.locator("main").evaluate((m) => m.scrollTo(0, m.scrollHeight));
      const box = await bar.boundingBox();
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect(box?.y ?? 999).toBeLessThan(120);
      await expect(bar.getByRole("link", { name: "Huỷ" })).toBeInViewport();
      await expect(bar.getByRole("button", { name: "Lưu hợp đồng" })).toBeInViewport();
    });

    test("đổi loại: nhãn đối tác + nhãn kho + ô hoa hồng đi theo loại", async ({ page }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      const tag = (t: string) => page.locator("main").getByText(t, { exact: true });
      await expect(page.getByRole("radio", { name: /^Mua/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByLabel(/^Nhà cung cấp/)).toBeVisible();
      await expect(tag("Nhập kho")).toBeVisible();
      await expect(page.getByLabel("Giá trị")).toBeVisible();
      await page.getByRole("radio", { name: /^Bán/ }).click();
      await expect(page.getByLabel(/^Khách hàng/)).toBeVisible();
      await expect(tag("Xuất kho")).toBeVisible();
      await page.getByRole("radio", { name: /^Giới thiệu/ }).click();
      await expect(page.getByLabel(/^Bên trả hoa hồng/)).toBeVisible();
      await expect(tag("Không ảnh hưởng kho")).toBeVisible();
      await expect(page.getByLabel(/^% hoa hồng/)).toBeVisible();
      await expect(page.getByLabel("Giá trị")).toHaveCount(0);
    });
  });

test.describe
  .skip("ô bắt buộc", () => {
    test("lưu form rỗng ⇒ viền đỏ ô thiếu, báo tên ô, không gửi", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      for (const l of [/^Tên hợp đồng/, /^Nhà cung cấp/, /^Hiệu lực từ/])
        await expect(page.getByLabel(l)).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel(/^Nhà cung cấp/)).toHaveClass(/border-late/);
      await expect(page.getByLabel("Số hợp đồng")).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("alert")).toHaveText(
        "Thiếu: Tên hợp đồng, Nhà cung cấp, Hiệu lực từ",
      );
      expect(sent).toEqual([]);
    });

    test("Giới thiệu thiếu % hoa hồng ⇒ viền đỏ ô hoa hồng", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("radio", { name: /^Giới thiệu/ }).click();
      await fillHead(page, /^Bên trả hoa hồng/);
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page.getByLabel(/^% hoa hồng/)).toHaveAttribute("aria-invalid", "true");
      expect(sent).toEqual([]);
    });

    test("dòng có tên mà chưa gắn sản phẩm ⇒ chặn lưu, báo dòng", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await fillHead(page);
      await line(page, 0).name.fill("Ổ cứng ngoài");
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "Thiếu: dòng “Ổ cứng ngoài” chưa gắn sản phẩm",
      );
      // Gợi ý không có kết quả ⇒ "tạo mới"; xoá lựa chọn ⇒ chưa gắn ⇒ chặn.
      expect(sent).toEqual([]);
    });
  });

test.describe
  .skip("đối tác: điểm uy tín / Đối tác mới", () => {
    test("đã có ⇒ điểm + mức; chưa có ⇒ «Đối tác mới · sẽ tạo khi lưu»; có nhưng thiếu vai ⇒ thêm vai trò", async ({
      page,
    }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      const partner = page.getByLabel(/^Nhà cung cấp/);
      await partner.fill("Công ty TNHH Bao Bì Phương Nam");
      const score = page.getByTestId("partner-score");
      await expect(score).toContainText("88");
      await expect(score).toContainText("Tốt");
      await expect(score).toContainText("uy tín nhà cung cấp");
      await partner.fill("Công ty Hoàn Toàn Mới");
      await expect(page.getByText("Đối tác mới · sẽ tạo khi lưu")).toBeVisible();
      await expect(page.getByTestId("partner-score")).toHaveCount(0);
      await partner.fill("Cty Chưa Vai");
      await expect(page.getByText("thêm vai trò nhà cung cấp")).toBeVisible();
    });
  });

test.describe
  .skip("dòng hàng gắn sản phẩm danh mục", () => {
    test("gõ tên ⇒ gợi ý SP (nhãn «Gợi ý»); Mua hiện tồn, không cảnh báo vượt tồn", async ({
      page,
    }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      const l = line(page, 0);
      await l.name.fill("USB Token trắng");
      await l.qty.fill("50");
      await l.name.blur();
      await expect(l.pick).toHaveValue(P_TOKEN.id);
      await expect(page.getByText("Gợi ý", { exact: true })).toBeVisible();
      await expect(page.getByTestId("on-hand")).toHaveText("tồn 10 cái");
      await expect(page.getByTestId("oversell")).toHaveCount(0);
    });

    test("Bán: SL lớn hơn tồn ⇒ «Bán vượt tồn»; SL nhỏ hơn thì hết cảnh báo", async ({ page }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("radio", { name: /^Bán/ }).click();
      const l = line(page, 0);
      await l.name.fill("USB Token trắng");
      await l.qty.fill("50");
      await l.name.blur();
      await expect(page.getByTestId("oversell")).toContainText("Bán vượt tồn");
      await expect(page.getByTestId("oversell")).toContainText("tồn 10 cái");
      await l.qty.fill("8");
      await expect(page.getByTestId("oversell")).toHaveCount(0);
      await expect(page.getByTestId("on-hand")).toHaveText("tồn 10 cái");
    });

    test("SP nhiều thành phần: gợi ý chọn đúng thành phần, tồn theo thành phần", async ({
      page,
    }) => {
      await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("radio", { name: /^Bán/ }).click();
      const l = line(page, 0);
      await l.name.fill("Chữ ký số 1 năm");
      await l.qty.fill("20");
      await l.name.blur();
      await expect(l.pick).toHaveValue(P_SIGN.id);
      await expect(page.getByLabel("Thành phần dòng 1")).toHaveValue(
        P_SIGN.components[1]?.id ?? "",
      );
      await expect(page.getByTestId("oversell")).toContainText("tồn 5 lượt");
      await page.getByLabel("Thành phần dòng 1").selectOption(P_SIGN.components[0]?.id ?? "");
      await expect(page.getByTestId("oversell")).toHaveCount(0);
      await expect(page.getByTestId("on-hand")).toHaveText("tồn 40 lượt");
    });
  });

test.describe
  .skip("giá trị tự cộng", () => {
    test("để trống ⇒ placeholder + gửi tổng các dòng; gõ tay thì thắng", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await fillHead(page);
      const a = line(page, 0);
      await a.name.fill("USB Token trắng");
      await a.qty.fill("50");
      await a.price.fill("195.000");
      await a.name.blur();
      await page.getByRole("button", { name: "+ Thêm dòng" }).click();
      const b = line(page, 1);
      await b.name.fill("USB Token đen");
      await b.qty.fill("5");
      await b.price.fill("100.000");
      await b.name.blur();
      await expect(page.getByTestId("items-total")).toHaveText("10.250.000");
      await expect(page.getByLabel("Giá trị")).toHaveAttribute(
        "placeholder",
        "Tự tính: 10.250.000",
      );
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
      expect(manual(sent)?.body).toMatchObject({ deal: "buy", total_value: 10_250_000 });
    });

    test("giá trị gõ tay thắng tổng các dòng", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await fillHead(page);
      const a = line(page, 0);
      await a.name.fill("USB Token trắng");
      await a.qty.fill("2");
      await a.price.fill("1.000");
      await a.name.blur();
      await page.getByLabel("Giá trị").fill("91.500.000");
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
      expect(manual(sent)?.body).toMatchObject({ total_value: 91_500_000 });
    });
  });

test.describe
  .skip("lưu", () => {
    test("POST /manual đúng thân: deal, đối tác, product_id + component_ids từng dòng", async ({
      page,
    }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("radio", { name: /^Bán/ }).click();
      await page.getByLabel("Tên hợp đồng").fill("Bán chữ ký số Q4");
      await page.getByLabel(/^Khách hàng/).fill("Công ty Hoàn Toàn Mới");
      await page.getByLabel(/^Hiệu lực từ/).fill("2026-10-20");
      const l = line(page, 0);
      await l.name.fill("Chữ ký số 1 năm");
      await l.qty.fill("3");
      await l.price.fill("1.200.000");
      await l.unit.fill("gói");
      await l.name.blur();
      await expect(l.pick).toHaveValue(P_SIGN.id);
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
      expect(manual(sent)).toEqual({
        method: "POST",
        path: "/pack/contracts/contracts/manual",
        body: {
          deal: "sell",
          number: null,
          title: "Bán chữ ký số Q4",
          partner_name: "Công ty Hoàn Toàn Mới",
          partner_tax_id: null,
          start_date: "2026-10-20",
          end_date: null,
          notice_days: 45, // mặc định từ Cài đặt (V2-H), form không còn cứng 30
          total_value: 3_600_000,
          payment_terms: null,
          partner_signer: null,
          our_signer: null,
          items: [
            {
              name: "Chữ ký số 1 năm",
              unit: "gói",
              qty: 3,
              unit_price: 1_200_000,
              product_id: P_SIGN.id,
              component_ids: [P_SIGN.components[1]?.id],
            },
          ],
        },
      });
    });

    // products-confirm (khách 2026-10-22): lưu KHÔNG tạo SP; HĐ còn chờ xác nhận ⇒ dòng "Tạo sản phẩm mới" gửi không kèm SP,
    // SP chỉ tạo lúc xác nhận (hộp "Gắn sản phẩm") hoặc khi lưu ra `active` (`/product-links`, xem v2g-review).
    test("«Tạo sản phẩm mới» + HĐ chờ xác nhận ⇒ KHÔNG POST /products, POST /manual không kèm SP", async ({
      page,
    }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await fillHead(page);
      const l = line(page, 0);
      await l.name.fill("Ổ cứng ngoài 1TB");
      await l.qty.fill("2");
      await l.unit.fill("cái");
      await l.name.blur();
      // Không có gợi ý ⇒ máy chủ đề xuất tạo mới từ tên dòng.
      await expect(l.pick).toHaveValue("__new__");
      await expect(page.getByLabel("Tên sản phẩm mới dòng 1")).toHaveValue("Ổ cứng ngoài 1TB");
      await page.getByLabel("Nhóm sản phẩm dòng 1").selectOption("goods");
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
      expect(sent.filter((s) => s.path === "/pack/contracts/products")).toEqual([]);
      expect(sent.filter((s) => s.path.endsWith("/product-links"))).toEqual([]);
      const body = manual(sent)?.body as { items: { name: string; product_id?: string | null }[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.name).toBe("Ổ cứng ngoài 1TB");
      expect(body.items[0]?.product_id ?? null).toBeNull();
    });

    test("Giới thiệu: gửi hoa hồng %, không gửi giá trị", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await page.getByRole("radio", { name: /^Giới thiệu/ }).click();
      await fillHead(page, /^Bên trả hoa hồng/);
      await page.getByLabel(/^% hoa hồng/).fill("8,5");
      const l = line(page, 0);
      await l.name.fill("Bảo hiểm xe ô tô");
      await l.name.blur();
      await page.getByLabel("Gắn dòng 1 với sản phẩm").selectOption({ label: "Bảo hiểm xe" });
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
      expect(manual(sent)?.body).toMatchObject({
        deal: "referral",
        commission_pct: 8.5,
        commission_fixed: null,
        total_value: null,
      });
    });

    test("số không đọc được ⇒ báo tên ô, không gửi", async ({ page }) => {
      const sent = await installV2f(page);
      await page.goto("/contracts/new");
      await fillHead(page);
      const l = line(page, 0);
      await l.name.fill("USB Token trắng");
      await l.name.blur();
      await l.price.fill("hai mươi");
      await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "Không đọc được số ở: Đơn giá “USB Token trắng”. Gõ kiểu 91.500.000 hoặc 1,5.",
      );
      expect(sent).toEqual([]);
    });
  });

test("CR-097 K3a · /contracts/new chỉ báo phải tải lên từ văn bản đã ký + nút Upload, không có form", async ({
  page,
}) => {
  await installV2f(page);
  await page.goto("/contracts/new");
  await expect(page.getByText("Hợp đồng phải tải lên từ văn bản đã ký")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload hợp đồng" })).toBeVisible();
  await expect(page.getByLabel("Tên hợp đồng")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lưu hợp đồng" })).toHaveCount(0);
});
