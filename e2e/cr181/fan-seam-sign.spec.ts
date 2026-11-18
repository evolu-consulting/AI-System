// CR-182 · fan · «Xoè quạt» mép phải: người ký (giám đốc, khác người soạn) đặt MỘT chữ ký đè lên dải của 5 trang ⇒ Lưu ⇒ bản ký có 5 phần (giáp lai 5 trang, BR-L4).
// Cùng công ty/khuôn với sign-prep-and-sign.spec.ts (HĐ mẫu 6 trang); chưa chạy (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { addMineAt, headSignsAndPasses, saleSends } from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);

test("giám đốc: Xoè quạt mép phải, chữ ký đè 5 trang ⇒ Lưu ⇒ POST /sign có 1 giáp lai 5 phần", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const id = await saleSends(browser, E, `${RUN}f`, U.employee);
  await headSignsAndPasses(browser, E, id);
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await page.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click(); // ô của mình ở «Từng trang»

  // Kiểu xem: Xoè quạt, Mép phải, nhóm «Trang 1–5»
  await page.getByRole("radio", { name: "Xoè quạt" }).click();
  await expect(page.getByRole("radio", { name: "Mép phải" })).toBeChecked();
  await expect(page.getByTestId("sign-group-label")).toHaveText("Trang 1–5");
  await expect(page.getByTestId("sign-page")).toHaveCount(5);

  // thả «Chữ ký của tôi» sát mép phải trang đầu, rồi kéo góc dưới-phải cho đè hết 4 dải (4 × 40px)
  const first = await page.getByTestId("sign-page").first().boundingBox();
  if (!first) throw new Error("không có trang 1");
  await addMineAt(page, 0, 0.97, 0.5);
  const mark = page.getByRole("group", { name: /^Chữ ký, / }).first();
  await mark.click();
  const corner = mark.locator('[data-corner="se"]');
  const c = await corner.boundingBox();
  if (!c) throw new Error("không có góc đổi cỡ");
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 220, c.y + c.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole("group", { name: "Chữ ký, Giáp lai 5 trang: 1, 2, 3, 4, 5" }),
  ).toBeVisible();

  // sang «Từng trang»: chữ ký vẫn hiện nhưng không kéo được
  await page.getByRole("radio", { name: "Từng trang" }).click();
  await expect(page.getByTestId("sign-mark-locked")).toBeVisible();
  await page.getByRole("radio", { name: "Xoè quạt" }).click();
  await expect(page.getByTestId("sign-mark")).toBeVisible();

  const isSign = (m: string, u: string) => m === "POST" && u.endsWith("/sign");
  const reqP = page.waitForRequest((r) => isSign(r.method(), r.url()));
  await page.getByRole("button", { name: /^Lưu/ }).first().click();
  await expect(page.getByTestId("sign-confirm")).toContainText("1 giáp lai");
  await page.getByRole("button", { name: "Lưu chữ ký" }).click();
  const body = (await reqP).postData() ?? "";
  const seam = findSeam(JSON.parse(body));
  expect(seam?.parts.map((q) => q.page)).toEqual([0, 1, 2, 3, 4]);
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`), { timeout: 30_000 });
  await page.context().close();
});

type Seam = { placement: string; parts: { page: number }[] };
function findSeam(v: unknown): Seam | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.placement === "seam" && Array.isArray(o.parts)) return o as unknown as Seam;
  for (const x of Object.values(o)) {
    const f = findSeam(x);
    if (f) return f;
  }
  return undefined;
}
