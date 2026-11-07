// CR-125 · m8 · MOD-FR-12 · cổng vào/ra của MỌI node trong `MODULES`: đủ nhãn vi/en, đầu ra khai báo khớp binding (`MOD_OUTPUT_UNBOUND`),
// nguồn tự nối lấy từ đầu ra các bước TRƯỚC (topo), không chỉ "Bắt đầu khi"; đầu ra `pending` không phải nguồn.
import { describe, expect, test } from "bun:test";
import type { AppNodeIo } from "../app-manifest/manifest";
import { flowMapSources } from "../hub-admin/process-flow-sources";
import { ancestorsOf, autoMapInputs, mapSourcesAt } from "./auto-map";
import {
  type BoundSummary,
  type FeatureModule,
  type FeatureNodeDecl,
  featureNodeByKey,
  MODULES,
  moduleIssues,
  writableOutputKeys,
} from "./index";

const NODES = MODULES.flatMap((m) => m.nodes);
const out = (key: string, o: Partial<AppNodeIo> = {}): AppNodeIo => ({
  key,
  type: "string",
  required: false,
  label: { vi: key, en: key },
  ...o,
});
const boundOf = (nodes: BoundSummary["nodes"]): BoundSummary => ({
  nodes,
  tools: new Set(),
  facts: new Set(),
  outcomes: new Set(),
});
const demoNode = (outputs: AppNodeIo[]): FeatureNodeDecl => ({
  key: "demo.step",
  label: { vi: "Bước thử", en: "Demo step" },
  group: "sign",
  kind: "app",
  stages: [{ executor: { kind: "set", values: [] } }],
  inputs: [],
  outputs,
});
const demo = (n: FeatureNodeDecl): FeatureModule => ({ app: "demo", nodes: [n], events: [] });

describe("cổng đủ nhãn nghiệp vụ", () => {
  test("mọi cổng vào/ra của mọi node có nhãn vi + en khác khoá", () => {
    const bad = NODES.flatMap((n) =>
      [...n.inputs, ...n.outputs].flatMap((io) => {
        const ok = (s: string | undefined) => !!s?.trim() && s !== io.key;
        return ok(io.label?.vi) && ok(io.label?.en) ? [] : [`${n.key}:${io.key}`];
      }),
    );
    expect(bad).toEqual([]);
  });
  test("đầu vào bắt buộc có cách khắc phục (fix) để hỏi bằng câu nghiệp vụ", () => {
    const bad = NODES.flatMap((n) =>
      n.inputs.filter((i) => i.required && !i.fix?.vi?.trim()).map((i) => `${n.key}:${i.key}`),
    );
    expect(bad).toEqual([]);
  });
  test("cổng ra các node chính đúng danh sách đã chốt", () => {
    const keys = (k: string) => (featureNodeByKey(MODULES, k)?.outputs ?? []).map((o) => o.key);
    expect(keys("core.approve")).toEqual(["decision", "decided_by", "feedback"]);
    expect(keys("contracts.esign")).toEqual(["event", "signed_at", "signer", "envelope_id"]);
    expect(keys("contracts.partner-send")).toEqual(["event", "partner_reason", "round"]);
    expect(keys("core.bell")).toEqual(["sent_to"]);
    expect(keys("core.email")).toEqual(["sent_to"]);
    expect(keys("core.if")).toEqual([]);
  });
  test("danh sách đầu ra CHƯA ghi (pending) — lát engine làm xong thì bỏ khỏi đây và khỏi node.ts", () => {
    const pending = NODES.flatMap((n) =>
      n.outputs.filter((o) => o.pending).map((o) => `${n.key}:${o.key}`),
    );
    expect(pending.sort()).toEqual(
      [
        "contracts.esign:envelope_id",
        "contracts.esign:signed_at",
        "contracts.esign:signer",
        "contracts.partner-send:partner_reason",
        "contracts.partner-send:round",
        "core.bell:sent_to",
        "core.email:sent_to",
      ].sort(),
    );
  });
});

describe("MOD_OUTPUT_UNBOUND", () => {
  const node = demoNode([out("a"), out("b", { pending: true })]);
  const bind = (outputs?: string[]) =>
    boundOf(new Map([["demo.step", { tools: [], ...(outputs ? { outputs } : {}) }]]));
  const msgs = (b: BoundSummary) =>
    moduleIssues([demo(node)], b)
      .filter((i) => i.code === "MOD_OUTPUT_UNBOUND")
      .map((i) => i.message);

  test("binding không ghi đầu ra đã khai ⇒ lỗi tiếng Việt nói node, cổng, file cần sửa", () => {
    const m = msgs(bind());
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("Node «Bước thử» khai đầu ra «a» (a)");
    expect(m[0]).toContain("packs/demo/nodes/step/binding.ts");
  });
  test("ghi đủ đầu ra không pending ⇒ sạch", () => {
    expect(msgs(bind(["a"]))).toEqual([]);
  });
  test("ghi đầu ra còn pending hoặc không khai ⇒ lỗi (khai báo và máy chủ phải khớp)", () => {
    expect(msgs(bind(["a", "b"]))[0]).toContain("bỏ pending: true");
    expect(msgs(bind(["a", "zzz"]))[0]).toContain("ghi đầu ra «zzz» nhưng node.ts không khai");
  });
  test("bước cơ bản có binding mà thiếu đầu ra ⇒ lỗi; không có binding ⇒ không xét", () => {
    const base: FeatureNodeDecl = { ...node, key: "demo.base", kind: "base", stages: [] };
    const m: FeatureModule = { app: "demo", nodes: [base], events: [] };
    const has = boundOf(new Map([["demo.base", { tools: [] }]]));
    expect(moduleIssues([m], has).map((i) => i.code)).toEqual(["MOD_OUTPUT_UNBOUND"]);
    expect(moduleIssues([m], boundOf(new Map()))).toEqual([]);
  });
  test("writableOutputKeys bỏ pending", () => {
    expect(writableOutputKeys(node)).toEqual(["a"]);
  });
});

