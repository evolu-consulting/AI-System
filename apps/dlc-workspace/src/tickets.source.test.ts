import { describe, expect, test } from "bun:test";
import type { Project } from "./store";
import { sourceOf } from "./tickets.routes";

const proj = (key: string, title: string, apps?: string[]): Project => ({
  key,
  title,
  conversation_id: null,
  kh_project: key,
  stack: "",
  test_command: null,
  created_at: "2026-10-30T00:00:00.000Z",
  queue: [],
  ...(apps && { apps }),
});
const projects = [
  proj("the-memories", "The Memories"),
  proj("contracts", "Hợp đồng", ["Sổ Hợp Tác"]),
];

describe("dlc-dify · project nguồn của ticket góp ý", () => {
  test("dòng `DLC project:` trỏ project có thật ⇒ gắn project đó", () => {
    const desc = "Thêm nút chia sẻ\n---\nApp: The Memories\nDLC project: the-memories\nTrang: #/";
    expect(sourceOf(desc, projects)).toEqual({ app: "The Memories", project: "the-memories" });
  });
  test("không có `DLC project:` ⇒ `App:` khớp tên hoặc apps của project", () => {
    expect(sourceOf("x\n---\nApp: Sổ Hợp Tác", projects).project).toBe("contracts");
    expect(sourceOf("x\n---\nApp: the memories", projects).project).toBe("the-memories");
  });
  test("project không có thật / app lạ / không ghi ⇒ null (không đoán)", () => {
    expect(sourceOf("x\nDLC project: nope\nApp: Lạ", projects)).toEqual({
      app: "Lạ",
      project: null,
    });
    expect(sourceOf("chỉ có lời góp ý", projects)).toEqual({ app: "", project: null });
  });
});
