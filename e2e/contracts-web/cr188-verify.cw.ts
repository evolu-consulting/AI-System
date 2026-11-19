// CR-188 · BR-188-6 «Kiểm tra tệp» (nút trên danh sách HĐ, trang /contracts/verify): khớp ⇒ HĐ + loại + đối tác + giờ ký + «Mở hợp đồng»;
// khớp mà không quyền ⇒ chỉ «Khớp một giấy tờ đã ký của công ty»; không khớp ⇒ câu cảnh báo; thanh bên không còn mục.
// Backend giả `page.route`; không sleep. (Viết trong lát, chạy cuối đợt.)
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const EMPTY = {
  match: false,
  visible: false,
  other: false,
  contract: null,
  check_code: null,
  signed_by: null,
  signed_at: null,
  file_id: null,
  seq: null,
  version_id: null,
};

async function open(page: Page, result: unknown, path = "/contracts/verify") {
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  await page.route("**/pack/contracts/verify-file", (r) => json(r, result));
  await page.goto(path);
}

const pick = (page: Page, name: string) =>
  page
    .getByTestId("verify-file")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from("x") });

test("kiểm tra tệp: khớp + có quyền ⇒ HĐ, loại, đối tác, giờ ký, nút Mở hợp đồng", async ({
  page,
}) => {
  await open(page, {
    ...EMPTY,
    match: true,
    visible: true,
    contract: {
      id: "c0de0000-0000-4000-8000-000000000001",
      title: "HĐ mua hàng A",
      kind: "appendix",
      partner: "Công ty ABC",
    },
    check_code: "ABCDEF12",
    signed_at: "2026-11-01T03:00:00.000Z",
    seq: 2,
  });
  await pick(page, "a.pdf");
  const hit = page.getByTestId("verify-hit");
  await expect(hit).toContainText("phụ lục");
  await expect(hit).toContainText("HĐ mua hàng A");
  await expect(hit).toContainText("Công ty ABC");
  await expect(hit).toContainText("ABCDEF12");
  await expect(page.getByRole("link", { name: "Mở hợp đồng" })).toBeVisible();
});

test("kiểm tra tệp: khớp nhưng không có quyền xem ⇒ chỉ một câu, không nút mở", async ({
  page,
}) => {
  await open(page, { ...EMPTY, match: true });
  await pick(page, "b.pdf");
  await expect(page.getByTestId("verify-hidden")).toContainText(
    "Khớp một giấy tờ đã ký của công ty",
  );
  await expect(page.getByRole("link", { name: "Mở hợp đồng" })).toHaveCount(0);
});

test("kiểm tra tệp: không khớp ⇒ báo tệp có thể đã bị sửa", async ({ page }) => {
  await open(page, EMPTY);
  await pick(page, "c.pdf");
  await expect(page.getByTestId("verify-miss")).toContainText(
    "Không khớp giấy tờ đã ký nào của công ty",
  );
});

test("danh sách HĐ: nút «Kiểm tra tệp» mở hộp; thanh bên không còn mục Kiểm tra tệp", async ({
  page,
}) => {
  await open(page, EMPTY, "/contracts/list");
  await expect(page.getByTestId("nav-contracts-verify")).toHaveCount(0);
  await page.getByTestId("verify-open").click();
  await expect(page.getByTestId("verify-dialog")).toBeVisible();
  await pick(page, "d.pdf");
  await expect(page.getByTestId("verify-miss")).toBeVisible();
});
