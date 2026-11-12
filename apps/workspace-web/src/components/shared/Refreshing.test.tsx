// CR-134 · Refreshing: chỉ báo mảnh khi tải lại, nội dung cũ vẫn có mặt; PaneSkeleton có nhãn ẩn.
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { PaneSkeleton, Refreshing } from "./Refreshing";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Refreshing", () => {
  test("fetching ⇒ thanh chỉ báo + aria-busy, giữ nội dung cũ", () => {
    const out = html(<Refreshing fetching>3 đối tác đổi mức</Refreshing>);
    expect(out).toContain("refreshing-bar");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("3 đối tác đổi mức");
  });
  test("không fetching ⇒ không có chỉ báo", () => {
    const out = html(<Refreshing fetching={false}>x</Refreshing>);
    expect(out).not.toContain("refreshing-bar");
    expect(out).not.toContain("aria-busy");
  });
  test("PaneSkeleton: role status, nhãn ẩn «Đang tải…», đủ số dòng", () => {
    const out = html(<PaneSkeleton lines={4} />);
    expect(out).toContain('role="status"');
    expect(out).toContain("Đang tải");
    expect(out.match(/data-slot="skeleton"/g)).toHaveLength(4);
  });
});
