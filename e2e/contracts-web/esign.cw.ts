// cf-esign-docusign · Luật 4b: khối "Ký số" ở chi tiết HĐ đã khoá — Gửi ký (người ký gợi ý sửa được, tuần tự) ⇒ "Đang chờ ký" ⇒
// Làm mới trạng thái ⇒ "Đã ký số" + tải bản đã ký; chưa cấu hình ⇒ "Chưa cấu hình ký số"; ký thử ⇒ nhãn không có giá trị pháp lý;
// viewer không thấy "Gửi ký". Backend giả `page.route`; không sleep.
import { expect, type Route, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const locked = () =>
  activeContract({ locked: true, locked_at: "2026-10-17T02:00:00.000Z", locked_by: "u1" });
const json = (r: Route, body: unknown, status = 200) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const base = {
  configured: true,
  enabled: true,
  provider: "docusign",
  demo: false,
  ready: true,
  envelope: null as unknown,
  defaults: [
    { role: "company", name: "Nguyễn Lan", email: "lan@acme.vn" },
    { role: "partner", name: "Công ty B", email: "" },
  ],
};
const env = (status: string, o: object = {}) => ({
  id: "e1000000-0000-4000-8000-000000000001",
  provider: "docusign",
  demo: false,
  status,
  signers: [
    {
      role: "company",
      name: "Nguyễn Lan",
      email: "lan@acme.vn",
      order: 1,
      embedded: true,
      status: null,
      signed_at: null,
    },
    {
      role: "partner",
      name: "Công ty B",
      email: "b@partner.vn",
      order: 2,
      embedded: false,
      status: null,
      signed_at: null,
    },
  ],
  reason: null,
  completed_at: null,
  created_at: "2026-10-18T02:00:00.000Z",
  has_signed_file: false,
  ...o,
});
const ES = `**/pack/contracts/contracts/${ACTIVE_ID}/esign`;

test("editor: Gửi ký với người ký đã sửa ⇒ Đang chờ ký ⇒ Làm mới ⇒ Đã ký số + Tải bản đã ký", async ({
  page,
}) => {
  await installV2f(page, { role: "editor", contract: locked });
  let state: unknown = base;
  const posts: unknown[] = [];
  await page.route(ES, (r) => {
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON());
      state = { ...base, envelope: env("sent") };
      return json(r, state, 201);
    }
    return json(r, state);
  });
  await page.route(`${ES}/refresh`, (r) => {
    state = {
      ...base,
      envelope: env("completed", {
        completed_at: "2026-10-18T03:00:00.000Z",
        has_signed_file: true,
      }),
    };
    return json(r, state);
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  const panel = page.getByTestId("esign-panel");
  await panel.getByTestId("esign-send").click();
  const dlg = page.getByRole("dialog", { name: "Gửi hợp đồng đi ký số" });
  const ok = dlg.getByTestId("esign-send-confirm");
  await expect(ok).toBeDisabled(); // email đối tác trống
  await dlg.getByLabel("Email 2").fill("b@partner.vn");
  await ok.click();
  await expect(panel.getByTestId("esign-status")).toHaveText("Đang chờ ký");
  expect(posts).toEqual([
    {
      signers: [
        { role: "company", name: "Nguyễn Lan", email: "lan@acme.vn" },
        { role: "partner", name: "Công ty B", email: "b@partner.vn" },
      ],
    },
  ]);
  await expect(panel.getByRole("button", { name: "Ký ngay" })).toBeVisible();
  await panel.getByRole("button", { name: "Làm mới trạng thái" }).click();
  await expect(panel.getByTestId("esign-status")).toContainText("Đã ký số lúc");
  await expect(panel.getByRole("button", { name: "Tải bản đã ký" })).toBeVisible();
});

test("chưa cấu hình nhà cung cấp ⇒ «Chưa cấu hình ký số», không có nút Gửi ký", async ({
  page,
}) => {
  await installV2f(page, { role: "owner", contract: locked });
  await page.route(ES, (r) =>
    json(r, { ...base, configured: false, enabled: false, provider: null }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("esign-hint")).toHaveText("Chưa cấu hình ký số");
  await expect(page.getByTestId("esign-send")).toHaveCount(0);
});

test("ký thử đã ký ⇒ nhãn «Ký thử – không có giá trị pháp lý»; viewer không thấy Gửi ký khi bị từ chối", async ({
  page,
}) => {
  await installV2f(page, { role: "viewer", contract: locked });
  let state: unknown = {
    ...base,
    provider: "selfsign",
    demo: true,
    envelope: env("completed", {
      provider: "selfsign",
      demo: true,
      has_signed_file: true,
      completed_at: "2026-10-18T03:00:00.000Z",
    }),
  };
  await page.route(ES, (r) => json(r, state));
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("esign-demo")).toHaveText("Ký thử – không có giá trị pháp lý");
  state = { ...base, envelope: env("declined", { reason: "Sai đơn giá" }) };
  await page.reload();
  await expect(page.getByText("Lý do: Sai đơn giá")).toBeVisible();
  await expect(page.getByTestId("esign-send")).toHaveCount(0);
});
