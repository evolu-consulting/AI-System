// CR-127 · U3 · BR-17 · view-model «Chạy thử»: dữ kiện mẫu ⇒ yêu cầu; phản hồi ⇒ hàng hiển thị + cảnh báo + 4 trường hợp.
import { describe, expect, test } from "bun:test";
import {
  buildFacts,
  buildRequest,
  decide,
  type FactField,
  factFieldsOf,
  type PathStep,
  type PreviewResponse,
  rowsOf,
  type ScenarioResponse,
  scenarioRowsOf,
  summaryOf,
  toScenarioRequest,
  warningRows,
} from "./test-run";

const FIELDS: FactField[] = [
  { key: "total_value", label: "Giá trị hợp đồng", kind: "number", options: [] },
  { key: "new_partner", label: "Đối tác mới", kind: "boolean", options: [] },
  {
    key: "importance",
    label: "Mức",
    kind: "enum",
    options: [{ value: "normal", label: "Thường" }],
  },
];

describe("dữ kiện mẫu ⇒ yêu cầu", () => {
  test("số có dấu chấm ⇒ số; boolean; trống bị bỏ", () => {
    const r = buildFacts(FIELDS, {
      total_value: "650.000.000",
      new_partner: "true",
      importance: "",
    });
    expect(r.facts).toEqual({ total_value: 650_000_000, new_partner: true });
    expect(r.invalid).toEqual([]);
  });
  test("số sai ⇒ liệt kê khoá lỗi, không đưa vào dữ kiện", () => {
    const r = buildFacts(FIELDS, { total_value: "5tr" });
    expect(r.invalid).toEqual(["total_value"]);
    expect(r.facts).toEqual({});
  });
  test("ô nhập lấy từ dữ kiện của sự kiện", () => {
    const f = factFieldsOf({
      facts: [
        { key: "total_value", label: "Giá trị", type: "number" },
        { key: "d", label: "Phòng", type: "department" },
      ],
    });
    expect(f.map((x) => x.kind)).toEqual(["number", "text"]);
    expect(factFieldsOf(undefined)).toEqual([]);
  });
  test("yêu cầu gửi bản nháp + người gửi + chuỗi quyết định; 4 trường hợp bỏ quyết định", () => {
    const src = { draft: { event: "contract.submitted", stages: [] } };
    const ds = decide([], "s2", "approve", "u1");
    const req = buildRequest(src, { total_value: 1 }, "u9", ds);
    expect(req).toEqual({
      draft: { event: "contract.submitted", stages: [] },
      facts: { total_value: 1 },
      starter_user_id: "u9",
      decisions: [{ step_key: "s2", result: "approve", actor_user_id: "u1" }],
    });
    expect(buildRequest(src, {}, "").starter_user_id).toBeNull();
    expect("decisions" in toScenarioRequest(req)).toBe(false);
  });
  test("quyết định cùng bước thay quyết định cũ", () => {
    const a = decide([], "s2", "approve", null);
    expect(decide(a, "s2", "reject", "u1")).toEqual([
      { step_key: "s2", result: "reject", actor_user_id: "u1" },
    ]);
  });
});

const step = (p: Partial<PathStep>): PathStep => ({
  step_key: "k",
  name: "Bước",
  kind: "step",
  status: "done",
  reason: null,
  ...p,
});
const res = (path: PathStep[], over: Partial<PreviewResponse> = {}): PreviewResponse => ({
  event: "contract.submitted",
  path,
  status: "waiting",
  waiting_step: null,
  outcome: null,
  skipped: [],
  warnings: [],
  ...over,
});

