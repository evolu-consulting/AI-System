// X1-AC06 · `applyDelta(state, delta)` (plan-frontend §1.1b, §1.3): 500 delta ≤ 40 ký tự khi step đang mở ⇒ nội dung nối
// đủ, đúng thứ tự, hiển thị ngay (không chờ `step.finished`). Nạp động (P7) ⇒ đỏ "Cannot find module" tới khi F2 xong.
import { describe, expect, it } from "bun:test";
import { DeltaDataSchema } from "@ai/contracts/chat";
import { type Loose, loadDelta, loadRunReducer } from "../_modules";

const N = 500;
const part = (i: number) => `[${String(i).padStart(3, "0")}] mảnh nội dung số ${i};`.slice(0, 40);

async function openStepState(): Promise<Loose> {
  const { createRunState } = await loadRunReducer();
  const s = createRunState({
    key: "k-x1",
    convId: "01900000-0000-7000-8000-0000000000c1",
    origin: "main",
    request: { content: "kể chuyện dài" },
  });
  return {
    ...s,
    runId: "01900000-0000-7000-8000-0000000000a1",
    phase: "streaming",
    steps: [{ id: "s1", label: "Đang soạn", status: "running", ms: null }],
  };
}

describe("X1-AC06 · applyDelta", () => {
  it("X1-AC06 · 500 delta ≤ 40 ký tự, step mở, không step.finished ⇒ text = nối đủ 500 phần đúng thứ tự", async () => {
    const { applyDelta } = await loadDelta();
    const start = await openStepState();
    const parts = Array.from({ length: N }, (_, i) => part(i));
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(40);
      expect(DeltaDataSchema.safeParse({ text: p }).success).toBe(true);
    }
    let s = start;
    const seen: number[] = [];
    for (const p of parts) {
      s = applyDelta(s, { text: p });
      seen.push(s.text.length);
    }
    expect(s.text).toBe(parts.join(""));
    // hiển thị tăng dần từng delta, không dồn tới step.finished
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1] as number);
    expect(s.steps).toEqual([{ id: "s1", label: "Đang soạn", status: "running", ms: null }]);
    expect(s.phase).toBe("streaming");
  });

  it("X1-AC06 · thuần: trả RunState mới, không sửa state đầu vào", async () => {
    const { applyDelta } = await loadDelta();
    const start = await openStepState();
    const snapshot = JSON.stringify(start);
    const next = applyDelta(start, { text: "abc" });
    expect(next).not.toBe(start);
    expect(next.text).toBe("abc");
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
