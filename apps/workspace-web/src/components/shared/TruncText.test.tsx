// CR-134 · TruncText: một dòng + «…»; CR-179: tooltip chỉ khi tràn (đo ở trình duyệt) ⇒ render tĩnh không còn `title`.
import { describe, expect, test } from "bun:test";
import { TruncText as KitTruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { renderToStaticMarkup } from "react-dom/server";
import { TruncText } from "./TruncText";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("TruncText", () => {
  test("chuỗi ⇒ có truncate, hiện đủ chữ, không title trần", () => {
    const out = html(<TruncText>hop-dong-rat-dai.pdf</TruncText>);
    expect(out).toContain("hop-dong-rat-dai.pdf");
    expect(out).toContain("truncate");
    expect(out).not.toContain("title=");
  });
  test("maxWidth thành style; children nhúng vẫn hiện", () => {
    const out = html(
      <TruncText title="đầy đủ" maxWidth="12rem">
        <b>x</b>
      </TruncText>,
    );
    expect(out).toContain("max-width:12rem");
    expect(out).toContain("<b>x</b>");
  });
  test("nội dung không phải chuỗi và không title ⇒ chỉ cắt chữ", () => {
    const out = html(
      <TruncText>
        <b>x</b>
      </TruncText>,
    );
    expect(out).toContain("truncate");
    expect(out).not.toContain("title=");
  });
  test("kit render tĩnh", () => {
    const one = html(<KitTruncText text="Tên rất dài" />);
    expect(one).toContain("truncate");
    expect(one).not.toContain("tabindex");
    expect(one).not.toContain("aria-label");
    expect(html(<KitTruncText text="đủ" lines={2} />)).toContain("line-clamp-2");
  });
});
