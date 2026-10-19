// HD-FR-26 · S04/S05 · Luật 4b: hành vi màn kiểm/sửa và nhập tay của contracts-web (backend giả `page.route`, không AI thật).
// S05 "Lưu" ⇒ PATCH chỉ ô đã đổi kèm `version`; S04 "Lưu hợp đồng" ⇒ POST `/manual` đúng thân rồi mở HĐ mới; số sai ⇒ báo
// tên ô, không gửi. Chỉ chạy ở chế độ so (contracts-web); chế độ chụp tham chiếu bỏ qua.
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const NEW_ID = "c1000000-0000-4000-8000-000000000009";
type Sent = { method: string; path: string; body: unknown };

async function install(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  const d = asHub("editor");
  const json = (r: Parameters<Parameters<Page["route"]>[1]>[0], status: number, body: unknown) =>
    r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postDataJSON() });
    if (req.method() === "PATCH")
      return json(r, 200, {
        id: contract.id,
        version: 4,
        updated_at: "2026-10-18T03:00:00Z",
        fields: {},
      });
    if (req.method() === "POST")
      return json(r, 201, { id: NEW_ID, status: "needs_review", version: 1 });
    return json(r, 200, { ...contractAsHub(), id: path.split("/").pop() });
  });
  return sent;
}

test("HD-FR-26 · S05 · Lưu gửi PATCH chỉ ô đã đổi + version, báo «Đã lưu.»", async ({ page }) => {
  const sent = await install(page);
  await page.goto(`/contracts/${contract.id}`);
  const value = page.getByLabel("Giá trị (đ)");
  await value.fill("250.000.000");
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu.");
  expect(sent).toEqual([
    {
      method: "PATCH",
      path: `/pack/contracts/contracts/${contract.id}/fields`,
      body: { version: 3, fields: { total_value: 250_000_000 } },
    },
  ]);
});

test("HD-FR-26 · S04 · nhập tay: POST /manual đúng thân rồi mở màn kiểm/sửa HĐ mới", async ({
  page,
}) => {
  const sent = await install(page);
  await page.goto("/contracts/new");
  await page.getByLabel("Loại").selectOption("sale");
  await page.getByLabel("Tên hợp đồng").fill("Cung cấp gạo 2027");
  await page.getByLabel("Đối tác", { exact: true }).fill("Công ty TNHH Gạo Ngon");
  await page.getByLabel("Giá trị (đ)").fill("91.500.000");
  await page.getByLabel("Tên hàng").fill("Gạo ST25");
  await page.getByLabel("Số lượng").fill("1,5");
  await page.getByLabel("Đơn giá").fill("20.000");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/pack/contracts/contracts/manual",
    body: {
      direction: "sale",
      number: null,
      title: "Cung cấp gạo 2027",
      partner_name: "Công ty TNHH Gạo Ngon",
      partner_tax_id: null,
      start_date: null,
      end_date: null,
      notice_days: 30,
      total_value: 91_500_000,
      payment_terms: null,
      partner_signer: null,
      our_signer: null,
      items: [{ name: "Gạo ST25", unit: null, qty: 1.5, unit_price: 20_000 }],
    },
  });
});

test("HD-FR-26 · S04 · số không đọc được ⇒ báo tên ô, không gửi", async ({ page }) => {
  const sent = await install(page);
  await page.goto("/contracts/new");
  await page.getByLabel("Tên hợp đồng").fill("HĐ");
  await page.getByLabel("Đối tác", { exact: true }).fill("A");
  await page.getByLabel("Tên hàng").fill("Gạo");
  await page.getByLabel("Đơn giá").fill("hai mươi");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Không đọc được số ở: Đơn giá “Gạo”. Gõ kiểu 91.500.000 hoặc 1,5.",
  );
  expect(sent).toEqual([]);
});