describe("phản hồi ⇒ hàng hiển thị", () => {
  const waiting = step({
    step_key: "s3",
    name: "Kế toán duyệt",
    kind: "review",
    status: "waiting",
    review: {
      need: "one",
      group_name: "Phòng Kế toán",
      who: [
        { user_id: "a", name: "Lê Thị Hoa", via: "group" },
        { user_id: "b", name: "Phạm Dung", via: "group" },
      ],
      who_total: 3,
      evidence: "opinion_plus",
      due_h: 48,
      voters_n: null,
    },
  });
  const rows = rowsOf(
    res([
      step({
        step_key: "s1",
        name: "Trưởng phòng duyệt",
        kind: "review",
        decision: "approve",
        actor: { user_id: "x", name: "Phạm Cường" },
      }),
      step({
        step_key: "s2",
        name: "Nếu giá trị > 500 triệu",
        kind: "if",
        branch: "then",
        reason: "650.000.000 > 500.000.000",
      }),
      waiting,
      step({ step_key: "z", name: "Bỏ qua", status: "skipped" }),
    ]),
  );
  test("bước đã qua nói ai đóng vai và nhánh Đúng/Sai; bước bỏ qua không hiện", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]?.note).toBe("bạn đóng vai Phạm Cường · Duyệt");
    expect(rows[1]?.note).toBe("650.000.000 > 500.000.000 ⇒ Đúng");
  });
  test("bước chờ: người nhận lúc chạy thật + luật + hạn + cần nộp + người đóng vai", () => {
    const w = rows[2];
    expect(w?.state).toBe("waiting");
    expect(w?.holders).toBe("Lê Thị Hoa, Phạm Dung và 1 người khác");
    expect(w?.holdersRule).toBe("Phòng Kế toán, 1 người quyết là đủ. Hạn 48 giờ");
    expect(w?.needs).toContain("chữ ký");
    expect(w?.holderOptions.map((o) => o.value)).toEqual(["a", "b"]);
  });
  test("kết luận: chờ / dừng / kết thúc kèm kết quả", () => {
    expect(summaryOf({ status: "waiting", outcome: null }).tone).toBe("wait");
    expect(summaryOf({ status: "stopped", outcome: null }).tone).toBe("stop");
    const done = summaryOf({
      status: "finished",
      outcome: { key: "approved", label: "Đã duyệt", effect: "Hợp đồng có hiệu lực." },
    });
    expect(done.text).toBe("Kết thúc: Đã duyệt. Hợp đồng có hiệu lực.");
  });
  test("người đóng vai không có quyền ⇒ câu lý do", () => {
    const r = rowsOf(res([step({ can_act: false, decision: "approve" })]));
    expect(r[0]?.blocked).toContain("không có quyền");
  });
});

describe("cảnh báo + 4 trường hợp", () => {
  test("không cảnh báo ⇒ một dòng xanh; có ⇒ mỗi cảnh báo một dòng", () => {
    expect(warningRows([])).toEqual([
      { key: "ok", ok: true, text: "Không thấy vấn đề với hợp đồng thử này" },
    ]);
    const w = warningRows([
      { code: "group_single", step_key: "s3", message: "Ban Giám đốc chỉ có 1 người" },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]?.ok).toBe(false);
  });
  test("bốn trường hợp: nhãn + kết quả + số bước", () => {
    const fin = res([step({}), step({ kind: "end", name: "Kết thúc" })], {
      status: "finished",
      outcome: { key: "approved", label: "Đã duyệt", effect: "" },
    });
    const sc: ScenarioResponse = {
      event: null,
      scenarios: [
        { key: "approve_then", label: "650 tr · Duyệt hết", facts: {}, decisions: [], result: fin },
        {
          key: "reject",
          label: "Kế toán Từ chối",
          facts: {},
          decisions: [],
          result: res([step({})], { status: "stopped" }),
        },
      ],
    };
    const rows = scenarioRowsOf(sc);
    expect(rows[0]).toEqual({
      key: "approve_then",
      label: "650 tr · Duyệt hết",
      verdict: "Đã duyệt",
      steps: 2,
      tone: "ok",
    });
    expect(rows[1]?.verdict).toBe("Dừng");
  });
});
