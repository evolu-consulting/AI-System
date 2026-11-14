// CR-162: «Xem hợp đồng gốc» = nút chỉ icon + chú thích (rê/focus) + nhãn đọc màn hình, không emoji.
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { FileLink } from "./ReviewParts";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
  await i18n.reloadResources("vi");
});

describe("FileLink", () => {
  const render = () =>
    renderToStaticMarkup(<FileLink file={{ href: "/x", name: "a.pdf", onOpen: () => {} }} />);
  test("aria-label + chú thích, có icon svg, không emoji", () => {
    const out = render();
    expect(out).toContain('aria-label="Xem hợp đồng gốc"');
    expect(out).toContain('role="tooltip"');
    expect(out).toContain("<svg");
    expect(out).not.toContain("📄");
  });
});
