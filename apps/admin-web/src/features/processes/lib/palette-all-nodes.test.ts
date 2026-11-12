// CR-123 · u3b · menu "+" dựng patch cho MỌI node của bảng (lõi + app): một node đặt sẵn thiếu trường (vd "Chờ tới" không có nguồn ngày)
// từng làm vỡ cả trang trình soạn flow ("Cannot read properties of undefined (reading 'kind')").
import { describe, expect, test } from "bun:test";
import { APP_MANIFESTS, CORE_NODES } from "@ai/contracts/app-manifest";
import { nodeToPatches } from "./palette-node";

describe("nodeToPatches · mọi node của bảng", () => {
  const all = [...CORE_NODES, ...Object.values(APP_MANIFESTS).flatMap((m) => m.nodes)];
  test.each(all.map((n) => [n.key, n] as const))(
    "%s dựng được patch, số patch = số stage",
    (_k, n) => {
      expect(nodeToPatches(n).length).toBe(n.stages.length);
    },
  );
  test("node Chờ (lõi) đặt sẵn một khoảng, không ném lỗi", () => {
    const w = CORE_NODES.find((n) => n.key === "core.wait");
    expect(w && nodeToPatches(w)[0]?.executor).toBe("wait_for");
  });
});
