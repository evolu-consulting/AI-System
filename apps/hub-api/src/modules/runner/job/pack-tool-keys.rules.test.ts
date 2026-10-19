// M2-chat · N2-FR-03 · `runtime_options.pack_tools` → `payload.mcp.tools` (thuần).
import { describe, expect, it } from "bun:test";
import { MCP_TOOLS_MAX } from "@ai/contracts/hub";
import { packToolKeys, withPackTools } from "./pack-tool-keys.rules";

describe("M2-chat · pack_tools của agent [N2-FR-03]", () => {
  it("vắng / sai kiểu ⇒ []", () => {
    expect(packToolKeys({})).toEqual([]);
    expect(packToolKeys({ pack_tools: "contracts-search" })).toEqual([]);
    expect(packToolKeys({ pack_tools: null })).toEqual([]);
  });

  it("bỏ khoá sai dạng / trùng / không phải chuỗi, giữ thứ tự", () => {
    const opts = { pack_tools: ["contracts-get", "BAD KEY", 3, "contracts-get", "contracts-cks"] };
    expect(packToolKeys(opts)).toEqual(["contracts-get", "contracts-cks"]);
  });

  it("gộp sau khoá workflow catalog, không trùng, trần MCP_TOOLS_MAX", () => {
    expect(withPackTools(["tom"], { pack_tools: ["contracts-get", "tom"] })).toEqual([
      "tom",
      "contracts-get",
    ]);
    const full = Array.from({ length: MCP_TOOLS_MAX }, (_, i) => `wf-${i}`);
    expect(withPackTools(full, { pack_tools: ["contracts-get"] })).toEqual(full);
  });

  it("không đổi mảng đầu vào", () => {
    const keys = ["tom"];
    withPackTools(keys, { pack_tools: ["contracts-get"] });
    expect(keys).toEqual(["tom"]);
  });
});
