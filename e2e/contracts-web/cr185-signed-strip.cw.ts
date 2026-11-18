// CR-185 (chạm avatar người ký) + CR-182 (đầu trang HĐ «Đã ký») · trang chi tiết HĐ đã ký đủ ở 390×844 có cảm ứng.
// Backend giả `page.route` (phiên ký dựng tay: một người ký Bên A + một người Bên B, mọi chỗ ký đã ký). Không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const A_ID = "a1000000-0000-4000-8000-0000000000a1";
const A_NAME = "Chi Nguyễn";
const B_NAME = "Hòa Trần";
const FILE_ID = "f1000000-0000-4000-8000-000000000001";

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const field = (
  id: string,
  side: "A" | "B",
  ref: string,
  kind: "user" | "partner",
  signed: boolean,
) => ({
  id,
  side,
  signer_kind: kind,
  signer_ref: ref,
  label: side,
  parts: ["signature"],
  mine: false,
  signed,
  signed_by: signed ? ref : null,
  signed_version_id: null,
});
const session = (bSigned: boolean) => ({
  enabled: true,
  mode: "view",
  locked: true,
  files: [
    {
      file_id: FILE_ID,
      name: "hd-bao-bi-2026.pdf",
      is_main: true,
      is_pdf: true,
      uploader_id: A_ID,
      can_prep: false,
      pages: 2,
      needs_sign: true,
      signed_by_me_in_turn: false,
      latest: { version_id: "v1", seq: 2, url: "/x.pdf" },
      fields: [
        field("c1000000-0000-4000-8000-000000000001", "A", A_ID, "user", true),
        field("c1000000-0000-4000-8000-000000000002", "B", "hoa@doitac.vn", "partner", bSigned),
      ],
    },
  ],
  signers: [
    { side: "A", kind: "user", ref: A_ID, name: A_NAME, mine: false },
    { side: "B", kind: "partner", ref: "hoa@doitac.vn", name: B_NAME, mine: false },
  ],
  readiness: { ready: true, missing: [] },
  turn: { allowed: false },
  kinds: { internal: true, digital: { enabled: false, reason: "off" } },
  partner_link: null,
});

async function open(page: Page, bSigned: boolean) {
  await installV2f(page, {
    role: "editor",
    contract: () => activeContract({ has_source: true, status: "done" }),
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/doc-sign-session`, (r) =>
    json(r, session(bSigned)),
  );
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("CR-185 · chạm avatar người ký ở 390px hiện đúng họ tên (không «Bên A», không «Đã ký»); chữ trạng thái nằm cạnh avatar", async ({
  page,
}) => {
  await open(page, true);
  const strip = page.getByTestId("signers-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId("signer-chip")).toHaveCount(2);
  await expect(strip).toContainText("Đã ký");
  const avatar = strip.getByRole("img", { name: A_NAME });
  await avatar.tap();
  const tip = page.getByRole("tooltip").first();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(A_NAME);
  await page.reload(); // mỗi lần thử một avatar, tooltip trước không còn
  await expect(page.getByTestId("signers-strip")).toBeVisible();
  await page.getByTestId("signers-strip").getByRole("img", { name: B_NAME }).tap();
  await expect(page.getByRole("tooltip").first()).toHaveText(B_NAME);
});

test("CR-182 · đầu trang HĐ ghi «Đã ký» khi mọi chỗ ký (cả Bên B) đã ký; còn chờ đối tác thì vẫn «Đã duyệt xong»", async ({
  page,
}) => {
  await open(page, true);
  const chip = page.getByTestId("status-chip");
  await expect(chip).toHaveText("Đã ký");
  await expect(chip).toHaveAttribute("data-status", "done");
  await expect(chip).toHaveAttribute("data-signed", "1");
});

test("CR-182 · còn chờ Bên B ký thì đầu trang chưa ghi «Đã ký»", async ({ page }) => {
  await open(page, false);
  const chip = page.getByTestId("status-chip");
  await expect(chip).toHaveText("Đã duyệt xong");
  await expect(chip).not.toHaveAttribute("data-signed", "1");
});
