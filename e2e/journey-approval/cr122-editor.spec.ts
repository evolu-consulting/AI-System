// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-122 · Q1 · ca UI của trình sửa flow (canvas) trên stack thật `playwright.journey.config.ts`, công ty MỚI `e2e-c22u-<hậu tố>`:
//  1) menu "+ Thêm bước" gom nhóm (Cơ bản · …) và liệt kê node dựng sẵn;
//  2) cạnh vàng (Ký số cần `contract_id` mà bước trước không có) ⇒ ô "Gợi ý cầu nối" ⇒ Bỏ / Nhận (route AI giả: AI thật cần agent `flow-bridge` đã seed);
//  3) Nhận cầu nối = chèn bước GIỮA flow ⇒ Lưu ⇒ đích của Nếu vẫn trỏ đúng node (dời +1), không lệch sang bước mới.
// Dữ liệu riêng: flow Thư viện `c22u-ed-<hậu tố>` (xem `_kit/flows.ts`: dựng bằng SQL — Lỗi sản phẩm #1) gán qua API, bản sao do quản trị công ty tạo ở UI.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow, type Session } from "../_kit/api";
import {
  bridgeSet,
  enableFlowTriggers,
  esignNode,
  finish,
  ifFact,
  plainSet,
  seedLibraryFlow,
} from "../_kit/flows";
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
    4,
  ),
  plainSet("nhan", "Nhận dữ liệu", 1),
  ...esignNode(2),
  finish("xong", "Đã duyệt", 4, "approved"),
];

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
  const flowId = await seedLibraryFlow({
    key: `c22u-ed-${SFX}`,
    name: FLOW,
    app: "contracts",
    slot: "contracts.approval",
    trigger: { event: "contract.submitted" },
    stages: stages(),
  });
  tenantId = await enableFlowTriggers(KEY, false); // chỉ lấy id công ty; không bật cờ (không có lượt chạy ở ca này)
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  await assignCompanyFlow(HUB, platform, tenantId, flowId);
});

test("1 · menu '+ Thêm bước': một nút, nhóm Cơ bản + node dựng sẵn (Duyệt, Nếu, Kết thúc…)", async ({
  page,
}) => {
  await openCopy(page);
  await page.getByTestId("flow-add-step").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Cơ bản", { exact: true })).toBeVisible();
  for (const id of ["approve", "form", "if", "set", "finish"])
    await expect(menu.getByTestId(`flow-node-${id}`)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("2 · cạnh vàng ⇒ Gợi ý cầu nối (route AI giả): Bỏ rồi hỏi lại rồi Nhận ⇒ chèn node Ghi giá trị giữa flow; Lưu ⇒ đích của Nếu vẫn đúng", async ({
  page,
}) => {
  const cors = {
    "access-control-allow-origin": ADMIN,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization,content-type,x-app",
    "access-control-allow-methods": "POST,OPTIONS",
  };
  await page.route("**/process-defs/bridge-suggest", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({
            ok: true,
            stage: bridgeSet(1),
            explain_vi: "Chép giá trị hợp đồng sang trường amount để Ký số đọc được.",
            explain_en: "Copy the contract value into amount so e-signing can read it.",
          }),
        }),
  );
  await openCopy(page);
  const bridge = page.getByTestId("canvas-bridge");
  await expect(bridge).toBeVisible();
  await expect(bridge).toContainText("Thiếu contract_id");

  // Hỏi ⇒ xem trước node mờ + lời giải thích; Bỏ ⇒ về trạng thái chưa hỏi
  await bridge.getByRole("button", { name: "Gợi ý cầu nối" }).click();
  await expect(page.getByTestId("bridge-text")).toContainText("Chép giá trị hợp đồng");
  await expect(bridge).toContainText("Ghi giá trị (đề xuất)");
  await bridge.getByRole("button", { name: "Bỏ", exact: true }).click();
  await expect(bridge.getByRole("button", { name: "Gợi ý cầu nối" })).toBeVisible();

  // Hỏi lại ⇒ Nhận ⇒ node Ghi giá trị thật nằm giữa Nếu và Ký số
  await bridge.getByRole("button", { name: "Gợi ý cầu nối" }).click();
  await bridge.getByRole("button", { name: "Nhận", exact: true }).click();
  await expect(
    page.getByRole("application", CANVAS).getByText("Ghi giá trị").first(),
  ).toBeVisible();

  // Lưu (bản công ty) ⇒ đích của Nếu theo node, không theo số bước cũ
  const put = page.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()),
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const res = await put;
  expect(res.status(), await res.text()).toBe(200);

  const s = await adminSession();
  const def = (await (
    await fetch(`${HUB}/process-defs/${copyFlowId}`, { headers: s.headers })
  ).json()) as {
    stages: {
      key: string;
      step: number;
      executor: { kind: string; then_step?: number; else_step?: number };
    }[];
  };
  const stepOf = (k: string) => def.stages.find((x) => x.key === k)?.step;
  const iff = def.stages.find((x) => x.key === "nhanh")?.executor;
  expect(stepOf("cau-noi"), "node cầu nối nằm ngay sau Nhận dữ liệu").toBe(2);
  expect(stepOf("ky-gui"), "Ký số dời +1").toBe(3);
  expect(iff?.then_step, "Đúng ⇒ vẫn là Nhận dữ liệu").toBe(stepOf("nhan"));
  expect(iff?.else_step, "Sai ⇒ vẫn là Kết thúc (đã dời)").toBe(stepOf("xong"));
});

test("3 · node Ký số trên bản công ty: panel cấu hình riêng hiện trạng thái rõ khi công ty chưa bật ký số", async ({
  page,
}) => {
  await openCopy(page);
  await page
    .getByRole("application", CANVAS)
    .getByRole("button", { name: /Ký số/ })
    .first()
    .click();
  // stack hành trình KHÔNG có nhà cung cấp ký số (ESIGN_PROVIDERS) ⇒ panel nói rõ lý do + cách sửa, không ô trống bí ẩn
  await expect(page.getByTestId("esign-disabled")).toContainText("Công ty chưa bật ký số");
});

// U2f: chọn nhà cung cấp + người ký, đặt sai MỘT ô ⇒ lỗi hiện đúng ô đó khi lưu. Cần UAT/stack bật feature, entitlement ký số, nhóm và nhà
// cung cấp (hub khởi động lại mới thấy node) — stack journey chưa có ⇒ viết sẵn, gỡ `fixme` khi stack có nhà cung cấp ký số.
test("4 · cấu hình Ký số: chọn nhà cung cấp + người ký; một ô sai ⇒ lỗi đúng ô (Hạn, Nhắc, Người ký)", async ({
  page,
}) => {
  test.fixme(
    true,
    "stack journey chưa có nhà cung cấp ký số (ESIGN_PROVIDERS) — panel 'node-config' không hiện",
  );
  await openCopy(page);
  await page
    .getByRole("application", CANVAS)
    .getByRole("button", { name: /Ký số/ })
    .first()
    .click();
  const cfg = page.getByTestId("node-config");
  await expect(cfg).toBeVisible();
  await cfg.getByRole("combobox", { name: "Nhà cung cấp" }).click();
  await page.getByRole("option").nth(1).click();
  await cfg.getByRole("checkbox").first().check();
  await cfg.getByLabel("Hạn (ngày)").fill("0");
  await expect(cfg.getByLabel("Hạn (ngày)")).toBeVisible();
  await expect(cfg.getByRole("alert")).toHaveCount(1);
});
