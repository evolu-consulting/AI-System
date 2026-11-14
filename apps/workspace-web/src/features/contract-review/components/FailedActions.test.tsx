// CR-162: cụm nút của thẻ «Không đọc được» — Nhập tay là nút chính, phần còn lại nằm trong MỘT nút menu (đóng sẵn).
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { FailedActions } from "./FailedActions";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
  await i18n.reloadResources("vi");
});

describe("FailedActions", () => {
  const render = () =>
    renderToStaticMarkup(
      <FailedActions
        pending={false}
        onManual={() => {}}
        onRetry={() => {}}
        onPickFile={() => {}}
      />,
    );
  test("một nút chính «Nhập tay» + một nút menu có nhãn đọc màn hình", () => {
    const out = render();
    expect(out).toContain('data-testid="manual-entry"');
    expect(out).toContain("Nhập tay");
    expect(out).toContain('aria-label="Thêm lựa chọn"');
    expect(out.match(/<button/g)?.length).toBe(2);
  });
  test("Thử lại / Tải tệp khác chưa hiện khi menu đóng", () => {
    const out = render();
    expect(out).not.toContain("Thử lại");
    expect(out).not.toContain("Tải tệp khác");
  });
});
