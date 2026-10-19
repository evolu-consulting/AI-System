// PK-FR-10 · TF2 · ui dùng chung: PageHead, Panel, Chips, Empty, Loading, ErrorLine, Stat (render tĩnh, i18n en/vi thật).
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { PageHead, Panel, Stat } from "./layout";
import { Chips, Empty, ErrorLine, Loading } from "./states";

beforeAll(async () => {
  await initI18n();
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("shared layout", () => {
  test("PageHead: crumb có aria-label dịch được; titleMobileOnly ẩn H1 ở desktop", async () => {
    const out = html(
      <PageHead crumb="Hợp đồng" title="Chi tiết" titleMobileOnly actions={<b>x</b>} />,
    );
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain("md:hidden");
    await i18n.changeLanguage("vi");
    expect(html(<PageHead crumb="a" />)).toContain('aria-label="Vị trí"');
    await i18n.changeLanguage("en");
  });
  test("PageHead không có gì → chỉ khung rỗng", () => {
    expect(html(<PageHead />)).not.toContain("<h1");
  });
  test("Panel gộp className", () => {
    expect(html(<Panel className="mt-2">n</Panel>)).toMatch(/class="[^"]*mt-2[^"]*"/);
  });
  test("Stat: tone late tô khung; loading thay giá trị bằng skeleton", () => {
    expect(html(<Stat value={3} label="Trễ" tone="late" />)).toContain("border-late-line");
    const loading = html(<Stat value={3} label="Trễ" loading />);
    expect(loading).toContain("animate-pulse");
    expect(loading).not.toContain(">3<");
  });
});

describe("shared states", () => {
  test("Loading là status có nhãn dịch", () => {
    expect(html(<Loading />)).toContain('role="status" aria-label="Loading…"');
  });
  test("ErrorLine: không lỗi → không render; Error → message; giá trị khác → chuỗi", () => {
    expect(html(<ErrorLine error={null} />)).toBe("");
    expect(html(<ErrorLine error={new Error("Hỏng rồi")} />)).toContain('role="alert"');
    expect(html(<ErrorLine error={new Error("Hỏng rồi")} />)).toContain("Hỏng rồi");
    expect(html(<ErrorLine error="chuỗi" />)).toContain("chuỗi");
  });
  test("Empty: tiêu đề + nội dung; có thể đổi icon", () => {
    const out = html(<Empty title="Chưa có hợp đồng">Thêm mới</Empty>);
    expect(out).toContain("Chưa có hợp đồng");
    expect(out).toContain("Thêm mới");
    expect(html(<Empty title="t" icon={<i>I</i>} />)).toContain("<i>I</i>");
  });
  test("Chips: nhóm có nhãn, aria-pressed theo giá trị", () => {
    const out = html(
      <Chips
        label="Lọc"
        value="a"
        onChange={() => {}}
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
      />,
    );
    expect(out).toContain('<fieldset aria-label="Lọc"');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
});
