// CR-121 · R-4 · unit: nguồn gắn lượt (`pack_key`/`pack_record_id` → `source`).
import { describe, expect, it } from "bun:test";
import { sourceOf, toRunDetail } from "./run-detail.map";
import type { HeadRow, StageRow } from "./run-detail.repo";

const ID = "0f1e2d3c-4b5a-4968-8777-665544332211";

describe("sourceOf", () => {
  it("gói hợp đồng ⇒ kind contract + nhãn HĐ + app_key", () => {
    expect(sourceOf("contracts", ID)).toEqual({
      kind: "contract",
      id: ID,
      label: "HĐ 0f1e2d3c",
      app_key: "contracts",
    });
  });
  it("có nhãn thật từ gói ⇒ dùng nhãn đó", () => {
    expect(sourceOf("contracts", ID, "HĐ 01/2026 · Thuê kho")?.label).toBe("HĐ 01/2026 · Thuê kho");
  });
  it("gói khác ⇒ kind = khoá gói", () => {
    expect(sourceOf("pkdemo", ID)?.kind).toBe("pkdemo");
  });
  it("không gắn gói ⇒ null", () => {
    expect(sourceOf(null, null)).toBeNull();
    expect(sourceOf("contracts", null)).toBeNull();
  });
});

describe("toRunDetail · cảnh báo bước Thông báo (CR-121 D-6b)", () => {
  const head = {
    id: ID,
    tenant_id: ID,
    snapshot: {
      key: "k",
      name: "Q",
      stages: [{ name: "Báo", step: 0, executor: { kind: "notify" } }],
    },
    def_version: 1,
    origin_kind: "manual",
    status: "done",
    decision_reason: null,
    current_step: 0,
    current_stage_idx: 0,
    started_at: "2026-11-05T01:00:00.000Z",
    finished_at: "2026-11-05T01:00:01.000Z",
    is_test: false,
    started_by: null,
    pack_key: null,
    pack_record_id: null,
    rerun_by: null,
  } as unknown as HeadRow;
  const stage = (warn: boolean) =>
    ({
      stage_idx: 0,
      status: "done",
      attempt: 1,
      attempt_limit: 1,
      round: 1,
      retry_count: 0,
      last_error_code: null,
      started_at: "2026-11-05T01:00:00.000Z",
      finished_at: "2026-11-05T01:00:01.000Z",
      updated_at: "2026-11-05T01:00:01.000Z",
      duration_ms: 1000,
      exec_vi: null,
      exec_en: null,
      warn_no_recipient: warn,
    }) as StageRow;
  it("không có người nhận thì step.warning là NOTIFY_NO_RECIPIENT, có người nhận thì không có cờ", () => {
    expect(toRunDetail(head, [stage(true)], []).steps[0]?.warning).toBe("NOTIFY_NO_RECIPIENT");
    expect(toRunDetail(head, [stage(false)], []).steps[0]?.warning).toBeUndefined();
  });
});
