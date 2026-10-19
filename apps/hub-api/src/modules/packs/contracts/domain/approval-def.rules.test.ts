// HD-FR-31 · HD-FR-33 · HD-FR-37 · D3-02 · D3-12: def duyệt hợp đồng (hợp lệ theo luật lưu của engine) + luật rẽ cấp 2.
import { describe, expect, test } from "bun:test";
import { branchStageIssues, ProcessDefInputSchema, toolStageIssues } from "@ai/contracts/hub-admin";
import {
  APPROVAL_DEFAULTS,
  APPROVAL_PROCESS_KEY,
  approvalStepOf,
  buildApprovalDef,
  CONTRACT_TOOL_KEYS,
  needsLevel2,
} from "./approval-def.rules";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const def = buildApprovalDef({ level1GroupId: G1, level2GroupId: G2 });

describe("HD-FR-31 · def `contracts-approval`", () => {
  test("qua schema lưu def của engine (luật chéo stage, nguồn)", () => {
    const p = ProcessDefInputSchema.safeParse(def);
    expect(p.success ? [] : p.error.issues).toEqual([]);
    expect(def.key).toBe(APPROVAL_PROCESS_KEY);
    expect(def.run_group_ids).toEqual([G1, G2]);
  });
  test("không vi phạm luật tool/rẽ nhánh (catalog tool gói)", () => {
    const tools = new Map(
      Object.values(CONTRACT_TOOL_KEYS).map((key) => [
        key,
        {
          key,
          side_effect: false,
          params: [{ name: "contract_id", type: "text", required: true }],
        },
      ]),
    );
    expect(toolStageIssues(def.stages, def.inputs, tools)).toEqual([]);
    expect(branchStageIssues(def.stages)).toEqual([]);
  });
  test("cấp 1 = review Group 1 (người bắt đầu ĐƯỢC duyệt, câu 5); cấp 2 = Group 2 + exclude_starter", () => {
    const [extract, value, approve, finalize] = def.stages;
    expect(extract?.after).toMatchObject({ kind: "review", group_id: G1, exclude_starter: false });
    expect(value?.after).toMatchObject({
      kind: "auto",
      branch: [{ field: "level2", op: "eq", value: "no", goto_step: 3 }],
    });
    expect(approve?.after).toMatchObject({ kind: "review", group_id: G2, exclude_starter: true });
    expect(finalize?.executor).toMatchObject({
      kind: "tool",
      tool_key: CONTRACT_TOOL_KEYS.finalize,
    });
    // D3-02: ngưỡng KHÔNG nằm trong def (cài đặt tenant, đọc lúc chạy).
    expect(JSON.stringify(def)).not.toContain("500000000");
  });
});

describe("HD-FR-33 · HD-FR-37 · needsLevel2", () => {
  test("mặc định intake câu 3: 500.000.000; đúng ngưỡng ⇒ cấp 2 (≥)", () => {
    expect(APPROVAL_DEFAULTS.threshold).toBe(500_000_000);
    expect(needsLevel2(245_000_000, 500_000_000)).toBe(false);
    expect(needsLevel2(500_000_000, 500_000_000)).toBe(true);
    expect(needsLevel2(600_000_000, 500_000_000)).toBe(true);
  });
  test("trống / không phải số / âm ⇒ cấp 2 (an toàn)", () => {
    for (const v of [null, undefined, "245000000", Number.NaN, -1])
      expect(needsLevel2(v, 500_000_000)).toBe(true);
  });
  test("ngưỡng tenant khác: 100 tr ⇒ 245 tr cần cấp 2", () => {
    expect(needsLevel2(245_000_000, 100_000_000)).toBe(true);
  });
});

describe("HD-FR-36 · bước hiển thị", () => {
  test("stage + trạng thái run ⇒ bước", () => {
    expect(approvalStepOf("running", "extract", false)).toBe("extract");
    expect(approvalStepOf("waiting_review", "extract", false)).toBe("level1");
    expect(approvalStepOf("waiting_review", "approve", false)).toBe("level2");
    expect(approvalStepOf("running", "finalize", false)).toBe("finalize");
    expect(approvalStepOf("done", "finalize", false)).toBe("done");
    expect(approvalStepOf("cancelled", "approve", true)).toBe("rejected");
    expect(approvalStepOf("cancelled", "extract", false)).toBe("cancelled");
  });
});
