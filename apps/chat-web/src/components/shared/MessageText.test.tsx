import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "./MessageText";

const html = (text: string) => renderToStaticMarkup(<MessageText text={text} />);

test("tô `@agent` đầu tin, giữ phần sau", () => {
  const h = html("@hoadon tổng hợp");
  expect(h).toContain("@hoadon");
  expect(h).toContain("bg-accent");
  expect(h).toContain("tổng hợp");
});

test("tô `/command` đầu tin", () => {
  const h = html("/translate en hi");
  expect(h).toContain("/translate");
  expect(h).toContain("bg-accent");
});

test("tin thường: không chip", () => {
  expect(html("xin chào @mọi người")).not.toContain("bg-accent");
});

test("`@@`/`//` escape: không tô (giữ nguyên chữ)", () => {
  expect(html("@@x literal")).not.toContain("bg-accent");
  expect(html("//x literal")).not.toContain("bg-accent");
});

test("`@`/`/` giữa tin: không tô (R16)", () => {
  expect(html("gửi cho @minh")).not.toContain("bg-accent");
});
