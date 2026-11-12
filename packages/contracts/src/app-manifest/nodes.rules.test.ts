// CR-122 · FLOW2-FR-25/26 · `appNodeIssues` (check:app-events) + `edgeIssues` (nối hai node lệch giao diện) + `nodesFor`.
import { describe, expect, test } from "bun:test";
import {
  APP_MANIFESTS,
  type AppManifest,
  type AppNodeDecl,
  appNodeIssues,
  CORE_NODES,
  edgeIssues,
  nodesFor,
} from "./index";

const node = (o: Partial<AppNodeDecl> = {}): AppNodeDecl => ({
  key: "demo.x",
  label: { vi: "X", en: "X" },
  group: "message",
  stages: [{ executor: { kind: "wait_for", hours: 1 } }],
  inputs: [],
  outputs: [],
  ...o,
});
const app = (nodes: AppNodeDecl[]): AppManifest => ({
  key: "demo",
  name: "demo",
  levelFeatures: { read: "demo-read", write: "demo-write", admin: "demo-admin" },
  addons: [],
  nav: [],
  slots: [],
  events: [
    {
      key: "demo.created",
      label: "Khi tạo",
      facts: [],
      outcomes: [{ key: "done", label: "Xong", effect: "—" }],
      decides: false,
      required: false,
    },
  ],
  nodes,
});
const rules = (m: AppManifest[]) => appNodeIssues(m).map((i) => i.rule);

describe("FLOW2-FR-25 · nodes[]", () => {
  test("node lõi + manifest thật hợp lệ, Ký số = tool + wait_event, Hiện bài = Kết thúc shown", () => {
    expect(appNodeIssues(Object.values(APP_MANIFESTS))).toEqual([]);
    expect(CORE_NODES.map((n) => n.key)).toEqual(["core.notify", "core.wait", "core.subprocess"]);
    const es = APP_MANIFESTS.contracts?.nodes.find((n) => n.key === "contracts.esign");
    expect(es?.stages.map((s) => s.executor.kind)).toEqual(["tool", "wait_event"]);
    expect(APP_MANIFESTS.community?.nodes[0]?.stages[0]?.outcome).toBe("shown");
  });
  test("khai sai ⇒ mã luật, khoá trùng / khác tiền tố app", () => {
    const bad = node({
      key: "khac.x",
      label: { vi: " ", en: "X" },
      stages: [{ executor: { kind: "agent" as never }, outcome: "khong-co" }],
      inputs: [
        { key: "a", type: "number", required: true },
        { key: "a", type: "number", required: false },
      ],
    });
    expect(rules([app([bad])])).toEqual([
      "node_key_prefix",
      "node_label",
      "node_executor",
      "node_outcome",
      "node_io",
    ]);
    expect(rules([app([node(), node()])])).toEqual(["node_key_duplicate"]);
    expect(rules([app([node({ stages: [] })])])).toEqual(["node_stages"]);
  });
  test("nodesFor: lõi + node của app được hỏi", () => {
    const keys = nodesFor(Object.values(APP_MANIFESTS), "community").map((n) => n.key);
    expect(keys).toContain("core.notify");
    expect(keys).toContain("community.show-post");
    expect(keys).not.toContain("contracts.esign");
  });
});

describe("FLOW2-FR-26 · edgeIssues", () => {
  test("đủ và khớp kiểu ⇒ rỗng, thiếu đầu vào bắt buộc ⇒ missing, khác kiểu ⇒ type, không bắt buộc thiếu ⇒ bỏ qua", () => {
    const prev = [
      { key: "contract_id", type: "string" as const, required: true },
      { key: "total_value", type: "string" as const, required: true },
    ];
    expect(edgeIssues(prev, [{ key: "contract_id", type: "string", required: true }])).toEqual([]);
    // CR-122 p17 · khoá khớp TUYỆT ĐỐI: lệch chính tả (contract-id ≠ contract_id) ⇒ báo thiếu để AI gợi ý cầu nối
    expect(edgeIssues(prev, [{ key: "contract-id", type: "string", required: true }])).toEqual([
      { key: "contract-id", rule: "missing" },
    ]);
    expect(
      edgeIssues(prev, [
        { key: "date", type: "date", required: true },
        { key: "total_value", type: "number", required: false },
        { key: "note", type: "string", required: false },
      ]),
    ).toEqual([
      { key: "date", rule: "missing" },
      { key: "total_value", rule: "type", expected: "number", got: "string" },
    ]);
  });
});
