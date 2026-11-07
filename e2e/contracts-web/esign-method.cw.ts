// esign-method · CR-125 m4 · MOD-FR-11: người ký chọn cách ký lúc bấm "Ký ngay".
// (a) > 1 cách khả dụng ⇒ hộp "Chọn cách ký" (radio), chọn "Ký thử" ⇒ POST sign-url có provider "selfsign"; (b) 1 cách ⇒ ký thẳng, không hộp.
// Backend giả `page.route`; không sleep. Có chụp ảnh soát UI -> docs/specs/cr125-m4-esign/shots/.
import { expect, type Page, type Route, test } from "@playwright/test";
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
const state = (providers: unknown[]) => ({
  configured: true,
  enabled: true,
  provider: "docusign",
  default_provider: "docusign",
  demo: false,
  providers,
  ready: true,
  defaults: [],
  envelope: {
    id: "env-1",
    provider: "docusign",
    provider_label: "DocuSign",
    demo: false,
    status: "sent",
    signers: [
      {
        role: "company",
        name: "Nguyễn Lan",
        email: "lan@acme.vn",
        order: 1,
        embedded: true,
        status: "sent",
        signed_at: null,
        provider: null,
        certificate_ref: null,
      },
      {
        role: "partner",
        name: "Công ty B",
        email: "b@partner.vn",
        order: 2,
        embedded: false,
        status: "sent",
        signed_at: null,
        provider: null,
        certificate_ref: null,
      },
    ],
    reason: null,
    completed_at: null,
    created_at: "2026-10-18T01:00:00.000Z",
    has_signed_file: false,
  },
});

const SHOTS = "docs/specs/cr125-m4-esign/shots";

async function open(page: Page, providers: unknown[]) {
  await installV2f(page, { role: "editor", contract: locked });
  const signs: unknown[] = [];
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/esign`, (r) =>
    json(r, state(providers)),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/esign/sign-url`, (r) => {
    signs.push(r.request().postDataJSON());
    return json(r, { url: "/contracts?signed=1" });
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const panel = page.getByTestId("esign-panel");
  return { signs, panel, dlg: page.getByTestId("esign-method-dialog") };
}

test("Ký ngay: > 1 cách khả dụng ⇒ hộp Chọn cách ký, chọn Ký thử ⇒ sign-url có provider selfsign", async ({
  page,
}) => {
  const { signs, panel, dlg } = await open(page, [DOCUSIGN, SELFSIGN]);
  await panel.getByRole("button", { name: "Ký ngay" }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("radio")).toHaveCount(2);
  await expect(dlg.getByTestId("esign-method-docusign")).toBeChecked();
  await expect(dlg.getByTestId("esign-method-selfsign")).not.toBeChecked();
  await expect(dlg).toContainText("Chọn cách ký");
  await expect(dlg).toContainText("Ký thử");
  await dlg.getByTestId("esign-method-selfsign").check();
  await dlg.screenshot({ path: `${SHOTS}/1-chon-cach-ky.png` });
  await page.screenshot({ path: `${SHOTS}/1-chon-cach-ky-trang.png` });
  await dlg.getByTestId("esign-method-confirm").click();
  await expect.poll(() => signs.length).toBe(1);
  expect(signs[0]).toMatchObject({ provider: "selfsign" });
});

test("Ký ngay: chỉ 1 cách khả dụng ⇒ gọi sign-url thẳng, không hộp", async ({ page }) => {
  const { signs, panel, dlg } = await open(page, [DOCUSIGN, { ...SELFSIGN, available: false }]);
  await panel.getByRole("button", { name: "Ký ngay" }).click();
  await expect.poll(() => signs.length).toBe(1);
  await expect(dlg).toHaveCount(0);
  expect((signs[0] as { provider?: string }).provider).toBeUndefined();
});
