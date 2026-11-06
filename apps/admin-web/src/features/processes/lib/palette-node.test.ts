import { describe, expect, test } from "bun:test";
import { CORE_NODES } from "@ai/contracts/app-manifest";
import { emptyStage } from "./def-form";
import { bridgePatch, edgeProblems, nodeToPatches } from "./palette-node";

const waitUntil = CORE_NODES.find((n) => n.key === "core.wait-until");
const email = CORE_NODES.find((n) => n.key === "core.email");
if (!waitUntil || !email) throw new Error("thiếu node lõi");

const st = (uid: string, step: number, node?: string) => ({
  ...emptyStage(step),
  uid,
  ...(node ? { node } : {}),
});

describe("palette-node", () => {
  test("node bảng → draft có `node` và giữ cấu hình thông báo đặt sẵn", () => {
    const p = nodeToPatches(email)[0];
    expect(p?.node).toBe("core.email");
    expect(p?.executor).toBe("notify");
    expect(p?.notifyRaw?.channels).toContain("email");
  });
  test("cạnh vàng: Chờ tới ngày cần `date` mà bước trước không có", () => {
    const r = edgeProblems([st("a", 0), st("b", 1, "core.wait-until")], CORE_NODES);
    expect(r).toEqual([
      expect.objectContaining({ from: "a", to: "b", rule: "missing", key: "date" }),
    ]);
  });
  test("không có node bảng ⇒ không cạnh vàng", () => {
    expect(edgeProblems([st("a", 0), st("b", 1)], CORE_NODES)).toEqual([]);
  });
  test("nhận gợi ý cầu nối ⇒ node Ghi giá trị", () => {
    const p = bridgePatch({ rows: [{ key: "date", from: { input: "end_date" } }] }, "Cầu nối");
    expect(p.executor).toBe("set");
    expect(p.set?.rows[0]).toEqual({ key: "date", source: "input", input: "end_date", value: "" });
  });
});
