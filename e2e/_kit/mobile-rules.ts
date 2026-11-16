// CR-180 · "kiểm mobile" tự động: đo 4 luật ở 390 px, dùng chung cho `e2e/contracts-web/mobile-rules.cw.ts` và
// `e2e/community-web/mobile-rules.cm.ts`. Hàm đo chạy TRONG trang (page.evaluate) rồi báo từng phần tử vi phạm (tên + kích thước).
//   R1 tràn ngang  · R2 vùng bấm ≥ 44 px (mỗi cạnh) · R3 chữ ≥ 12 px · R4 nút trợ lý nổi không che phần tử bấm được LÚC TRANG VỪA MỞ.
// Ngoại lệ KHÔNG bỏ qua bừa: mọi ngoại lệ nằm ở `MOBILE_EXEMPTIONS` (tên + lý do), kiểm test nhìn bảng này.
import { expect, type Page } from "@playwright/test";

export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
/** Dùng: `test.use(MOBILE_USE)` ở đầu file spec. */
export const MOBILE_USE = { viewport: MOBILE_VIEWPORT, isMobile: true, hasTouch: true } as const;

export const MIN_TAP = 44;
export const MIN_TEXT = 12;
export const FAB_SELECTOR = 'button[aria-label="Mở trợ lý AI"]';

/** Ngoại lệ có tên. Sửa bảng này = đổi luật ⇒ phải có lý do. */
export const MOBILE_EXEMPTIONS = {
  /** Chấm badge số (vd "2", "12", "99+"): chữ tối thiểu 11 px (không phải 12). */
  badgeMinText: {
    px: 11,
    reason: "badge số đếm là huy hiệu, không phải chữ đọc; 11 px vẫn đọc được",
  },
  /** Link chữ nằm trong đoạn văn (cha là p/li/span có chữ khác ngoài link): không tính vùng bấm 44. */
  inlineLinkInText: { reason: "link giữa câu không thể cao 44 px mà không phá dòng chữ" },
  /** Vùng cuộn ngang có chủ đích: phần tử vượt phải của nó không phải lỗi tràn trang. */
  hScrollAncestor: {
    selector: "table, [role=tablist], [data-hscroll]",
    reason: "bảng, thanh tab, dải chip cuộn ngang có chủ đích",
  },
  /** Ô tick/radio ẩn thị giác (sr-only, ≤ 1 px) hoặc bọc trong <label> bấm được: tính theo nhãn bọc. */
  hiddenInput: { reason: "input thật bị ẩn thị giác; vùng bấm là nhãn/hàng bọc nó" },
  /** Sơ đồ phóng to/thu nhỏ/kéo được (vd sơ đồ tổ chức): chữ và ô trong sơ đồ theo mức thu phóng, không đo cỡ chạm/chữ. */
  zoomCanvas: {
    selector: ".react-flow, [data-zoom-canvas]",
    reason:
      "người dùng phóng to được (chốt 2026-11-16: sơ đồ tổ chức giữ dạng sơ đồ trên điện thoại)",
  },
  /** Phần tử ẩn (display none, visibility hidden, opacity 0, aria-hidden, ngoài khung). */
  invisible: { reason: "không nhìn thấy ⇒ không bấm được" },
} as const;

export type Rule = "R1-tran-ngang" | "R2-vung-bam" | "R3-chu-nho" | "R4-nut-troly-che";
export type Violation = { rule: Rule; what: string };

type Raw = { overflow: string[]; tap: string[]; text: string[]; fab: string[]; scrollW: number };

