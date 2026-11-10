import { describe, expect, test } from "bun:test";
import { renderPrototype } from "./render";
import type { PrototypeInput } from "./schema";

const base: PrototypeInput = {
  title: "Mẫu <b>x</b>",
  roles: [
    { key: "a", label: "Kế toán" },
    { key: "b", label: "Đối tác" },
  ],
  screens: [
    {
      id: "s1",
      title: "Việc của tôi",
      role: "a",
      blocks: [
        { type: "button", label: "Tiếp", goto: "s2", variant: "primary" },
        { type: "button", label: "Chỉ đối tác", variant: "secondary", role: "b" },
      ],
    },
    {
      id: "s2",
      title: "Đối tác xác nhận",
      role: "b",
      blocks: [{ type: "text", text: "Xin chào" }],
    },
  ],
  flow: [{ from: "s1", action: "Gửi", to: "s2", by: "a" }],
  notes: [],
};

describe("renderPrototype", () => {
  test("tự chứa, có ribbon, không gọi mạng", () => {
    const h = renderPrototype(base);
    expect(h).toContain("Bản mẫu — dữ liệu giả");
    expect(h).not.toMatch(/https?:\/\//);
  });

  test("lọc theo vai: màn và nút mang data-role", () => {
    const h = renderPrototype(base);
    expect(h).toContain('data-nav="s1" data-role="a"');
    expect(h).toContain('data-nav="s2" data-role="b"');
    expect(h).toContain('data-role="b">Chỉ đối tác');
    expect(h).toContain('<option value="a">Kế toán</option>');
  });

  test("nút đi tới màn khác qua data-goto", () => {
    expect(renderPrototype(base)).toContain('data-goto="s2">Tiếp');
  });

  test("goto màn không có bị từ chối", () => {
    const bad = structuredClone(base);
    (bad.screens[0]?.blocks[0] as { goto: string }).goto = "zzz";
    expect(() => renderPrototype(bad)).toThrow(/zzz/);
  });

  test("escape mọi chữ người dùng", () => {
    const x = "<script>alert(1)</script>\"'&";
    const h = renderPrototype({
      title: x,
      roles: [{ key: "a", label: x }],
      screens: [
        {
          id: "s",
          title: x,
          blocks: [
            { type: "heading", text: x },
            { type: "text", text: x },
            { type: "field", label: x, kind: "select", value: x, options: [x] },
            { type: "table", cols: [x], rows: [[x]] },
            { type: "steps", items: [{ label: x, status: "open", who: x }] },
            { type: "banner", kind: "warn", text: x },
            {
              type: "states",
              variants: [{ key: "k", label: x, blocks: [{ type: "text", text: x }] }],
            },
          ],
        },
      ],
      flow: [{ from: "s", action: x, to: "s", by: "a" }],
      notes: [x],
    });
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
