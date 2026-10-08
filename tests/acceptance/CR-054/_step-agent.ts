// CR-054 · đổi C1-R04: `step.started` được mang `agent` = {key, name, model} (tên agent trả lời + model ở "Quá trình").
// Test chống lộ cũ (H1/H2b) dùng hàm này: kiểm đúng hình dạng rồi bỏ `agent` — luật cũ áp nguyên cho phần còn lại
// (provider/workflow/usage vẫn không bao giờ ra SSE).
import { expect } from "bun:test";
import type { SseEv } from "../H1/_hub";

export function stripStepAgent(events: SseEv[]): SseEv[] {
  return events.map((e) => {
    if (e.event !== "step.started" || !e.data || !("agent" in e.data)) return e;
    const { agent, ...data } = e.data;
    expect(Object.keys(agent ?? {}).sort()).toEqual(["key", "model", "name"]);
    return { ...e, data };
  });
}
