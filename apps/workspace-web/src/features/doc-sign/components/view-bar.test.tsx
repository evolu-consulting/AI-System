// CR-182 · thanh «Kiểu xem khi ký» và chữ ký khác kiểu xem (hiện nhưng không kéo được).
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { DEFAULT_VIEW, layoutFan, viewKey } from "../lib/fan";
import { isPartsError, partsOf } from "../lib/geometry";
import type { SignItem } from "../lib/sign-items";
import { StageItems } from "./StageItems";
import { ViewBar } from "./ViewBar";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;

describe("ViewBar", () => {
  test("Từng trang: có «Liền mép», không có Mép phải hay Mép dưới, cụm ẩn ở điện thoại", () => {
    const h = html(<ViewBar view={DEFAULT_VIEW} pageCount={12} onChange={noop} />);
    expect(h).toContain("Từng trang");
    expect(h).toContain("Xoè quạt");
    expect(h).toContain("Liền mép");
    expect(h).not.toContain("Mép phải");
    expect(h).toContain("max-sm:hidden");
  });
  test("Xoè quạt: Mép phải | Mép dưới và ‹ Trang 1–5 ›, không còn «Liền mép»", () => {
    const h = html(
      <ViewBar view={{ ...DEFAULT_VIEW, mode: "fan" }} pageCount={12} onChange={noop} />,
    );
    expect(h).toContain("Mép phải");
    expect(h).toContain("Mép dưới");
    expect(h).toContain("Trang 1–5");
    expect(h).toContain("‹");
    expect(h).toContain("›");
    expect(h).not.toContain("Liền mép");
  });
  test("tài liệu ≤ 5 trang: không có nút sang nhóm", () => {
    const h = html(
      <ViewBar view={{ ...DEFAULT_VIEW, mode: "fan" }} pageCount={5} onChange={noop} />,
    );
    expect(h).not.toContain("Nhóm trang sau");
  });
});

describe("chữ ký theo kiểu xem", () => {
  const view = { ...DEFAULT_VIEW, mode: "fan" as const };
  const layout = layoutFan(
    Array.from({ length: 5 }, () => ({ ptWidth: 600, ptHeight: 800 })),
    900,
    "right",
    0,
  );
  const p0 = layout.pages[0];
  if (!p0) throw new Error("thiếu trang");
  const parts = partsOf(
    { l: p0.left + p0.width - 20, t: p0.top + 100, w: 200, h: 60 },
    layout.pages,
  );
  if (isPartsError(parts)) throw new Error("lỗi");
  const item = (v?: string): SignItem => ({
    id: "m",
    kind: "mark",
    parts,
    aspect: 3,
    status: "editable",
    imageUrl: "data:image/png;base64,AA==",
    view: v,
  });
  const render = (it: SignItem) =>
    html(
      <StageItems
        layout={layout}
        viewKey={viewKey(view)}
        items={[it]}
        mode="sign"
        sel={null}
        seam={null}
        menu={null}
        menuTrays={[]}
        onSel={noop}
        onSeam={noop}
        onMove={noop}
        onRemove={noop}
        onCopyAll={noop}
        onChangePerson={noop}
        onFieldClick={noop}
        onPick={noop}
        onCloseMenu={noop}
      />,
    );
  test("đặt ở kiểu xem này ⇒ khung kéo được", () => {
    const h = render(item("fan-right-0"));
    expect(h).toContain('data-testid="sign-mark"');
    expect(h).toContain("cursor-move");
  });
  test("đặt ở kiểu xem khác (Từng trang) ⇒ vẫn hiện theo từng lát nhưng không có khung kéo", () => {
    const h = render(item());
    expect(h).toContain('data-testid="sign-mark-locked"');
    expect(h).not.toContain('data-testid="sign-mark"');
    expect(h).not.toContain("cursor-move");
    // khung ngoài có cỡ (không chỉ con tuyệt đối) ⇒ Playwright `toBeVisible` thấy được (cr181 fan-seam-sign)
    expect(h).toContain("pointer-events-none absolute inset-0");
    expect(h).toContain("Giáp lai 5 trang: 1, 2, 3, 4, 5");
  });
});
