// dlc-agent-flows · hàng def thư viện → danh sách 3 khe DLC; kiểm `dlc_flows` theo def đã xuất bản của đúng khe.
import { describe, expect, it } from "bun:test";
import { dlcFlowProblems, toDlcFlowList } from "./dlc-flows.map";

const rows = [
  { slot: "dlc.bug-fix", key: "dlc-bug-fix-md", name: "Bug Fix", published_version: 2 },
  { slot: "dlc.enhancement", key: "enh-fast", name: "Nhanh", published_version: 1 },
];

describe("dlc-agent-flows · studio map", () => {
  it("đủ 3 khe theo thứ tự dây chuyền; khe trống ⇒ defs []", () => {
    const l = toDlcFlowList(rows);
    expect(l.items.map((x) => [x.mode, x.slot, x.defs.map((d) => d.key)])).toEqual([
      ["new-system", "dlc.new-system", []],
      ["enhancement", "dlc.enhancement", ["enh-fast"]],
      ["bug-fix", "dlc.bug-fix", ["dlc-bug-fix-md"]],
    ]);
  });
  it("key không thuộc khe / chưa xuất bản ⇒ báo dây chuyền đó", () => {
    expect(dlcFlowProblems({ "bug-fix": "dlc-bug-fix-md" }, rows)).toEqual([]);
    expect(dlcFlowProblems({ "bug-fix": "enh-fast", enhancement: "enh-fast" }, rows)).toEqual([
      "bug-fix",
    ]);
    expect(dlcFlowProblems({ "new-system": "x" }, [])).toEqual(["new-system"]);
  });
});
