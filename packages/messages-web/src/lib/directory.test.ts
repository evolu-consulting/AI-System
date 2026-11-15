import { describe, expect, it } from "bun:test";
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { missingBatches } from "./cards";
import { readCollapsed, toggleCollapsed, writeCollapsed } from "./collapse";
import { buildDirectory } from "./directory";

const conv = (o: Partial<ConversationSummary> & { id: string }): ConversationSummary =>
  ({
    kind: "direct",
    title: null,
    peer: null,
    unread: 0,
    last_message: null,
    last_at: "2026-01-01T00:00:00.000Z",
    ...o,
  }) as ConversationSummary;
const P = (id: string, name: string, department: { id: string; name: string } | null = null) => ({
  id,
  name,
  department,
});
const flat = (d: ReturnType<typeof buildDirectory>) =>
  d.sections.flatMap((s) => s.rows.map((r) => r.person.id));

describe("CR-132b · buildDirectory", () => {
  const people = [P("u1", "Bình"), P("u2", "An"), P("u3", "Châu")];
  const items = [
    conv({ id: "g1", kind: "group", title: "Kinh doanh" }),
    conv({ id: "d3", peer: { id: "u3", name: "Châu", active: true } }),
    conv({ id: "d1", peer: { id: "u1", name: "Bình", active: true } }),
  ];
  it("nhóm riêng; thành viên có hội thoại lên trước theo thứ tự mới nhất, còn lại theo tên", () => {
    const d = buildDirectory(items, people, "");
    expect(d.groups.map((c) => c.id)).toEqual(["g1"]);
    expect(flat(d)).toEqual(["u3", "u1", "u2"]);
    expect(d.sections[0]?.rows[2]?.conv).toBeNull();
  });
  it("lọc theo tên không dấu, áp cho cả nhóm lẫn thành viên", () => {
    expect(flat(buildDirectory(items, people, "chau"))).toEqual(["u3"]);
    expect(buildDirectory(items, people, "chau").groups).toEqual([]);
    expect(buildDirectory(items, people, "kinh").groups.length).toBe(1);
  });
  it("1-1 cũ với người không còn trong danh bạ (bị khoá) vẫn hiện", () => {
    const d = buildDirectory(items, [P("u2", "An")], "");
    expect(flat(d)).toEqual(["u3", "u1", "u2"]);
  });
});

describe("CR-148 · danh bạ theo phòng ban", () => {
  const kd = { id: "d1", name: "Kinh doanh" };
  const kt = { id: "d2", name: "Kế toán" };
  const people = [P("u1", "Bình", kd), P("u2", "An"), P("u3", "Châu", kt), P("u4", "Anh", kd)];
  it("nhóm theo phòng (tên phòng), «Chưa có phòng» cuối, trong phòng theo tên", () => {
    const d = buildDirectory([], people, "");
    expect(d.sections.map((s) => s.name)).toEqual(["Kế toán", "Kinh doanh", null]);
    expect(d.sections[1]?.rows.map((r) => r.person.id)).toEqual(["u4", "u1"]);
    expect(d.sections[2]?.key).toBe("none");
  });
  it("1-1 với người chưa tải trang danh bạ: lấy phòng từ thẻ, thiếu thẻ ⇒ Chưa có phòng", () => {
    const items = [conv({ id: "dx", peer: { id: "ux", name: "Xuân", active: true } })];
    expect(buildDirectory(items, [], "", () => kd).sections[0]?.name).toBe("Kinh doanh");
    expect(buildDirectory(items, [], "").sections[0]?.name).toBeNull();
  });
  it("lọc tên làm nhóm rỗng biến mất", () => {
    expect(buildDirectory([], people, "chau").sections.map((s) => s.name)).toEqual(["Kế toán"]);
  });
});

describe("CR-148 · thu gọn nhóm trong phiên", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it("bật/tắt rồi đọc lại, dữ liệu hỏng ⇒ rỗng", () => {
    const st = mem();
    writeCollapsed(toggleCollapsed(new Set(), "d1"), st);
    expect([...readCollapsed(st)]).toEqual(["d1"]);
    writeCollapsed(toggleCollapsed(readCollapsed(st), "d1"), st);
    expect(readCollapsed(st).size).toBe(0);
    expect(readCollapsed({ getItem: () => "{hỏng" }).size).toBe(0);
  });
});

describe("CR-148 · thẻ người theo lô", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `u${i}`);
  it("chia lô ≤ 50, bỏ trùng và id đã có", () => {
    const b = missingBatches([...ids, "u1"], (id) => id === "u0");
    expect(b.map((x) => x.length)).toEqual([50, 50, 19]);
    expect(b.flat()).not.toContain("u0");
  });
  it("không thiếu ai ⇒ không gọi", () => {
    expect(missingBatches(ids, () => true)).toEqual([]);
  });
});
