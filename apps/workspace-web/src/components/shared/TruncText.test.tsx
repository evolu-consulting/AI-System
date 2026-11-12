// CR-134 · TruncText: một dòng + «…» + tooltip đủ nội dung.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TruncText } from "./TruncText";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("TruncText", () => {
  test("chuỗi ⇒ title = đủ chuỗi, có truncate", () => {
    const out = html(<TruncText>hop-dong-rat-dai.pdf</TruncText>);
    expect(out).toContain('title="hop-dong-rat-dai.pdf"');
    expect(out).toContain("truncate");
  });
  test("title tường minh thắng; maxWidth thành style", () => {
    const out = html(
      <TruncText title="đầy đủ" maxWidth="12rem">
        <b>x</b>
      </TruncText>,
    );
    expect(out).toContain('title="đầy đủ"');
    expect(out).toContain("max-width:12rem");
  });
  test("nội dung không phải chuỗi và không title ⇒ không có title", () => {
    expect(
      html(
        <TruncText>
          <b>x</b>
        </TruncText>,
      ),
    ).not.toContain("title=");
  });
});
