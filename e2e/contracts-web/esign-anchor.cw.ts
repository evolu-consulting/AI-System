// esign-anchor · Luật 4b: (a) Cài đặt › Quy trình duyệt hiện danh sách cụm Bên A/B, owner sửa ⇒ PUT /esign/anchors {a[], b[]};
// (b) hộp Gửi ký hiện "Vị trí ký: trong văn bản" theo GET /esign/placement. Backend giả `page.route`; không sleep.
import { expect, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown, status = 200) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const DOCUSIGN = {
  key: "docusign",
  label: "DocuSign",
  kind: "envelope",
  available: true,
  legal: true,
};
const settings = {
  configured: true,
  enabled: true,
  provider: "docusign",
  default_provider: "docusign",
  demo: false,
  providers: [DOCUSIGN],
};
const DEF = { a: ["ĐẠI DIỆN BÊN A", "BÊN A"], b: ["ĐẠI DIỆN BÊN B", "BÊN B"], is_default: true };

test("Cài đặt: danh sách cụm Bên A/B, owner sửa ⇒ PUT /esign/anchors", async ({ page }) => {
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
  await page.route("**/pack/contracts/esign/settings", (r) => json(r, settings));
  const puts: unknown[] = [];
  await page.route("**/pack/contracts/esign/anchors", (r) => {
    if (r.request().method() === "PUT") {
      const b = r.request().postDataJSON() as { a: string[]; b: string[] };
      puts.push(b);
      return json(r, { ...b, is_default: false });
    }
    return json(r, DEF);
  });
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  const box = dlg.getByTestId("esign-anchor-setting");
  await expect(box.getByTestId("esign-anchor-a")).toHaveValue("ĐẠI DIỆN BÊN A\nBÊN A");
  await expect(box.getByTestId("esign-anchor-b")).toHaveValue("ĐẠI DIỆN BÊN B\nBÊN B");
  await box.getByTestId("esign-anchor-a").fill("ĐẠI DIỆN BÊN MUA\n\n  BÊN A ");
  await box.getByTestId("esign-anchor-save").click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ a: ["ĐẠI DIỆN BÊN MUA", "BÊN A"], b: ["ĐẠI DIỆN BÊN B", "BÊN B"] });
  await box.getByTestId("esign-anchor-b").fill("  ");
  await expect(box.getByTestId("esign-anchor-save")).toBeDisabled();
});

test("Gửi ký: hiện 'Vị trí ký: trong văn bản' theo xem trước của server", async ({ page }) => {
  await installV2f(page, {
    role: "editor",
    contract: () =>
      activeContract({ locked: true, locked_at: "2026-10-17T02:00:00.000Z", locked_by: "u1" }),
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/esign`, (r) =>
    json(r, {
      ...settings,
      ready: true,
      envelope: null,
      defaults: [
        { role: "company", name: "Nguyễn Lan", email: "lan@acme.vn" },
        { role: "partner", name: "Công ty B", email: "b@partner.vn" },
      ],
    }),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/esign/placement`, (r) =>
    json(r, { placement: "text" }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("esign-panel").getByTestId("esign-send").click();
  const dlg = page.getByRole("dialog", { name: "Gửi hợp đồng đi ký số" });
  await expect(dlg.getByTestId("esign-placement")).toHaveText("Vị trí ký: trong văn bản");
});
