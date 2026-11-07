// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-122 · Q1 · ca UI của trình sửa flow (canvas) trên stack thật `playwright.journey.config.ts`, công ty MỚI `e2e-c22u-<hậu tố>`:
//  1) menu "+ Thêm bước" gom nhóm (Cơ bản · …) và liệt kê node dựng sẵn;
//  2) cạnh vàng (Ký số cần `contract_id` mà bước trước không có) ⇒ ô "Gợi ý cầu nối" ⇒ Bỏ / Nhận (route AI giả: AI thật cần agent `flow-bridge` đã seed);
//  3) Nhận cầu nối = chèn bước GIỮA flow ⇒ Lưu ⇒ đích của Nếu vẫn trỏ đúng node (dời +1), không lệch sang bước mới.
// Dữ liệu riêng: flow Thư viện `c22u-ed-<hậu tố>` (xem `_kit/flows.ts`: dựng bằng SQL — Lỗi sản phẩm #1) gán qua API, bản sao do quản trị công ty tạo ở UI.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow, type Session } from "../_kit/api";
import { createLibraryFlow, enableFlowTriggers, finish, ifFact, plainSet } from "../_kit/flows";
import { flowRows, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";
import { U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const ADMIN = need("JA_ADMIN_URL");
const PW = need("JA_USER_PW");
const KEY = `e2e-c22u-${SFX}`;
const FLOW = `Trình sửa ${SFX}`;
const CANVAS = { name: "Canvas quy trình" };

let tenantId = "";
let copyFlowId = "";

/** 0 Nếu (giá trị > 100 tr: Đúng→1 Nhận dữ liệu · Sai→4 Kết thúc) · 1 Nhận dữ liệu · 2-3 Ký số (gửi + chờ) · 4 Kết thúc Đã duyệt.
 *  Cạnh vàng: Nhận dữ liệu (không đầu ra) → Ký số (cần contract_id). Chèn cầu nối SAU bước 1 ⇒ Kết thúc dời 4→5, Đúng vẫn →1. */
const stages = () => [
  ifFact(
    "nhanh",
    "Giá trị lớn hơn 100 triệu",
    0,
    { fact: "total_value", op: "gt", value: 100_000_000 },
    1,
    2,
  ),
  plainSet("nhan", "Nhận dữ liệu", 1),
  finish("xong", "Đã duyệt", 2, "approved"),
];

/** Thêm node Ký số từ menu "+ Thêm bước" ⇒ cạnh vàng "Thiếu contract_id" (API lưu từ chối flow có cạnh thiếu nên không dựng sẵn được). */
async function addEsign(page: Page): Promise<void> {
  await page.getByTestId("flow-add-step").click();
  await page.getByTestId("flow-node-contracts.esign").click();
}

async function adminSession(): Promise<Session> {
  return apiLogin({
    base: API,
    tenantKey: KEY,
    username: U.director,
    password: PW,
  });
}

/** Mở trình sửa của BẢN CÔNG TY (tạo bằng "Sao chép để sửa" ở UI lần đầu, các lần sau mở bản có sẵn). */
async function openCopy(page: Page): Promise<void> {
  await loginTenantAdminUi(page, ADMIN, KEY, U.director, PW);
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  let copy = flowRows(box).filter({ hasText: "Sao từ" });
  if ((await copy.count()) === 0) {
    await flowRows(box)
      .filter({ hasText: "Được gán" })
      .getByRole("button", { name: "Sao chép để sửa" })
      .click();
    copy = flowRows(box).filter({ hasText: "Sao từ" });
    await expect(copy).toBeVisible();
  }
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.getByRole("application", CANVAS)).toBeVisible();
  copyFlowId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? "";
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `c22u-ed-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: stages(),
  });
  tenantId = await enableFlowTriggers(KEY, false); // chỉ lấy id công ty; không bật cờ (không có lượt chạy ở ca này)
  await assignCompanyFlow(HUB, platform, tenantId, flowId);
});

test("1 · menu '+ Thêm bước' (quản trị công ty, CR-123 FR-12): chỉ bước nghiệp vụ, không có Nâng cao / Lõi", async ({
  page,
}) => {
  await openCopy(page);
  await page.getByTestId("flow-add-step").click();
  const menu = page.getByRole("menu");
  for (const id of ["approve", "if", "contracts.esign", "waitEsign", "finish"])
    await expect(menu.getByTestId(`flow-node-${id}`)).toBeVisible();
  for (const id of ["form", "agent", "tool", "set"])
    await expect(menu.getByTestId(`flow-node-${id}`)).toHaveCount(0);
  await expect(menu.getByText("Nâng cao", { exact: true })).toHaveCount(0);
  await expect(menu.getByText("Lõi", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

// Đã xoá (CR-122 Q1): ca 'cầu nối' (gd0 cbcf74bb8: Ký số tự nhận contract_id ⇒ không còn cạnh vàng) và ca 4 'cấu hình Ký số' (stack journey không có nhà cung cấp ký số; phủ ở unit/int).

test("3 · node Ký số trên bản công ty: panel cấu hình riêng hiện trạng thái rõ khi công ty chưa bật ký số", async ({
  page,
}) => {
  await openCopy(page);
  await addEsign(page);
  // thêm Ký số = 2 node (gửi + chờ sự kiện); panel tự mở ở node chờ (che canvas) ⇒ đóng, rồi mở node GỬI (đầu tiên, không phải "Ký số 2")
  await page.getByRole("button", { name: "Đóng ngăn chi tiết" }).click();
  await page
    .getByRole("application", CANVAS)
    .getByRole("button", { name: /^Ký số(?! \d)/ })
    .first()
    .click();
  // stack hành trình KHÔNG có nhà cung cấp ký số (ESIGN_PROVIDERS) ⇒ panel nói rõ lý do + cách sửa, không ô trống bí ẩn
  await expect(page.getByTestId("esign-disabled")).toContainText("Công ty chưa bật ký số");
});
