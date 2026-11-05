// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-121 D-5 (R8) · HÀNH TRÌNH 2 CÔNG TY trên stack thật (không seed bật sẵn gì): hai công ty MỚI (hậu tố duy nhất, chưa quy trình/luật/gán).
// Platform admin: nhân bản quy trình duyệt từ thư viện thành 2 bản khác nhau rồi xuất bản
//   A = Kế toán → Giám đốc (CHỈ khi Giá trị ≥ 500 tr VÀ Loại = Mua) · B = 1 bước Giám đốc,
// gán A cho công ty 1, B cho công ty 2 ở Công ty › Ứng dụng & Gói (KHÔNG bật công tắc nào). Người dùng mỗi công ty gửi duyệt HĐ 600 tr và
// 100 tr (Mua) ⇒ đúng bước chạy/bỏ qua theo quy trình của công ty đó; sửa giá trị HĐ đang chờ 600 → 100 tr ⇒ bước Giám đốc bị bỏ qua khi tới;
// trang "Chi tiết lượt chạy" (admin) hiện đúng bước + nhật ký; công ty 1 không thấy dữ liệu công ty 2.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, cloneAndPublishFlow, type Session, tenantIdByKey } from "../_kit/api";
import { assignProcessUi } from "../_kit/ui";
import {
  approveAs,
  type Env,
  loginAdmin,
  loginCw,
  processBlock,
  SLOT,
  stepOf,
  U,
  uploadAndOpen,
} from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const base = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
};
const mkEnv = (k: "a" | "b"): Env => ({
  ...base,
  tenantKey: `e2e-d5${k}-${SFX}`,
  tenantName: `E2E D5${k.toUpperCase()} ${SFX}`,
});
const EA = mkEnv("a");
const EB = mkEnv("b");
const PROC_A = `E2E D5 A ${SFX}`;
const PROC_B = `E2E D5 B ${SFX}`;
const KT = "Phòng Kế toán duyệt";
const GD = "Ban Giám đốc duyệt";
const M600 = 600_000_000;
const M100 = 100_000_000;
const RUN = Date.now().toString(36);

type Card = {
  run_id: string | null;
  run_status: string | null;
  can_act: boolean;
  steps?: { idx: number; name: string; status: string; skip_when?: unknown[] | null }[];
};
const pack = (p: string) => `${HUB}/pack/contracts${p}`;
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();

async function userApi(e: Env, user: string): Promise<Session> {
  return apiLogin({
    base: API,
    tenantKey: e.tenantKey,
    username: user,
    password: e.pw,
    app: "contracts",
  });
}
async function getJson<T>(s: Session, url: string): Promise<{ status: number; json: T }> {
  const r = await fetch(url, { headers: s.headers });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : undefined) as T };
}
const cardOf = async (s: Session, id: string): Promise<Card> =>
  (await getJson<Card>(s, pack(`/contracts/${id}/approval`))).json;
const stepStatus = (c: Card, name: string): string | undefined =>
  c.steps?.find((x) => x.name === name)?.status;
/** Nhân viên Kinh doanh của công ty gửi duyệt một HĐ Mua giá trị `total` (tải lên + "Xác nhận và lưu"). Trả trang + id HĐ. */
async function submit(
  browser: import("@playwright/test").Browser,
  e: Env,
  tag: string,
  total: number,
): Promise<{ emp: Page; id: string }> {
  const emp = await ctxPage(browser);
  await loginCw(emp, e, U.employee);
  const id = await uploadAndOpen(emp, e, `${RUN}${tag}`, total);
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
  return { emp, id };
}

const ids: Record<string, string> = {};

test("1 · platform admin nhân bản quy trình từ thư viện thành 2 bản khác nhau và xuất bản", async () => {
  const s = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: base.adminUser,
    password: base.adminPw,
  });
  // A: bước 2 (Giám đốc) chỉ chạy khi Giá trị ≥ 500 tr VÀ Loại = Mua
  ids.defA = await cloneAndPublishFlow(HUB, s, {
    fromKey: "e2e-mua-kd",
    key: `e2e-d5-a-${SFX}`,
    name: PROC_A,
    editSteps: (steps) =>
      steps.map((st, i) =>
        i === 1
          ? {
              ...st,
              when: {
                op: "and",
                conds: [
                  { field: "total_value", op: "ge", value: 500_000_000 },
                  { field: "deal", in: ["buy"] },
                ],
              },
            }
          : st,
      ),
  });
  // B: một bước Giám đốc
  ids.defB = await cloneAndPublishFlow(HUB, s, {
    fromKey: "e2e-ban-kd",
    key: `e2e-d5-b-${SFX}`,
    name: PROC_B,
  });
});