describe("tự nối từ đầu ra các bước trước", () => {
  // Thông báo cần «Thời điểm ký» (date) — chỉ Ký số (bước trước) cấp; «Bắt đầu khi» không có.
  const needSigned: AppNodeIo[] = [
    {
      key: "signed_at",
      type: "date",
      required: true,
      label: { vi: "Thời điểm ký", en: "Signed at" },
      fix: { vi: "thêm bước Ký số trước.", en: "add an E-signature step first." },
    },
  ];
  const start = [out("contract_id")];
  const opt = { node: "Thông báo" };
  const edges = [
    [0, 1],
    [1, 2],
  ] as const;

  test("nối được khi MỘT bước trước cấp đúng khoá + kiểu (không chỉ Bắt đầu khi)", () => {
    const steps = [
      { id: "approve", outputs: [out("decision")] },
      { id: "sign", outputs: [out("signed_at", { type: "date" })] },
      { id: "notify", outputs: [] },
    ];
    const src = mapSourcesAt(start, steps, edges, 2);
    expect(src.map((s) => s.id)).toEqual(["contract_id", "approve:decision", "sign:signed_at"]);
    const r = autoMapInputs(needSigned, src, opt);
    expect(r.bound).toEqual([{ key: "signed_at", source: "sign:signed_at", from: "step" }]);
    expect(r.ask).toEqual([]);
  });
  test("bước SAU hoặc nhánh khác không phải nguồn; thứ tự theo topo", () => {
    const steps = [
      { id: "x", outputs: [out("signed_at", { type: "date" })] },
      { id: "y", outputs: [out("decision")] },
      { id: "z", outputs: [out("signed_at", { type: "date" })] },
    ];
    // x → z, y → z; mục tiêu y chỉ thấy bước trước nó (không có)
    expect(
      ancestorsOf(
        [
          [0, 2],
          [1, 2],
        ],
        2,
      ),
    ).toEqual([0, 1]);
    expect(
      mapSourcesAt(
        [],
        steps,
        [
          [0, 2],
          [1, 2],
        ],
        1,
      ),
    ).toEqual([]);
    expect(
      ancestorsOf(
        [
          [0, 1],
          [1, 2],
          [0, 2],
        ],
        2,
      ),
    ).toEqual([0, 1]);
  });
  test("hai bước trước cùng cấp một khoá ⇒ HỎI (nhiều nguồn), câu nghiệp vụ", () => {
    const steps = [
      { id: "sign1", outputs: [out("signed_at", { type: "date" })] },
      { id: "sign2", outputs: [out("signed_at", { type: "date" })] },
      { id: "notify", outputs: [] },
    ];
    const r = autoMapInputs(needSigned, mapSourcesAt(start, steps, edges, 2), opt);
    expect(r.bound).toEqual([]);
    expect(r.ask[0]).toMatchObject({
      reason: "many",
      sources: ["sign1:signed_at", "sign2:signed_at"],
    });
    expect(r.ask[0]?.message).toBe(
      "Bước «Thông báo» có nhiều nguồn cho «Thời điểm ký» — chọn một nguồn.",
    );
  });
  test("không bước nào cấp ⇒ hỏi kèm cách khắc phục; đầu ra pending không tính là nguồn", () => {
    const steps = [
      { id: "sign", outputs: [out("signed_at", { type: "date", pending: true })] },
      { id: "notify", outputs: [] },
    ];
    const src = mapSourcesAt(start, steps, [[0, 1]], 1);
    expect(src.map((s) => s.id)).toEqual(["contract_id"]);
    const r = autoMapInputs(needSigned, src, opt);
    expect(r.ask[0]?.message).toBe("Bước «Thông báo» cần «Thời điểm ký» — thêm bước Ký số trước.");
  });
});

describe("flowMapSources · flow thật từ sổ MODULES", () => {
  const stage = (key: string, kind: string, node?: string, o: object = {}) => ({
    key,
    ...(node ? { node } : {}),
    executor: { kind },
    after: {},
    ...o,
  });
  // 0 Duyệt (def cũ, không node) → 1,2 Ký số (gửi + chờ, cùng node) → 3 Thông báo
  const def = {
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      stage("duyet", "approve"),
      stage("ky_gui", "tool", "contracts.esign"),
      stage("ky_cho", "wait_event", "contracts.esign"),
      stage("bao", "notify", "core.bell"),
    ],
  };
  test("nguồn tại Thông báo = Bắt đầu khi + Duyệt (khớp theo executor) + Ký số MỘT lần; pending bỏ", () => {
    const ids = flowMapSources(def, 3).map((s) => s.id);
    expect(ids).toContain("contract_id");
    expect(ids).toEqual(
      expect.arrayContaining(["duyet:decision", "duyet:decided_by", "duyet:feedback"]),
    );
    expect(ids.filter((i) => i.startsWith("ky_"))).toEqual(["ky_cho:event"]);
    expect(ids.some((i) => i.endsWith(":signed_at"))).toBe(false);
  });
  test("bước đầu chỉ thấy Bắt đầu khi", () => {
    expect(flowMapSources(def, 0).every((s) => s.from === "start")).toBe(true);
  });
});
