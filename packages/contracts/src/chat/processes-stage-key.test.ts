// HUB-FR-105 · HUB-FR-113 · TECH-DEBT #150: view run nhận stage key 1–32 ký tự như phía ghi (STAGE_KEY_RE {1,32});
// key process vẫn ≥ 2. Không đổi phía ghi.
import { describe, expect, test } from "bun:test";
import { STAGE_KEY_RE } from "../hub-admin/processes";
import { ProcessKeySchema, ProcessRunFullViewSchema, StageViewSchema } from "./index";

const U = (n: number) => `b2b20000-0000-4000-8000-${String(900_000 + n).padStart(12, "0")}`;
const AT = "2026-10-13T01:00:00.000Z";
const user = { id: U(1), display_name: "Hoa" };

const stage = (key: string) => ({
  idx: 0,
  key,
  name: "Phân tích",
  executor: { kind: "agent", key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } },
  after: "review",
  real_action: false,
  status: "waiting_review",
  attempt: 1,
  attempt_limit: 4,
  asks_count: 0,
  ask_limit: 3,
  outputs: [],
  current_output_id: null,
  passed_by: null,
  passed_at: null,
  step: 0,
  round: 1,
  back_to_steps: [],
});

const fullView = (stageKey: string, processKey = "sdlc") => ({
  id: U(10),
  process: { key: processKey, name: "Quy trình", version: 1 },
  status: "running",
  current_stage_idx: 0,
  stage_count: 1,
  started_by: user,
  origin: { kind: "admin" },
  started_at: AT,
  updated_at: AT,
  finished_at: null,
  current_step: 0,
  step_count: 1,
  access: "full",
  input: "HD-12",
  stages: [stage(stageKey)],
  history: [],
  decision: null,
  my_tasks: [],
  open_tasks: [],
  thread: null,
  can_cancel: true,
  back_rounds: 0,
  back_limit: 3,
  back_events: [],
});

describe("TD #150 · stage key ở view run", () => {
  test("HUB-FR-113 · TD150-01 · ProcessRunFullViewSchema nhận stage key 'a' (1 ký tự)", () => {
    expect(ProcessRunFullViewSchema.safeParse(fullView("a")).success).toBe(true);
  });

  test("HUB-FR-113 · TD150-02 · StageViewSchema nhận key 1 và 32 ký tự; 33 ký tự, hoa, rỗng bị từ chối", () => {
    const r = (k: string) => StageViewSchema.safeParse(stage(k)).success;
    expect({
      one: r("a"),
      max: r("a".repeat(32)),
      over: r("a".repeat(33)),
      upper: r("A"),
      empty: r(""),
    }).toEqual({ one: true, max: true, over: false, upper: false, empty: false });
  });

  test("HUB-FR-113 · TD150-03 · view run: stage key 33 ký tự ⇒ từ chối (không nới quá phía ghi)", () => {
    expect(ProcessRunFullViewSchema.safeParse(fullView("a".repeat(33))).success).toBe(false);
  });

  test("HUB-FR-105 · TD150-04 · key process vẫn ≥ 2: 'a' bị từ chối ở ProcessKeySchema và process.key của view run", () => {
    expect(ProcessKeySchema.safeParse("a").success).toBe(false);
    expect(ProcessKeySchema.safeParse("ab").success).toBe(true);
    expect(ProcessRunFullViewSchema.safeParse(fullView("a", "a")).success).toBe(false);
  });

  test("HUB-FR-105 · TD150-05 · phía ghi không đổi: STAGE_KEY_RE nhận 1–32 ký tự", () => {
    expect([
      STAGE_KEY_RE.test("a"),
      STAGE_KEY_RE.test("a".repeat(32)),
      STAGE_KEY_RE.test("a".repeat(33)),
    ]).toEqual([true, true, false]);
  });
});
