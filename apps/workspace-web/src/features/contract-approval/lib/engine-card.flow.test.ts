// CR-122 · P11e · tái hiện e2e G1.2: công ty bật flow theo sự kiện, nhân viên bấm "Xác nhận và lưu" ⇒ thẻ trả `mode engine`, cấp 1,
// chưa run (`engine_run_id` null, FLOW_STARTING), chưa bước. Trước sửa: `engineAdvancing` = false ⇒ thẻ NGỪNG tải lại (trace: 0 GET
// sau xác nhận trong 45 s) ⇒ bước "Duyệt giá trị lớn" không bao giờ hiện. Gợi ý "bản nháp … Xác nhận và lưu" phải tắt sau khi gửi.
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { engineAdvancing, submittedForReview } from "./engine-card";

const card = (o: Partial<ContractApproval>): ContractApproval =>
  ({
    mode: "engine",
    run_id: "a1",
    engine_run_id: null,
    run_status: null,
    step: "level1",
    task_id: null,
    can_act: false,
    feedback: "FLOW_STARTING",
    block_reason: null,
    finalizes_on_approve: false,
    needs_reopen: false,
    attention: null,
    steps: [],
    ...o,
  }) as unknown as ContractApproval;
const step = (idx: number, status: string) =>
  ({ idx, key: `s${idx}`, name: `B${idx}`, kind: "review", status }) as never;

describe("P11e · thẻ sau 'Xác nhận và lưu' khi bật flow theo sự kiện", () => {
  test("chưa run, chưa bước, không attention ⇒ vẫn tải lại (đang mở quy trình)", () => {
    expect(engineAdvancing(card({}))).toBe(true);
  });
  test("run đã gắn, bước kế đang chờ ⇒ tải lại; bước mở ⇒ thôi", () => {
    expect(engineAdvancing(card({ engine_run_id: "r1", steps: [step(0, "running")] }))).toBe(true);
    expect(engineAdvancing(card({ engine_run_id: "r1", steps: [step(1, "open")] }))).toBe(false);
  });
  test("kẹt (attention) ⇒ không tải lại vô hạn", () => {
    expect(
      engineAdvancing(
        card({ attention: { kind: "stalled", reason: "FLOW_NOT_ASSIGNED" } as never }),
      ),
    ).toBe(false);
  });
  test("đã gửi (engine, bước soạn không mở) ⇒ hết là bản nháp; bước soạn s0 mở / máy cũ ⇒ còn nháp", () => {
    expect(submittedForReview(card({}))).toBe(true);
    expect(submittedForReview(card({ steps: [step(0, "open")] }))).toBe(false);
    expect(submittedForReview(card({ mode: "machine" } as never))).toBe(false);
  });
});
