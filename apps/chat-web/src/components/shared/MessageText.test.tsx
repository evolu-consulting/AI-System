import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { leadingProcess, MessageText } from "./MessageText";

const html = (text: string) => renderToStaticMarkup(<MessageText text={text} />);
const NONE = /mention-(agent|command|process)/;

test("tô `@agent` đầu tin (indigo), giữ phần sau", () => {
  const h = html("@hoadon tổng hợp");
  expect(h).toContain("@hoadon");
  expect(h).toContain("text-mention-agent");
  expect(h).toContain(" tổng hợp");
});

test("tô `/command` đầu tin (amber)", () => {
  const h = html("/translate en hi");
  expect(h).toContain("/translate");
  expect(h).toContain("text-mention-command");
  expect(h).not.toContain("mention-agent");
});

test("tô `!process` đầu tin (teal)", () => {
  const h = html("!baocao tháng 9");
  expect(h).toContain(">!baocao<");
  expect(h).toContain("text-mention-process");
  expect(h).toContain(" tháng 9");
});

test("leadingProcess: bỏ `!!` và `!` đơn lẻ", () => {
  expect(leadingProcess("!x y")).toBe("x");
  expect(leadingProcess("!!x")).toBeNull();
  expect(leadingProcess("! x")).toBeNull();
});

test("tin thường: không chip", () => {
  expect(html("xin chào @mọi người")).not.toMatch(NONE);
});

test("`@@`/`//`/`!!` escape: không tô (giữ nguyên chữ)", () => {
  expect(html("@@x literal")).not.toMatch(NONE);
  expect(html("//x literal")).not.toMatch(NONE);
  expect(html("!!x literal")).not.toMatch(NONE);
});

test("`@`/`/`/`!` giữa tin: không tô (R16)", () => {
  expect(html("gửi cho @minh")).not.toMatch(NONE);
  expect(html("xong rồi !baocao")).not.toMatch(NONE);
});

test("onPrimary (bong bóng của mình): pill trắng + chữ màu loại", () => {
  const h = renderToStaticMarkup(<MessageText text="@hoadon tổng hợp" onPrimary />);
  expect(h).toContain("bg-primary-foreground");
  expect(h).toContain("text-mention-agent");
});
