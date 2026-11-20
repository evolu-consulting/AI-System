// CR-193 UAT · nhãn phạm vi bài (BR-191-7), nguồn lọc luôn có «Đối tác» (BR-191), chèn «@Tên» tại chỗ (BR-191-8).
import { describe, expect, it } from "bun:test";
import i18next from "i18next";

// Module cộng đồng không tự init i18next (shell làm): khởi tạo trước, rồi mới nạp mã dùng `t()`.
await i18next.init({
  lng: "vi",
  fallbackLng: "vi",
  resources: {},
  interpolation: { escapeValue: false },
});
const { registerCommunityVi } = await import("../i18n");
registerCommunityVi();
const { sourceChoices } = await import("./feed-source");
const { scopeLabel } = await import("./scope-label");
const { applyMention } = await import("./thread");

describe("CR-193 scopeLabel · nhãn phạm vi ở đầu bài", () => {
  it("bài chủ quản «Chỉ nội bộ» ⇒ «Chỉ nội bộ», không phải «Bạn bè»", () => {
    expect(
      scopeLabel({
        authorSide: "host",
        type: "note",
        audience: { mode: "internal", cats: [], companies: [], tenants: [] },
      }),
    ).toBe("Chỉ nội bộ");
  });
  it("bài chủ quản «Tất cả đối tác» và «Nhà cung cấp» ⇒ đúng nhãn «Ai thấy bài»", () => {
    const a = (mode: "all" | "suppliers") => ({ mode, cats: [], companies: [], tenants: [] });
    expect(scopeLabel({ authorSide: "host", type: "sell", audience: a("all") })).toBe(
      "Tất cả đối tác",
    );
    expect(scopeLabel({ authorSide: "host", type: "sell", audience: a("suppliers") })).toBe(
      "Nhà cung cấp",
    );
  });
  it("bài đối tác ⇒ «Chỉ nội bộ» (chỉ chủ quản thấy); người xem không nhận audience ⇒ không hiện nhãn (không nói sai)", () => {
    expect(scopeLabel({ authorSide: "partner", type: "sell" })).toBe("Chỉ nội bộ");
    expect(scopeLabel({ authorSide: "host", type: "sell" })).toBeNull();
  });
});

describe("CR-193 sourceChoices · nguồn trong bộ lọc", () => {
  it("không có công ty kết nối vẫn có Tất cả / Công ty mình / Đối tác", () => {
    expect(sourceChoices([]).map((c) => c.value)).toEqual(["", "own", "connected"]);
  });
  it("có công ty kết nối ⇒ thêm từng công ty sau «Đối tác»", () => {
    expect(sourceChoices([{ id: "a", name: "A" }]).map((c) => c.value)).toEqual([
      "",
      "own",
      "connected",
      "a",
    ]);
  });
});

describe("CR-193 applyMention · chọn người trong danh sách thả", () => {
  it("thay «@query» bằng «@Tên » và đặt con trỏ sau đó", () => {
    expect(applyMention("Nhờ @La", { start: 4, query: "La" }, "Lan")).toEqual({
      text: "Nhờ @Lan ",
      caret: 9,
    });
  });
  it("giữ phần chữ sau con trỏ", () => {
    expect(applyMention("a @L cuối", { start: 2, query: "L" }, "Lan")).toEqual({
      text: "a @Lan  cuối",
      caret: 7,
    });
  });
});

describe("CR-193 suggestKey · phím trong danh sách thả", () => {
  it("↓↑ quay vòng, Enter/Tab nhận, Esc đóng, danh sách rỗng chỉ Esc", async () => {
    const { suggestKey } = await import("../application/useMentionSuggest");
    expect(suggestKey("ArrowDown", 3, 2)).toEqual({ kind: "move", index: 0 });
    expect(suggestKey("ArrowUp", 3, 0)).toEqual({ kind: "move", index: 2 });
    expect(suggestKey("Enter", 3, 1)).toEqual({ kind: "pick" });
    expect(suggestKey("Tab", 3, 1)).toEqual({ kind: "pick" });
    expect(suggestKey("Escape", 0, 0)).toEqual({ kind: "close" });
    expect(suggestKey("Enter", 0, 0)).toEqual({ kind: "none" });
    expect(suggestKey("a", 3, 0)).toEqual({ kind: "none" });
  });
});
