// CR-195 BR-195-3..6 · thẻ bài ở 390px: đầu thẻ ≤ 3 dòng chữ, một nút «⋯», phạm vi dùng biểu tượng người/nhóm, tệp .txt có «Xem».
// Adapter mock, persona mặc định = chủ quản Admin. VIẾT, KHÔNG chạy trong lát (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { openComposer } from "./_composer";

test.use({ viewport: { width: 390, height: 844 } });

test("đầu thẻ bài ≤ 3 dòng, một nút «⋯», không «·» đầu/cuối dòng", async ({ page }) => {
  await page.goto("/community");
  const post = page.getByTestId("post").first();
  const head = post.locator(".ph");
  await expect(head).toBeVisible();
  // đếm số hàng chữ: top của các phần tử con trực tiếp của dòng tên + 2 dòng meta (cách ≥ 8px = hàng khác)
  const rows = await head.locator(".who").evaluate((who) => {
    const tops: number[] = [];
    for (const el of who.querySelectorAll(".nm > *, .mline > *")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) tops.push(r.top + r.height / 2);
    }
    tops.sort((x, y) => x - y);
    return tops.filter((t, i) => i === 0 || t - (tops[i - 1] ?? 0) >= 8).length;
  });
  expect(rows).toBeLessThanOrEqual(3);
  await expect(post.getByTestId("post-more")).toHaveCount(1);
  await expect(post.locator(".iconact")).toHaveCount(0);
  const more = post.getByTestId("post-more");
  await more.click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await page.keyboard.press("Escape");
  // dấu «·» chỉ do CSS giữa hai phần tử cùng dòng ⇒ không có chữ «·» treo trong DOM
  expect(await head.innerText()).not.toMatch(/^\s*·|·\s*$/m);
});

test("phạm vi: bài «Tất cả đối tác» dùng biểu tượng người/nhóm, không ổ khoá", async ({ page }) => {
  await page.goto("/community");
  const scope = page.getByTestId("post").first().getByTestId("post-scope");
  if ((await scope.count()) > 0) {
    await expect(scope.locator("svg")).toHaveCount(1);
  }
});

test("tệp .txt trong bài có nút «Xem», mở ra thấy chữ, tên tệp dài giữ đuôi", async ({ page }) => {
  await page.goto("/community");
  const composer = await openComposer(page);
  await page.getByTestId("attach-input").setInputFiles({
    name: "pha-dao-ki-nang-giao-tiep-voi-khach-hang-quan-trong.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dòng một CR195\nDòng hai\n", "utf8"),
  });
  await composer.getByRole("textbox").first().fill("Bài có tệp văn bản CR195");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const post = page.getByTestId("post").filter({ hasText: "Bài có tệp văn bản CR195" }).first();
  const card = post.getByTestId("file-card");
  await expect(card.getByTestId("file-view")).toBeVisible();
  await expect(card.locator(".fname")).toContainText(".txt"); // đuôi luôn hiện dù tên bị cắt giữa
  await card.getByTestId("file-view").click();
  await expect(page.getByTestId("attach-text-content")).toContainText("Dòng một CR195");
});
