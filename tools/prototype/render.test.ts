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

  test("khối mới: tab, hộp thoại, thẻ việc, nhãn trạng thái, trang trống, thông báo, ô số", () => {
    const p = structuredClone(base);
    p.screens[0]?.blocks.push(
      {
        type: "tabs",
        tabs: [{ key: "t1", label: "Tab một", blocks: [{ type: "text", text: "A" }] }],
      },
      {
        type: "modal",
        trigger: "Gửi",
        title: "Chắc chưa?",
        text: "Gửi ngay",
        confirm: "Gửi",
        goto: "s2",
      },
      { type: "cards", items: [{ title: "Việc 1", badge: "Mới", tone: "ok", goto: "s2" }] },
      { type: "badge", text: "Đã xong", tone: "ok" },
      { type: "empty", title: "Trống", text: "Chưa có", action: "Tạo", goto: "s2" },
      { type: "toast", trigger: "Nhắc", kind: "error", text: "Lỗi rồi" },
      { type: "stats", items: [{ label: "Cần làm", value: "3" }] },
    );
    const h = renderPrototype(p);
    expect(h).toContain('data-itab="t1">Tab một');
    expect(h).toContain('data-modal-box="0"');
    expect(h).toContain('data-close data-goto="s2">Gửi</button>');
    expect(h).toContain('class="icard" data-goto="s2"');
    expect(h).toContain('<span class="badge ok">Đã xong</span>');
    expect(h).toContain('<div class="empty"><b>Trống</b>');
    expect(h).toContain('data-toast="error" data-text="Lỗi rồi">Nhắc');
    expect(h).toContain('<div class="stat"><b>3</b><span>Cần làm</span></div>');
  });

  test("chế độ góp ý: mỗi màn có Đúng ý/Cần sửa/ghi chú; câu hỏi hiện thẻ và đếm", () => {
    const p = structuredClone(base);
    p.questions = [
      {
        id: "q1",
        screen: "s2",
        text: "Hạn bao lâu?",
        options: ["3 ngày", "7 ngày"],
        default: "7 ngày",
      },
    ];
    const h = renderPrototype(p);
    expect(h).toContain('data-verdict="ok" data-sid="s1">Đúng ý');
    expect(h).toContain('data-verdict="fix" data-sid="s2">Cần sửa');
    expect(h).toContain('data-note="s1"');
    expect(h).toContain('data-qa="q1" data-val="7 ngày">7 ngày (gợi ý)');
    expect(h).toContain('id="export"');
    expect(h).toContain('id="pending"');
    expect(h).toContain("Đi thử từng bước");
    expect(h).toContain('data-device="phone"');
    expect(h).toContain("prototype-feedback.json");
  });

  test("sơ đồ luồng: một làn mỗi vai có bước, mỗi bước một ô bấm được", () => {
    const h = renderPrototype(base);
    expect(h.match(/class="lane"/g)).toHaveLength(1);
    expect(h).toContain('data-step="0"');
    expect(h).toContain('<marker id="ah"');
    const two = structuredClone(base);
    two.flow?.push({ from: "s2", action: "Xác nhận", to: "s1", by: "b" });
    expect(renderPrototype(two).match(/marker-end/g)).toHaveLength(1);
  });

  test("dữ liệu nhúng chặn đóng thẻ script; tự chứa và nhỏ hơn 300 KB", () => {
    const p = structuredClone(base);
    p.title = "</script><b>";
    const h = renderPrototype(p);
    expect(h.match(/<\/script>/g)).toHaveLength(2);
    expect(h).toContain("\\u003c/script>");
    expect(Buffer.byteLength(h)).toBeLessThan(300 * 1024);
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
