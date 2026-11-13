import { describe, expect, it } from "bun:test";
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
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
const P = (id: string, name: string) => ({ id, name });

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
    expect(d.members.map((m) => m.person.id)).toEqual(["u3", "u1", "u2"]);
    expect(d.members[2]?.conv).toBeNull();
  });
  it("lọc theo tên không dấu, áp cho cả nhóm lẫn thành viên", () => {
    expect(buildDirectory(items, people, "chau").members.map((m) => m.person.id)).toEqual(["u3"]);
    expect(buildDirectory(items, people, "chau").groups).toEqual([]);
    expect(buildDirectory(items, people, "kinh").groups.length).toBe(1);
  });
  it("1-1 cũ với người không còn trong danh bạ (bị khoá) vẫn hiện", () => {
    const d = buildDirectory(items, [P("u2", "An")], "");
    expect(d.members.map((m) => m.person.id)).toEqual(["u3", "u1", "u2"]);
  });
});
