// CR-182 · fix-cr182-ui · lỗi 2: lỗi hiển thị ⇒ câu tiếng Việt + «Tải lại».
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { SignCrashView, SignErrorBoundary } from "./SignErrorBoundary";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});

describe("SignErrorBoundary", () => {
  test("có lỗi ⇒ state failed (getDerivedStateFromError)", () => {
    expect(SignErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });
  test("màn thay thế: tiếng Việt, có nút «Tải lại», không có chữ tiếng Anh của router", () => {
    const html = renderToStaticMarkup(<SignCrashView />);
    expect(html).toContain("Không mở được màn ký");
    expect(html).toContain("Tải lại");
    expect(html).not.toContain("Something went wrong");
  });
  test("không lỗi ⇒ hiện nội dung con", () => {
    expect(renderToStaticMarkup(<SignErrorBoundary>ok-con</SignErrorBoundary>)).toContain("ok-con");
  });
});
