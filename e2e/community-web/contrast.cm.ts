// CR-120 · dark-tokens · độ tương phản chữ/nền ở /community (bảng tin) và một trang Sổ Hợp Tác, cả giao diện Tối và Sáng.
// Repo chưa có @axe-core/playwright ⇒ tính tỉ lệ tương phản WCAG từ getComputedStyle (chữ nhìn thấy, nền gộp alpha qua tổ tiên). Kỳ vọng 0 vi phạm.
import { expect, type Page, test } from "@playwright/test";

type Violation = { text: string; cls: string; ratio: number; need: number };

async function setTheme(page: Page, name: "Sáng" | "Tối") {
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page
    .getByRole("radiogroup", { name: "Giao diện" })
    .getByRole("radio", { name, exact: true })
    .click();
  await page.keyboard.press("Escape");
  // Sáng = mặc định (không có data-theme); chỉ Tối đặt thuộc tính.
  if (name === "Tối") await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  else await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await page.waitForFunction(() => document.getAnimations().length === 0); // chờ transition màu xong
}

/** Chạy trong trang: trả về danh sách phần tử chữ có tỉ lệ tương phản thấp hơn ngưỡng AA. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hàm tự chứa, được serialize vào trang (page.evaluate) nên không tách được ra module
function findLowContrast(): Violation[] {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("canvas 2d không khả dụng");
  const rgba = (css: string): [number, number, number, number] => {
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = "#000";
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r: number, g: number, b: number) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (top: number[], bot: number[]): [number, number, number] => {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bot[i] ?? 0) * (1 - a)) as [
      number,
      number,
      number,
    ];
  };
  const effectiveBg = (el: Element): [number, number, number] | null => {
    const stack: number[][] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null; // gradient/ảnh: không đo được
      const col = rgba(cs.backgroundColor);
      if ((col[3] ?? 0) > 0) stack.push(col);
      if (col[3] === 1) break;
    }
    let acc: [number, number, number] = [255, 255, 255];
    for (const col of stack.reverse()) acc = over(col, acc);
    return acc;
  };
  const out: Violation[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    const txt = (t.textContent ?? "").trim();
    if (!el || !txt || seen.has(el)) continue;
    seen.add(el);
    if (
      el.closest(
        "script,style,noscript,option,[disabled],[aria-disabled='true'],[aria-hidden='true']",
      )
    )
      continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none")
      continue;
    if (Number(cs.opacity) < 1) continue;
    const bg = effectiveBg(el);
    if (!bg) continue;
    const fg = rgba(cs.color);
    const f = over(fg, bg);
    const [l1, l2] = [lum(...f), lum(...bg)].sort((a, b) => b - a) as [number, number];
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const px = Number.parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need)
      out.push({
        text: txt.slice(0, 40),
        cls: String(el.className).slice(0, 50),
        ratio: Math.round(ratio * 100) / 100,
        need,
      });
  }
  return out;
}

const openFeed = async (p: Page) => {
  await expect(p.getByTestId("composer")).toBeVisible();
  await expect(p.getByTestId("post").first()).toBeVisible();
};
const openSht = async (p: Page) => {
  await p.getByTestId("nav-group-contracts").getByRole("link").first().click();
  await expect(p.locator("main, [role=main]").first()).toBeVisible();
  await p.waitForLoadState("networkidle");
};

async function check(page: Page, theme: "Sáng" | "Tối", open: (p: Page) => Promise<void>) {
  await page.goto("/community");
  await setTheme(page, theme);
  await open(page);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const bad = await page.evaluate(findLowContrast);
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
}

test("tương phản chữ AA · Tối · /community (bảng tin): 0 vi phạm", ({ page }) =>
  check(page, "Tối", openFeed));
test("tương phản chữ AA · Tối · Sổ Hợp Tác: 0 vi phạm", ({ page }) => check(page, "Tối", openSht));
test("tương phản chữ AA · Sáng · /community (bảng tin): 0 vi phạm", ({ page }) =>
  check(page, "Sáng", openFeed));
test("tương phản chữ AA · Sáng · Sổ Hợp Tác: 0 vi phạm", ({ page }) =>
  check(page, "Sáng", openSht));
