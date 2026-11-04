// CR-118 · cr118-prod-fix · cờ HUB_FLOW_RUNTIME tắt (prod) ⇒ danh sách HĐ KHÔNG gửi yêu cầu `/pack/contracts/flow/*` (trước đây 1 yêu cầu 404
// mỗi lần tải ⇒ "Failed to load resource … 404" ở console); cờ bật ⇒ vẫn gửi đúng MỘT yêu cầu tóm tắt cho cả trang.
// Backend giả `page.route` (cờ lấy từ `/pack/me.flags["flow.runtime"]`); chờ yêu cầu/phần tử, không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub } from "./dataset-list";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const ID = "c1000000-0000-4000-8000-000000000001";
const packMe = (flowRuntime: boolean) => ({
  versions: { admin: 1, hub: 1 },
  user: { id: ID, tenant_id: ID, role: "member", kind: "internal" },
  packs: {
    contracts: { enabled: true, level: "write", actions: ["read", "write"] },
  },
  addons: [],
  flags: {
    contracts: true,
    "contracts.read": true,
    "contracts.write": true,
    "flow.runtime": flowRuntime,
  },
  brand: null,
  home: "contracts",
  apps: ["contracts"],
});

async function install(page: Page, flowRuntime: boolean) {
  const d = asHub("editor");
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
  await page.route(
    (u) => u.pathname === "/pack/me",
    (r) => json(r, packMe(flowRuntime)),
  );
  const at = (n: string) => (u: URL) => u.pathname === `/pack/contracts/${n}`;
  await page.route(at("contracts/facets"), (r) => json(r, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, membersAsHub()));
  await page.route(at("contracts"), (r) => json(r, listAsHub()));
}

test.describe("CR-118 · cờ flow runtime ở danh sách HĐ", () => {
  test("cờ TẮT ⇒ không yêu cầu /flow/* nào, không 404 ở console", async ({ page }) => {
    await install(page, false);
    const flowCalls: string[] = [];
    const notFound: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.includes("/flow/")) flowCalls.push(r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error" && /404/.test(m.text())) notFound.push(m.text());
    });
    await page.route("**/pack/contracts/flow/**", (r) =>
      json(r, { error: { code: "NOT_FOUND" } }, 404),
    );
    await page.goto("/contracts");
    await expect(page.getByText("Hợp đồng cung cấp gia vị").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(flowCalls).toEqual([]);
    expect(notFound).toEqual([]);
  });

  test("cờ BẬT ⇒ đúng một POST tóm tắt cho cả trang", async ({ page }) => {
    await install(page, true);
    const summary = page.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        /\/pack\/contracts\/flow\/contracts\.approval\/summary$/.test(new URL(r.url()).pathname),
    );
    await page.route("**/pack/contracts/flow/**", (r) =>
      json(r, { slot: "contracts.approval", items: [] }),
    );
    await page.goto("/contracts");
    await expect(page.getByText("Hợp đồng cung cấp gia vị").first()).toBeVisible();
    await summary;
  });
});