/** Đo một trang (đã tải xong, chưa cuộn/tương tác). */
export async function measureMobile(page: Page): Promise<Violation[]> {
  const raw = await page.evaluate(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: script đo chạy trong trang, cần một khối tự đủ
    ({ MIN_TAP, MIN_TEXT, FAB, badge, hscroll, zoom }) => {
      const vw = window.innerWidth;
      const TAPPABLE =
        "button, a[href], [role=button], [role=tab], [role=combobox], [role=menuitem], input:not([type=hidden]), select, textarea";
      const q = (el: Element, n = 28) => {
        const h = el as HTMLElement;
        const t = (
          h.getAttribute("data-testid") ||
          h.getAttribute("aria-label") ||
          h.innerText ||
          h.getAttribute("placeholder") ||
          h.tagName
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, n);
        return t || h.tagName.toLowerCase();
      };
      const dim = (r: DOMRect) => `${Math.round(r.width)}x${Math.round(r.height)}`;
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một vòng leo cây kiểm 4 điều kiện ẩn
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        for (let e: Element | null = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
            return false;
          if (e.getAttribute("aria-hidden") === "true") return false;
        }
        return true;
      };
      const out: Raw = {
        overflow: [],
        tap: [],
        text: [],
        fab: [],
        scrollW: document.documentElement.scrollWidth,
      };

      // R1
      if (out.scrollW > vw) out.overflow.push(`trang: scrollWidth ${out.scrollW} > ${vw}`);
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 0.5) continue;
        if (el.closest(hscroll)) continue;
        let inScroller = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
            inScroller = true;
            break;
          }
        }
        if (inScroller) continue;
        // chỉ báo phần tử lá của lỗi (cha cũng vượt thì bỏ để khỏi lặp)
        const parent = el.parentElement;
        if (parent && parent.getBoundingClientRect().right > vw + 0.5 && parent !== document.body)
          continue;
        out.overflow.push(`${q(el)} ${dim(r)} right=${Math.round(r.right)}`);
      }

      // R2
      const taps = Array.from(document.querySelectorAll(TAPPABLE));
      for (const el of taps) {
        let target: Element = el;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          const lab = el.closest("label");
          if (lab) target = lab; // hiddenInput
        }
        if (!visible(target)) continue; // invisible
        if (target.closest(zoom)) continue; // zoomCanvas
        const r = target.getBoundingClientRect();
        if (r.right < 0 || r.left > vw) continue; // ngoài khung (trong vùng cuộn)
        if (el.tagName === "A") {
          const p = el.parentElement;
          const own = p
            ? Array.from(p.childNodes).some(
                (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
              )
            : false;
          if (own && p && /^(P|LI|SPAN|DIV|TD)$/.test(p.tagName)) continue; // inlineLinkInText
        }
        if (Math.min(r.width, r.height) < MIN_TAP - 0.5) out.tap.push(`${q(target)} ${dim(r)}`);
      }

      // R3
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        const txt = (n.textContent ?? "").trim();
        if (!el || !txt || seen.has(el)) continue;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
        if (!visible(el)) continue;
        if (el.closest(zoom)) continue; // zoomCanvas
        seen.add(el);
        const fs = Number.parseFloat(getComputedStyle(el).fontSize);
        const isBadge = /^\d{1,3}\+?$/.test(txt);
        const min = isBadge ? badge : MIN_TEXT;
        if (fs < min - 0.01) out.text.push(`${q(el)} ${fs}px (cần ≥ ${min})`);
      }

      // R4
      for (const fab of Array.from(document.querySelectorAll(FAB))) {
        if (!visible(fab) || getComputedStyle(fab).position !== "fixed") continue;
        const f = fab.getBoundingClientRect();
        for (const el of taps) {
          if (el === fab || fab.contains(el) || el.contains(fab) || !visible(el)) continue;
          const r = el.getBoundingClientRect();
          const w = Math.min(r.right, f.right) - Math.max(r.left, f.left);
          const h = Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top);
          if (w > 1 && h > 1 && r.top < window.innerHeight)
            out.fab.push(`${q(el)} ${dim(r)} bị nút trợ lý ${dim(f)} đè`);
        }
      }
      return out;
    },
    {
      MIN_TAP,
      MIN_TEXT,
      FAB: FAB_SELECTOR,
      badge: MOBILE_EXEMPTIONS.badgeMinText.px,
      hscroll: MOBILE_EXEMPTIONS.hScrollAncestor.selector,
      zoom: MOBILE_EXEMPTIONS.zoomCanvas.selector,
    },
  );
  const uniq = (a: string[]) => [...new Set(a)];
  const mk = (rule: Rule, a: string[]): Violation[] => uniq(a).map((what) => ({ rule, what }));
  return [
    ...mk("R1-tran-ngang", raw.overflow),
    ...mk("R2-vung-bam", raw.tap),
    ...mk("R3-chu-nho", raw.text),
    ...mk("R4-nut-troly-che", raw.fab),
  ];
}

/** Chờ trang ổn định (không sleep: mạng yên). */
export async function settle(page: Page): Promise<void> {
  await page
    .locator("main")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(async () => {
      const body = (await page.locator("body").innerText()).replace(/s+/g, " ").slice(0, 120);
      throw new Error(
        `màn không dựng được <main> (thấy: "${body}") — lỗi spec/giả API, không phải vi phạm mobile`,
      );
    });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

const RULES: Rule[] = ["R1-tran-ngang", "R2-vung-bam", "R3-chu-nho", "R4-nut-troly-che"];

/** Mỗi luật một `expect.soft`: ca đỏ liệt kê đủ phần tử vi phạm; số vi phạm in một dòng ở đầu. */
export async function expectMobileRules(page: Page, screen: string): Promise<void> {
  const v = await measureMobile(page);
  console.log(
    `[mobile-rules] ${screen}: ${RULES.map((r) => `${r.split("-")[0]}=${v.filter((x) => x.rule === r).length}`).join(" ")}`,
  );
  for (const rule of RULES) {
    const items = v.filter((x) => x.rule === rule).map((x) => x.what);
    expect
      .soft(items, `[${screen}] ${rule}: ${items.length} vi phạm\n  - ${items.join("\n  - ")}`)
      .toEqual([]);
  }
}
