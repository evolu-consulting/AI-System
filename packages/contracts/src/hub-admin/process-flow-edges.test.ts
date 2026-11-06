// CR-122 · N2 · FLOW2-FR-26 · `flowEdgeIssues` (cạnh lệch giao diện, tất định) + `insertBridgeStage` (chèn cầu nối, dịch các số bước).
import { describe, expect, test } from "bun:test";
import { APP_MANIFESTS, CORE_NODES, nodesFor } from "../app-manifest";
import {
  blockingEdgeIssues,
  type EdgeStage,
  flowEdgeIssues,
  flowEdges,
  flowStageOutputs,
  insertBridgeStage,
} from "./process-flow-edges";

const palette = nodesFor(Object.values(APP_MANIFESTS));
const st = (key: string, o: Partial<EdgeStage> = {}): EdgeStage => ({
  key,
  executor: { kind: "set" },
  after: { kind: "auto" },
  ...o,
});
const field = (key: string, type: string) => ({ output: { fields: [{ key, type }] } });

describe("flowEdgeIssues", () => {
  test("bước sau (Ký số) cần contract_id mà bước trước không có ⇒ missing, có đủ ⇒ sạch", () => {
    const bad = flowEdgeIssues(
      {
        stages: [
          st("a", { step: 0, ...field("x", "string") }),
          st("b", { step: 1, node: "contracts.esign" }),
        ],
      },
      palette,
    );
    expect(bad).toEqual([{ from: "a", to: "b", missing: ["contract_id"], typeMismatch: [] }]);
    expect(blockingEdgeIssues(bad)).toHaveLength(1);
    const ok = flowEdgeIssues(
      {
        stages: [
          st("a", { step: 0, ...field("contract_id", "string") }),
          st("b", { step: 1, node: "contracts.esign" }),
        ],
      },
      palette,
    );
    expect(ok).toEqual([]);
  });

  test("sai kiểu ⇒ typeMismatch (không chặn), stage không có node ⇒ không đòi gì", () => {
    const r = flowEdgeIssues(
      {
        stages: [
          st("a", { step: 0, ...field("date", "string") }),
          st("b", { step: 1, node: "core.wait-until" }),
        ],
      },
      palette,
    );
    expect(r).toEqual([
      {
        from: "a",
        to: "b",
        missing: [],
        typeMismatch: [{ key: "date", expected: "date", got: "string" }],
      },
    ]);
    expect(blockingEdgeIssues(r)).toEqual([]);
    expect(
      flowEdgeIssues({ stages: [st("a", { step: 0 }), st("b", { step: 1 })] }, palette),
    ).toEqual([]);
  });

  test("node điều khiển (Chờ khoảng) trong suốt: dữ liệu của bước trước đi qua", () => {
    const stages = [
      st("a", { step: 0, ...field("contract_id", "string") }),
      st("w", { step: 1, node: "core.wait-for", executor: { kind: "wait_for" } }),
      st("b", { step: 2, node: "contracts.esign" }),
    ];
    expect(flowEdgeIssues({ stages }, palette)).toEqual([]);
    expect(flowStageOutputs({ stages }, palette)[1]?.map((o) => o.key)).toEqual(["contract_id"]);
    // bước giữa là agent/set (không trong suốt) ⇒ dữ liệu không tự đi qua
    const opaque = [stages[0] as EdgeStage, st("m", { step: 1 }), stages[2] as EdgeStage];
    expect(flowEdgeIssues({ stages: opaque }, palette).map((x) => x.to)).toEqual(["b"]);
  });

  test("duyệt mọi đường: nhánh Nếu, after.branch, next_step, node Kết thúc không đi tiếp", () => {
    const stages = [
      st("if", { step: 0, executor: { kind: "if", then_step: 2, else_step: null } }),
      st("mid", { step: 1, next_step: 3 }),
      st("t", { step: 2, node: "contracts.esign" }),
      st("end", { step: 3, outcome: "done" }),
    ];
    const pairs = flowEdges(stages).map(([i, j]) => `${stages[i]?.key}>${stages[j]?.key}`);
    expect(pairs).toEqual(["if>t", "if>mid", "mid>end", "t>end"]);
    expect(flowEdgeIssues({ stages }, palette).map((x) => `${x.from}>${x.to}`)).toEqual(["if>t"]);
  });

  test("node không có trong bảng (tính năng tắt / lạ) ⇒ không đòi gì", () => {
    const stages = [st("a", { step: 0 }), st("b", { step: 1, node: "contracts.esign" })];
    expect(flowEdgeIssues({ stages }, CORE_NODES)).toEqual([]);
  });
});

describe("insertBridgeStage", () => {
  const stages = [
    st("a", { step: 0, after: { kind: "auto", branch: [{ goto_step: 2 }] } }),
    st("b", { step: 1, node: "contracts.esign" }),
    st("c", { step: 2, outcome: "done" }),
  ];
  const bridge = st("bridge", { ...field("contract_id", "string") });

  test("chèn vào cạnh a→b: cầu nối ở bước 1, b/c dời +1, nhánh goto cập nhật, hết lệch", () => {
    const r = insertBridgeStage(stages, "a", "b", bridge);
    expect(r?.step).toBe(1);
    expect(r?.stages.map((s) => [s.key, s.step])).toEqual([
      ["a", 0],
      ["bridge", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(r?.stages[0]?.after.branch).toEqual([{ goto_step: 3 }]);
    expect(flowEdgeIssues({ stages: r?.stages ?? [] }, palette)).toEqual([]);
    expect(stages[1]?.step).toBe(1); // không đổi bản gốc
  });

  test("next_step trỏ đúng bước của b vẫn trỏ cầu nối, Nếu/Duyệt/quay lại dời đúng", () => {
    const s = [
      st("a", {
        step: 0,
        next_step: 1,
        executor: { kind: "approve", reject_step: 3, return_step: null },
      }),
      st("b", { step: 1, node: "contracts.esign", after: { kind: "review", back_to_steps: [0] } }),
      st("x", { step: 2, executor: { kind: "if", then_step: 3, else_step: null } }),
      st("c", { step: 3, outcome: "done" }),
    ];
    const r = insertBridgeStage(s, "a", "b", bridge);
    const by = (k: string) => r?.stages.find((x) => x.key === k);
    expect(by("a")?.next_step).toBe(1);
    expect(by("a")?.executor).toMatchObject({ reject_step: 4, return_step: null });
    expect(by("b")?.after.back_to_steps).toEqual([0]);
    expect(by("x")?.executor).toMatchObject({ then_step: 4, else_step: null });
  });

  test("không có cạnh / khoá trùng / hết chỗ ⇒ null, def không có `step` ⇒ chỉ số làm bước", () => {
    expect(insertBridgeStage(stages, "b", "a", bridge)).toBeNull();
    expect(insertBridgeStage(stages, "a", "b", st("c"))).toBeNull();
    expect(
      insertBridgeStage(
        Array.from({ length: 22 }, (_, i) => st(`s${i}`)),
        "s0",
        "s1",
        bridge,
      ),
    ).toBeNull();
    const legacy = [st("a"), st("b", { node: "contracts.esign" })];
    expect(insertBridgeStage(legacy, "a", "b", bridge)?.stages.map((s) => s.step)).toEqual([
      0, 1, 2,
    ]);
  });
});
