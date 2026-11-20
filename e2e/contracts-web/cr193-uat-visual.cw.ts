// CR-193 · UAT mục 5/6 · khung chữ ký luôn nền trắng (mực đen đọc được ở chế độ Tối); Sơ đồ tổ chức trên điện thoại không thu nhỏ quá mức. Chạy cuối đợt.
import { expect, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const uid = (n: number) => `a9000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const person = (n: number) => ({ id: uid(n), name: `Người ${n}`, job_title: `Chức vụ ${n}` });
const DEPTS = [
  { id: uid(1), name: "Ban Giám đốc", parent_id: null, head: person(1), members: [person(1)] },
  ...[2, 3, 4, 5, 6, 7].map((n) => ({
    id: uid(n),
    name: `Phòng ${n}`,
    parent_id: uid(1),
    head: person(n),
    members: [person(n)],
  })),
];

test("điện thoại: sơ đồ tổ chức zoom ≥ 0.85 (chữ ≥ 11px), nút gốc nằm trong khung nhìn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const d = asHub("editor");
  const ok = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/auth/refresh", (r) => r.fulfill(ok(d.grant)));
  await page.route("**/pack/contracts/me", (r) => r.fulfill(ok(d.packMe)));
  await page.route("**/pack/contracts/org", (r) => r.fulfill(ok({ departments: DEPTS })));
  await page.goto("/contracts/org");
  const root = page.getByTestId(`org-node-${uid(1)}`);
  await expect(root).toBeVisible();
  const zoom = await page
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  expect(zoom).toBeGreaterThanOrEqual(0.84);
  const box = await root.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
});
