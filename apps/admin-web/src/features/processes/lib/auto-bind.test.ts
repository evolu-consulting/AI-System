// CR-125 · m4 · MOD-FR-12 · unit: tự nối khi thêm node Ký số vào flow bắt đầu từ hợp đồng.
import { describe, expect, it } from "bun:test";
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { MODULES } from "@ai/contracts/modules";
import { autoBindNode, mapSources } from "./auto-bind";
import { nodeToPatches } from "./palette-node";

const ESIGN_NODE = MODULES.flatMap((m) => m.nodes).find(
  (n) => n.key === "contracts.esign",
) as AppNodeDecl;
const START = [{ key: "contract_id", type: "string" as const, required: true }];
const byKey = new Map<string, AppNodeDecl>([[ESIGN_NODE.key, ESIGN_NODE]]);

describe("autoBindNode", () => {
  it("một nguồn từ Bắt đầu khi ⇒ nối contract_id vào tham số tool, không hỏi", () => {
    const r = autoBindNode(
      ESIGN_NODE,
      nodeToPatches(ESIGN_NODE),
      mapSources(START, [], byKey),
      "vi",
    );
    expect(r.asks).toEqual([]);
    expect(r.patches[0]?.tool?.args.contract_id).toEqual({
      from: "input",
      value: "contract_id",
      kind: "string",
    });
  });

  it("không có nguồn ⇒ giữ nguyên + câu nghiệp vụ kèm cách khắc phục", () => {
    const r = autoBindNode(ESIGN_NODE, nodeToPatches(ESIGN_NODE), mapSources([], [], byKey), "vi");
    expect(r.patches[0]?.tool?.args.contract_id).toBeUndefined();
    expect(r.asks).toEqual(["Bước «Ký số» cần «Hợp đồng» — thêm bước Tải hợp đồng trước."]);
  });
});
