// CR-122 · E5 · khai báo `config` của node (stage có cấu hình + đường lấy lựa chọn thuộc đúng app).
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "./contracts.manifest";
import type { AppManifest, AppNodeDecl } from "./manifest";
import { appNodeIssues } from "./nodes.rules";

const esign = CONTRACTS_MANIFEST.nodes.find((n) => n.key === "contracts.esign") as AppNodeDecl;
const withCfg = (config: AppNodeDecl["config"]): AppManifest => ({
  ...CONTRACTS_MANIFEST,
  nodes: [{ ...esign, ...(config ? { config } : {}) }],
});

describe("E5 · node.config", () => {
  it("node Ký số khai cấu hình ở stage tool 0 + đường options của gói", () => {
    expect(esign.config).toEqual({ stage: 0, options_path: "/pack/contracts/esign/options" });
    expect(esign.stages[esign.config?.stage ?? -1]?.executor.kind).toBe("tool");
    expect(appNodeIssues([CONTRACTS_MANIFEST])).toEqual([]);
  });
  it("stage không phải tool / ngoài phạm vi / đường của app khác ⇒ node_config", () => {
    for (const bad of [
      { stage: 1, options_path: "/pack/contracts/esign/options" }, // stage chờ, không phải tool
      { stage: 5, options_path: "/pack/contracts/esign/options" },
      { stage: 0, options_path: "/pack/community/x" },
    ])
      expect(appNodeIssues([withCfg(bad)]).map((i) => i.rule)).toEqual(["node_config"]);
  });
});
