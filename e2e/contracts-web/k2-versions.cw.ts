// CR-097 K3b · HD-FR-101/102: tải bản cập nhật từ HĐ đã khoá ⇒ mở bản nháp v2; bản bị thay = banner + chỉ đọc; badge vN ở danh sách;
// so sánh hai phiên bản. Backend giả `page.route`; chờ phần tử, không sleep.
import { expect, type Route, test } from "@playwright/test";
import { listAsHub } from "./dataset-list";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const V2_ID = "c1000000-0000-4000-8000-0000000000a2";
const ref = (id: string, no: number, sup: string | null, number: string, value: number) => ({
  id,
  version_no: no,
  status: "active",
  superseded_at: sup,
  number,
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  total_value: value,
});
const chain = (v1Superseded: boolean) => [
  ref(ACTIVE_ID, 1, v1Superseded ? "2026-10-18T02:00:00Z" : null, "HD-1", 245_000_000),
  ref(V2_ID, 2, null, "HD-1/PL", 300_000_000),
];
const locked = { locked_at: "2026-02-01T00:00:00Z", locked_by: null };
const v1 = (superseded: boolean) =>
  activeContract({
    ...locked,
    version_no: 1,
    versions_count: superseded ? 2 : 1,
    root_id: ACTIVE_ID,
    current_id: superseded ? V2_ID : ACTIVE_ID,
    superseded_at: superseded ? "2026-10-18T02:00:00Z" : null,
    superseded_by: superseded ? V2_ID : null,
    versions: superseded ? chain(true) : [chain(false)[0]],
  });

test("tải bản cập nhật từ HĐ đã khoá ⇒ POST multipart ⇒ mở nháp v2", async ({ page }) => {
  await installV2f(page, { role: "owner", contract: () => v1(false) });
  const posts: string[] = [];
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/versions`, (r) => {
    posts.push(r.request().headers()["content-type"] ?? "");
    return json(r, 201, {
      id: V2_ID,
      status: "extracting",
      version: 1,
      version_no: 2,
      root_id: ACTIVE_ID,
      supersedes_id: ACTIVE_ID,
    });
  });
  await page.route(`**/pack/contracts/contracts/${V2_ID}`, (r) =>
    json(r, 200, { ...v1(false), id: V2_ID, status: "needs_review", version_no: 2 }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByRole("button", { name: "Tải bản cập nhật" }).click();
  const dlg = page.getByTestId("upload-version");
  await expect(page.getByTestId("upload-version-signed")).toContainText("văn bản đã ký");
  await dlg.getByTestId("upload-version-file").setInputFiles({
    name: "hd-v2.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 v2"),
  });
  await dlg.getByTestId("upload-version-submit").click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${V2_ID}$`));
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain("multipart/form-data");
});

test("lỗi VERSION_DRAFT_EXISTS ⇒ thông báo tiếng Việt", async ({ page }) => {
  await installV2f(page, { role: "owner", contract: () => v1(false) });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/versions`, (r) =>
    json(r, 409, { error: { code: "VERSION_DRAFT_EXISTS", message: "x" } }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByRole("button", { name: "Tải bản cập nhật" }).click();
  await page.getByTestId("upload-version-file").setInputFiles({
    name: "hd-v2.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 v2"),
  });
  await page.getByTestId("upload-version-submit").click();
  await expect(page.getByTestId("upload-version-error")).toContainText(
    "bản cập nhật chưa xác nhận",
  );
});

test("bản bị thay: banner + chỉ đọc + khối phiên bản + so sánh", async ({ page }) => {
  await installV2f(page, { role: "owner", contract: () => v1(true) });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/versions/diff**`, (r) =>
    json(r, 200, {
      a: { id: ACTIVE_ID, version_no: 1 },
      b: { id: V2_ID, version_no: 2 },
      changes: [{ key: "total_value", a: 245_000_000, b: 300_000_000 }],
    }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("superseded-banner")).toContainText("Đã thay thế bởi Phiên bản 2");
  await expect(page.getByTestId("open-current")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tải bản cập nhật" })).toHaveCount(0);
  await expect(page.getByTestId("delete-contract")).toHaveCount(0);
  const block = page.getByTestId("versions-block");
  await expect(block.getByTestId("version-row-1")).toHaveAttribute("data-kind", "superseded");
  await expect(block.getByTestId("version-row-2")).toHaveAttribute("data-kind", "current");
  await expect(page.getByTestId("diff-total_value")).toContainText("300.000.000");
});

test("danh sách: badge v2 khi có nhiều phiên bản", async ({ page }) => {
  await installV2f(page, { role: "owner" });
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      const list = listAsHub() as { items: Record<string, unknown>[] };
      list.items[0] = { ...list.items[0], version_no: 2, versions_count: 2 };
      return json(r, 200, list);
    },
  );
  await page.goto("/contracts");
  await expect(page.getByTestId("version-badge").first()).toHaveText("v2");
});
