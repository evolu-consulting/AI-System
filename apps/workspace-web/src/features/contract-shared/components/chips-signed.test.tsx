// CR-182 · nhãn trạng thái đầu trang HĐ: «Đã ký» thay «Đã duyệt xong» khi đã ký đủ.
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { StatusChip } from "./Chips";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
describe("StatusChip", () => {
  test("done + signed ⇒ «Đã ký»", () => {
    const h = renderToStaticMarkup(<StatusChip status="done" signed />);
    expect(h).toContain("Đã ký");
    expect(h).toContain('data-status="done"');
  });
  test("done không signed ⇒ «Đã duyệt xong» như cũ; signed nhưng chưa done ⇒ giữ nhãn cũ", () => {
    expect(renderToStaticMarkup(<StatusChip status="done" />)).toContain("Đã duyệt xong");
    expect(renderToStaticMarkup(<StatusChip status="processing" signed />)).toContain("Đang duyệt");
  });
});
