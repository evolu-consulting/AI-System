// CR-195 BR-195-1/2 (viết, điều phối chạy cuối đợt) · hộp «Viết bài»: nền trắng theo token, không thẻ lồng, điện thoại nút «Đăng bài» trong khung nhìn.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { openComposer } from "./_composer";

const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
const cardColor = (l: Locator) =>
  l.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--card)";
    el.ownerDocument.body.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });

type Size = { width: number; height: number };
const check = async (page: Page, size: Size) => {
  await page.setViewportSize(size);
  await page.goto("/community");
  const dlg = await openComposer(page);
  const content = page.locator('[data-slot="dialog-content"]');
  expect(await bg(content)).toBe(await cardColor(content));
  const form = dlg.getByTestId("composer-form");
  for (const l of [form, dlg.getByTestId("audience-field")]) {
    const s = await l.evaluate((el) => {
      const c = getComputedStyle(el);
      return { shadow: c.boxShadow, border: c.borderTopWidth, bg: c.backgroundColor };
    });
    expect(s.shadow).toBe("none");
    expect(s.border).toBe("0px");
    expect(s.bg).toBe("rgba(0, 0, 0, 0)");
  }
  const post = dlg.getByRole("button", { name: "Đăng bài" });
  const box = await post.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);
  if (size.width <= 640) {
    // điện thoại: nút Đăng bài dính đáy hộp toàn màn, ô viết giãn quá 3 dòng
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(size.height - 90);
    const ta = await dlg.locator("#draft-body").boundingBox();
    expect(ta?.height ?? 0).toBeGreaterThan(150);
  }
};

test("hộp Viết bài 1280px: nền trắng, không có thẻ lồng, nút Đăng bài trong khung nhìn", async ({
  page,
}) => {
  await check(page, { width: 1280, height: 800 });
});

test("hộp Viết bài 390px: nền trắng, không có thẻ lồng, nút Đăng bài trong khung nhìn", async ({
  page,
}) => {
  await check(page, { width: 390, height: 780 });
});
