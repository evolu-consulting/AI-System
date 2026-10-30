// esign-multi · Luật 4b: (a) Cài đặt hiện các nhà cung cấp + đổi mặc định ⇒ PUT {default_provider}; (b) hộp Gửi ký có dropdown,
// chọn "selfsign" ⇒ POST có provider, người ký công ty chỉ đọc (không name/email); (c) 1 nhà cung cấp khả dụng ⇒ không dropdown.
// Backend giả `page.route`; không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown, status = 200) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const locked = () =>
  activeContract({ locked: true, locked_at: "2026-10-17T02:00:00.000Z", locked_by: "u1" });

const DOCUSIGN = {
  key: "docusign",
  label: "DocuSign",
  kind: "envelope",
  available: true,
  legal: true,
};
const SELFSIGN = { key: "selfsign", label: "Ký thử", kind: "ca", available: true, legal: false };
const MISA = { key: "misa", label: "MISA", kind: "ca", available: false, legal: true };
const settings = (providers: unknown[], def: string) => ({
  configured: true,
  enabled: true,
  provider: def,
  default_provider: def,
  demo: def === "selfsign",
  providers,
});
const base = (providers: unknown[], def: string) => ({
  ...settings(providers, def),
  ready: true,
  envelope: null,
  defaults: [
    { role: "company", name: "Nguyễn Lan", email: "lan@acme.vn" },
    { role: "partner", name: "Công ty B", email: "b@partner.vn" },
  ],
});
const ES = `**/pack/contracts/contracts/${ACTIVE_ID}/esign`;

test("Cài đặt: hiện 2 nhà cung cấp (pháp lý / không) và đổi mặc định ⇒ PUT default_provider", async ({
  page,
}) => {
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const grant = { ...d.grant, user: { ...d.grant.user, role: "tenant_admin" } };
  await page.route("**/auth/refresh", (r) => json(r, grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  await page.route("**/pack/contracts/groups", (r) => json(r, []));
  await page.route("**/pack/contracts/dify-workflows", (r) => json(r, { items: [] }));
  await page.route("**/pack/contracts/approval-flow", (r) =>
    json(r, {
      def_id: "11111111-1111-4111-8111-111111111111",
      name: "Quy trình HĐ mặc định",
      rel_version: 1,
      is_default: true,
      steps: [],
    }),
  );
  const puts: unknown[] = [];
  await page.route("**/pack/contracts/esign/settings", (r) => {
    if (r.request().method() === "PUT") {
      const b = r.request().postDataJSON() as { default_provider: string };
      puts.push(b);
      return json(r, settings([DOCUSIGN, SELFSIGN, MISA], b.default_provider));
    }
    return json(r, settings([DOCUSIGN, SELFSIGN, MISA], "docusign"));
  });
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  const box = dlg.getByTestId("esign-provider-setting");
  await expect(box.getByTestId("esign-prov-docusign")).toContainText("Có giá trị pháp lý");
  await expect(box.getByTestId("esign-prov-selfsign")).toContainText("Không có giá trị pháp lý");
  await expect(box.getByTestId("esign-prov-misa")).toContainText("Chưa cấu hình");
  await expect(box.getByRole("option", { name: /MISA/ })).toHaveJSProperty("disabled", true);
  await box.getByRole("combobox").selectOption("selfsign");
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ default_provider: "selfsign" });
});

async function openSend(page: Page, providers: unknown[], def: string) {
  await installV2f(page, { role: "editor", contract: locked });
  const posts: unknown[] = [];
  await page.route(ES, (r) => {
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON());
      return json(r, base(providers, def), 201);
    }
    return json(r, base(providers, def));
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("esign-panel").getByTestId("esign-send").click();
  return { posts, dlg: page.getByRole("dialog", { name: "Gửi hợp đồng đi ký số" }) };
}

test("Gửi ký: dropdown nhà cung cấp, chọn selfsign ⇒ POST có provider; người ký công ty chỉ đọc", async ({
  page,
}) => {
  const { posts, dlg } = await openSend(page, [DOCUSIGN, SELFSIGN, MISA], "docusign");
  const sel = dlg.getByTestId("esign-provider-select");
  await expect(sel).toHaveValue("docusign");
  await expect(sel.locator("option")).toHaveCount(2); // MISA không khả dụng ⇒ không có
  await expect(dlg.getByTestId("esign-company-readonly")).toContainText("lan@acme.vn");
  await expect(dlg.getByTestId("esign-signer-0").locator("input")).toHaveCount(0);
  await sel.selectOption("selfsign");
  await expect(dlg.getByTestId("esign-dialog-demo")).toBeVisible();
  await dlg.getByTestId("esign-send-confirm").click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({
    signers: [{ role: "company" }, { role: "partner", name: "Công ty B", email: "b@partner.vn" }],
    provider: "selfsign",
  });
});

test("Gửi ký: chỉ 1 nhà cung cấp khả dụng ⇒ không có dropdown", async ({ page }) => {
  const { dlg } = await openSend(page, [DOCUSIGN, { ...SELFSIGN, available: false }], "docusign");
  await expect(dlg.getByTestId("esign-send-confirm")).toBeEnabled();
  await expect(dlg.getByTestId("esign-provider-select")).toHaveCount(0);
});
