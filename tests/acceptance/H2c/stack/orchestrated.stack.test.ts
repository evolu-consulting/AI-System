// AC-H03 · WRK-FR-11 · HUB-H2c-AC-07 · H2c-R15 · P11 · L5 · test-plan-py §3 S06: stack thật — `lan` tải `hoadon.pdf`, gửi tin
// không tag kèm file → Orchestrator (`fake-cli`) thấy danh sách file trong `<attachments>` (B6) và delegate `hoadon` (một delegate
// — L5) → job `hoadon` có `payload.attachments`, Runtime tải file (PY-02) → `#fake:files` (PY-04) trả `hoadon.pdf:<sha đúng>`
// → run `finished`; SSE `step.started` có nhãn.
// Chạy: bun run test:h2c:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { agentResultOf, endOf, settleStack } from "../../H2b/stack/_stack";
import { sample } from "../_h2c";
import { orchBlock } from "../_h2c2";
import { agentJob, bootStackH2c, filesLines, runWith, type StackH2c, up } from "./_stack";

const RT = "qc-h2c-stack-orchestrated";
let st: StackH2c;
beforeAll(async () => {
  st = await bootStackH2c(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

describe("S06 · Orchestrator thấy file, delegate agent đọc file [AC-H03 · HUB-H2c-AC-07]", () => {
  it("AC-H03 · S06 · hoadon.pdf + '#fake:delegate=hoadon #fake:files kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai' → payload Orchestrator có <attachments> '- hoadon.pdf (application/pdf, 4 KB)'; delegate(hoadon) → 'hoadon.pdf:<sha>'; run finished; step.started có nhãn [HUB-H2c-AC-07 · H2c-R15 · L5]", async () => {
    const f = await up(st, "hoadon.pdf", sample.pdf(4096));
    const x = await runWith(
      st,
      "#fake:delegate=hoadon #fake:files kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai",
      [f.id],
    );
    await endOf(x);
    const orch = await agentJob(st, x.runId, "orchestrator", "role");
    expect(orch?.payload?.prompt).toContain(
      orchBlock([{ name: "hoadon.pdf", mime: "application/pdf", size: 4096 }]),
    );
    const h = await agentJob(st, x.runId, "hoadon");
    expect(h?.payload?.attachments?.map((a: { name: string }) => a.name)).toEqual(["hoadon.pdf"]);
    expect((await agentResultOf(st, x.runId, "hoadon"))?.text).toBe(filesLines([f]));
    const started = x.s.events.filter((e) => e.event === "step.started");
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started.every((e) => typeof e.data?.label === "string" && e.data.label.length > 0)).toBe(
      true,
    );
  }, 120_000);
});
