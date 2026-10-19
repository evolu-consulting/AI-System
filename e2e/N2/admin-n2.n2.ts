// N2-FR-04 · N2-FR-05 · readiness #4 · e2e admin-web lát N2 (nhãn nguyên văn i18n `tenants.field.processRuns`,
// `process.admin.editor.stage.excludeStarter`): padmin sửa trần run của acme; tadmin bật "Người bắt đầu lượt chạy không được
// duyệt bước này" ở stage Duyệt của def `pd-edit` (seed P-d). Lưu ⇒ chờ PATCH/PUT (CONVENTIONS §2), tải lại giữ, DB khớp.
import { expect, type Page, test } from "@playwright/test";
import { TENANT_ID } from "../../tests/acceptance/M1/_data";
import { defByKey, node, openDef, panel, saveDef, seedPd, withSql } from "../P-d/_pd-support";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.n2.config đặt)
const ADMIN = process.env.PA_ADMIN_URL ?? "http://localhost:5345";
const CAP = (p: Page) => p.getByRole("spinbutton", { name: "Số lượt chạy quy trình cùng lúc" });
const EXCLUDE = "Người bắt đầu lượt chạy không được duyệt bước này";

async function platformLogin(p: Page) {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  // biome-ignore lint/style/noNonNullAssertion: env bắt buộc của config
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(process.env.SEED_ADMIN_USERNAME!);
  // biome-ignore lint/style/noNonNullAssertion: env bắt buộc của config
  await p.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD!);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.beforeAll(() => seedPd());
test.afterEach(() =>
  withSql((sql) => sql`update admin.tenants set process_runs_max = 5 where id = ${TENANT_ID.acme}`),
);

test("N2-FR-04 · padmin đặt trần run acme = 200 ⇒ Lưu 200, tải lại giữ; 0 / 1001 ⇒ lỗi ô, không gửi", async ({
  page: p,
}) => {
  await platformLogin(p);
  await p.goto(`/tenants/${TENANT_ID.acme}`);
  await expect(CAP(p)).toHaveValue("5");
  await CAP(p).fill("1001");
  await CAP(p).blur();
  await expect(p.getByText("Nhập số nguyên từ 1 đến 1000.")).toBeVisible();
  await CAP(p).fill("200");
  const put = p.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/tenants\/[0-9a-f-]{36}$/.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await put).status()).toBe(200);
  await p.reload();
  await expect(CAP(p)).toHaveValue("200");
  const [row] = await withSql(
    (sql) => sql`select process_runs_max as n from admin.tenants where id = ${TENANT_ID.acme}`,
  );
  expect(Number(row?.n)).toBe(200);
});

test("N2-FR-05 · tadmin bật 'không cho người bắt đầu duyệt' ở stage Duyệt ⇒ Lưu 200, mở lại vẫn bật, def có exclude_starter", async ({
  page: p,
}) => {
  await openDef(p, "pd-edit", "Chờ hạn E2E");
  await node(p, "Đọc hồ sơ").click();
  const cb = panel(p).getByRole("checkbox", { name: EXCLUDE });
  await expect(cb).not.toBeChecked();
  await cb.check();
  expect(await saveDef(p)).toBe(200);
  await p.reload();
  await node(p, "Đọc hồ sơ").click();
  await expect(panel(p).getByRole("checkbox", { name: EXCLUDE })).toBeChecked();
  expect((await defByKey("pd-edit")).stages?.[0]?.after?.exclude_starter).toBe(true);
});
