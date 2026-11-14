// CR-127 · E9 · node lõi cũ (`core.wait-until`…) không còn trên bảng node nhưng def đã lưu còn mang khoá ⇒ kiểm cạnh vẫn thấy.
import { describe, expect, test } from "bun:test";
import { type EdgeStage, flowEdgeIssues } from "../hub-admin/process-flow-edges";
import { CORE_NODES, LEGACY_CORE_NODES, withLegacyCoreNodes } from "./core.nodes";

const set = (key: string, step: number, fkey: string, type: string): EdgeStage => ({
  key,
  step,
  executor: { kind: "set", values: [{ key: fkey }] },
  after: { kind: "auto" },
  output: { fields: [{ key: fkey, type }] },
});
const to = (node: string): EdgeStage => ({
  key: "giua",
  step: 1,
  node,
  executor: { kind: "set" },
  after: { kind: "auto" },
});

describe("withLegacyCoreNodes", () => {
  test("Hẹn giờ cũ không vào bảng node/menu nhưng có trong bảng kiểm cạnh", () => {
    expect(CORE_NODES.some((n) => n.key === "core.wait-until")).toBe(false);
    expect(LEGACY_CORE_NODES.some((n) => n.key === "core.wait-until")).toBe(true);
    expect(withLegacyCoreNodes(CORE_NODES).some((n) => n.key === "core.wait-until")).toBe(true);
  });
  test("không nhân đôi khoá đã có trong bảng", () => {
    const keys = withLegacyCoreNodes(CORE_NODES).map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(withLegacyCoreNodes(withLegacyCoreNodes(CORE_NODES))).toEqual(
      withLegacyCoreNodes(CORE_NODES),
    );
  });
  test("nối tới core.wait-until với `date` kiểu chuỗi ⇒ cảnh báo kiểu; kiểu date ⇒ sạch; bảng không có node cũ ⇒ lọt", () => {
    const mk = (type: string) => ({ stages: [set("dau", 0, "date", type), to("core.wait-until")] });
    const bad = flowEdgeIssues(mk("string"), withLegacyCoreNodes(CORE_NODES));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({
      from: "dau",
      to: "giua",
      missing: [],
      typeMismatch: [{ key: "date", expected: "date", got: "string" }],
    });
    expect(flowEdgeIssues(mk("date"), withLegacyCoreNodes(CORE_NODES))).toEqual([]);
    expect(flowEdgeIssues(mk("string"), CORE_NODES)).toEqual([]); // hồi quy cũ: không có node cũ ⇒ không cảnh báo
  });
});