test("2 · platform admin gán A cho công ty 1, B cho công ty 2 (không công tắc nào khác)", async ({
  browser,
}) => {
  const page = await ctxPage(browser);
  await loginAdmin(page, base as Env);
  for (const [e, name] of [
    [EA, PROC_A],
    [EB, PROC_B],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("list", { name: "Danh sách công ty" })
      .getByRole("link", { name: new RegExp(e.tenantName) })
      .click();
    await page.getByRole("tab", { name: "Ứng dụng" }).click();
    const card = page.getByRole("region", { name: /Sổ Hợp Tác|Hợp đồng/ }).first();
    const blk = processBlock(card);
    await expect(blk).toBeVisible();
    await expect(blk.getByTestId("tenant-engine-switch")).toHaveCount(0);
    await assignProcessUi(blk.getByTestId(`admin-assigned-${SLOT}`), name);
  }
});

test("3 · công ty 1: HĐ 600 tr Mua đi qua Kế toán rồi Giám đốc, duyệt xong là khoá", async ({
  browser,
}) => {
  const { emp, id } = await submit(browser, EA, "a6", M600);
  ids.a600 = id;
  await expect(stepOf(emp, KT)).toBeVisible({ timeout: 60_000 });
  await expect(stepOf(emp, GD)).toBeVisible();
  await expect(emp.locator('[data-approval-skip="will"]')).toHaveCount(0); // 600 tr ≥ 500 tr & Mua ⇒ Giám đốc sẽ chạy
  await approveAs(await ctxPage(browser), EA, U.accounting, id, KT);
  await approveAs(await ctxPage(browser), EA, U.director, id, GD);
  await emp.goto(`${EA.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
});

test("4 · công ty 1: HĐ 100 tr Mua bỏ qua bước Giám đốc — Kế toán duyệt là xong", async ({
  browser,
}) => {
  const { emp, id } = await submit(browser, EA, "a1", M100);
  await expect(stepOf(emp, KT)).toBeVisible({ timeout: 60_000 });
  await expect(stepOf(emp, GD).locator('[data-approval-skip="will"]')).toBeVisible(); // nói rõ sẽ bỏ qua
  await approveAs(await ctxPage(browser), EA, U.accounting, id, KT);
  await emp.goto(`${EA.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
  await expect(stepOf(emp, GD)).toHaveAttribute("data-status", "skipped");
});

test("5 · công ty 1: sửa giá trị HĐ đang chờ 600 → 100 tr ⇒ bước Giám đốc bị bỏ qua khi tới", async ({
  browser,
}) => {
  // HĐ 600 tr đang chờ nhân viên xác nhận; sau khi gửi duyệt giá trị bị khoá, nên sửa 600 → 100 tr TRƯỚC khi xác nhận (API nút "Lưu nháp")
  const emp = await ctxPage(browser);
  await loginCw(emp, EA, U.employee);
  const id = await uploadAndOpen(emp, EA, `${RUN}a2`, M600);
  ids.aEdit = id;
  const me = await userApi(EA, U.employee);
  await expect
    .poll(
      async () => {
        const cur = (await getJson<{ version: number }>(me, pack(`/contracts/${id}`))).json;
        const patch = await fetch(pack(`/contracts/${id}/fields`), {
          method: "PATCH",
          headers: { ...me.headers, "content-type": "application/json" },
          body: JSON.stringify({ version: cur.version, fields: { total_value: M100 } }),
        });
        return patch.status;
      },
      { message: "sửa giá trị khi HĐ chờ xác nhận" },
    )
    .toBe(200);
  await emp.reload(); // form tải lại giá trị mới rồi mới xác nhận
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(stepOf(emp, KT)).toBeVisible({ timeout: 60_000 });

  // Thẻ duyệt đổi theo giá trị HIỆN TẠI: Giám đốc sẽ bị bỏ qua
  const acc = await userApi(EA, U.accounting);
  await expect
    .poll(
      async () => (await cardOf(acc, id)).steps?.find((x) => x.name === GD)?.skip_when?.length ?? 0,
      {
        message: "thẻ duyệt phải báo Giám đốc sẽ bị bỏ qua",
      },
    )
    .toBeGreaterThan(0);
  await approveAs(await ctxPage(browser), EA, U.accounting, id, KT);
  await expect
    .poll(async () => stepStatus(await cardOf(me, id), GD), { message: "Giám đốc bị bỏ qua" })
    .toBe("skipped");
  await emp.goto(`${EA.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
});

test("6 · công ty 2: chỉ một bước Giám đốc, không phụ thuộc giá trị (600 tr và 100 tr)", async ({
  browser,
}) => {
  for (const [tag, total] of [
    ["b6", M600],
    ["b1", M100],
  ] as const) {
    const { emp, id } = await submit(browser, EB, tag, total);
    ids[tag] = id;
    await expect(stepOf(emp, GD)).toBeVisible({ timeout: 60_000 });
    await expect(stepOf(emp, KT)).toHaveCount(0); // quy trình của công ty 1 không lan sang công ty 2
    await expect(emp.locator('[data-approval-skip="will"]')).toHaveCount(0);
    await approveAs(await ctxPage(browser), EB, U.director, id, GD);
    await emp.goto(`${EB.cw}/contracts/c/${id}`);
    await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
  }
});

test("7 · admin: 'Chi tiết lượt chạy' của HĐ đã sửa giá trị hiện đúng bước (Giám đốc: bỏ qua) và nhật ký", async ({
  browser,
}) => {
  const me = await userApi(EA, U.employee);
  const runId = (await cardOf(me, ids.aEdit as string)).run_id;
  expect(runId).toBeTruthy();
  // Cùng dữ liệu qua API (platform admin + tenant_id): chẩn đoán rõ nếu trang không hiện được
  const ps = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: base.adminUser,
    password: base.adminPw,
  });
  const tid = await tenantIdByKey(API, ps, EA.tenantKey);
  const det = await getJson<{ steps?: { name: string; state: string }[] }>(
    ps,
    `${HUB}/process-runs/${runId}/detail?tenant_id=${tid}`,
  );
  expect(det.status, JSON.stringify(det.json).slice(0, 200)).toBe(200);
  expect(det.json.steps?.find((x) => x.name === GD)?.state).toBe("skipped");
  const page = await ctxPage(browser);
  await loginAdmin(page, base as Env);
  await page.goto(`${base.admin}/processes`);
  // màn Quy trình xem theo công ty đã chọn (nhớ trong phiên trình duyệt)
  await page.evaluate((k) => sessionStorage.setItem("ai.process.tenant", k), EA.tenantKey);
  await page.goto(`${base.admin}/processes/e2e-d5-a-${SFX}/runs/${runId}`);
  const steps = page.getByTestId("run-step");
  await expect(steps.first()).toBeVisible({ timeout: 30_000 });
  await expect(steps.filter({ hasText: GD })).toHaveAttribute("data-state", "skipped");
  await expect(steps.filter({ hasText: KT })).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("run-id")).toContainText((runId as string).slice(0, 8));
  await steps.filter({ hasText: GD }).click(); // mở nhật ký bước
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("8 · công ty 1 không thấy dữ liệu công ty 2", async () => {
  const a = await userApi(EA, U.employee);
  expect(ids.b6 && ids.b1, "ca 6 phải chạy trước (cùng worker)").toBeTruthy();
  for (const k of ["b6", "b1"]) {
    const r = await getJson<unknown>(a, pack(`/contracts/${ids[k]}`));
    expect(r.status, `HĐ công ty 2 (${k}) lộ cho công ty 1`).toBe(404);
    const c = await getJson<unknown>(a, pack(`/contracts/${ids[k]}/approval`));
    expect(c.status).toBe(404);
  }
  const list = await getJson<{ items?: { id: string }[] }>(a, pack("/contracts?limit=100"));
  expect(list.status).toBe(200);
  const seen = new Set((list.json.items ?? []).map((x) => x.id));
  expect(seen.has(ids.a600 as string)).toBe(true);
  expect(seen.has(ids.b6 as string)).toBe(false);
  expect(seen.has(ids.b1 as string)).toBe(false);
});
