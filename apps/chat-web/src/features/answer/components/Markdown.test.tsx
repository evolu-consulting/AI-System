// F12 · Markdown (render tĩnh): bảng, danh sách, code, link tab mới, không render HTML thô.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import Markdown from "./Markdown";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const html = (content: string, streaming = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Markdown content={content} streaming={streaming} />
    </I18nextProvider>,
  );

describe("Markdown", () => {
  test("bảng GFM và danh sách", () => {
    const out = html("| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n- y\n\n1. một\n\n2. hai");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<ul");
    expect(out.match(/<ol/g)?.length).toBe(1);
  });

  test("link mở tab mới, rel noopener noreferrer; javascript: bị lọc", () => {
    const out = html("[ok](https://example.com) [bad](javascript:alert(1))");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("javascript:");
  });

  test("ảnh hiện dạng link, không có <img>", () => {
    const out = html("![logo](https://example.com/a.png)");
    expect(out).not.toContain("<img");
    expect(out).toContain("logo");
  });

  test("HTML thô không được render", () => {
    const out = html(
      ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "**đậm**"].join("\n\n"),
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;"); // chỉ là chữ đã escape
    expect(out).toContain("<strong>đậm</strong>");
  });

  test("khối code có nút Copy + nhãn ngôn ngữ; code inline không có", () => {
    const out = html("dùng `x` rồi\n\n```ts\nconst a = 1;\n```");
    expect(out).toContain('aria-label="Copy"');
    expect(out).toContain("const a = 1;");
    expect(out.match(/aria-label="Copy"/g)?.length).toBe(1);
  });

  test("khối code không có ngôn ngữ, một dòng vẫn là khối", () => {
    expect(html("```\nls\n```")).toContain('aria-label="Copy"');
  });

  test("streaming hiện con trỏ", () => {
    expect(html("xin chào", true)).toContain("animate-pulse");
    expect(html("xin chào", false)).not.toContain("animate-pulse");
  });
});
