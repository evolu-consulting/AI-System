import { describe, expect, test } from "bun:test";
import { CORE_NODES } from "@ai/contracts/app-manifest";
import { emptyStage } from "./def-form";
import { edgeIssueView, edgeProblems, nodeToPatches } from "./palette-node";

test("edgeIssueView: tên bước + nhãn theo ngôn ngữ, thiếu thì lấy khoá", () => {
  const issue = {
    from: "a",
    to: "b",
    missing: ["contract_id", "x"],
    from_name: "Duyệt",
    labels: [{ key: "contract_id", vi: "Hợp đồng", en: "Contract" }],
  };
  expect(edgeIssueView(issue, "vi")).toMatchObject({
    fromName: "Duyệt",
    toName: "b",
    labels: ["Hợp đồng", "x"],
  });
  expect(edgeIssueView(issue, "en").labels).toEqual(["Contract", "x"]);
});

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
});
