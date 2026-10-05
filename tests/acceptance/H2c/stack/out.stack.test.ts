// WRK-FR-18 · HUB-H2c-AC-12 · H2c-R24, R25, R26 · test-plan-py §3 S03, S04: stack thật — `fake-cli` ghi `out/` (PY-04) → Runtime
// `POST /internal/jobs/:id/outputs` trước `FinishTx` (PY-03) → Hub lưu hàng `origin='output'` (B9) → `bindOutputs` gắn vào tin
// assistant khi run `finished` (R26); tải lại lịch sử thấy `attachments`, `/content` đúng byte. File bị Hub từ chối (`.exe`,
// `bad.pdf` sai chữ ký — L7) / symlink ⇒ bỏ, run vẫn `finished`. Run huỷ ⇒ không output nào gắn tin.
// Chạy: bun run test:h2c:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { call, type Json } from "../../H1/_fixtures";
import { endOf, settleStack } from "../../H2b/stack/_stack";
import {
  assistantMsg,
  bootStackH2c,
  contentOf,
  runningJob,
  runWith,
  type StackH2c,
} from "./_stack";

const RT = "qc-h2c-stack-out";
let st: StackH2c;
beforeAll(async () => {
  st = await bootStackH2c(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

const names = (m: Json): string[] => (m?.attachments ?? []).map((a: Json) => a.filename);

describe("S03 · file out/ thành file đính kèm tin trả lời [HUB-H2c-AC-12 · H2c-R25 · H2c-R26]", () => {
  it("WRK-FR-18 · S03 · '@assistant #fake:out=report.md' → run.finished; tải lại lịch sử: tin assistant attachments=[report.md, text/markdown, available]; /content = 'fake output report.md\\n' [HUB-H2c-AC-12 · H2c-R26]", async () => {
    const x = await runWith(st, "@assistant #fake:out=report.md S03");
    await endOf(x);
    const msg = await assistantMsg(st, x);
    expect(msg?.attachments).toHaveLength(1);
    expect(msg?.attachments?.[0]).toMatchObject({
      filename: "report.md",
      mime: "text/markdown",
      available: true,
    });
    const c = await contentOf(st, msg?.attachments?.[0]?.id);
    expect(c).toEqual({ status: 200, text: "fake output report.md\n" });
  }, 120_000);

  it("WRK-FR-18 · S03 · '#fake:out=a.exe,bad.pdf,b.md' → chỉ b.md gắn (Hub 415 a.exe, bad.pdf sai chữ ký — L7), run finished [HUB-H2c-AC-12]", async () => {
    const x = await runWith(st, "@assistant #fake:out=a.exe,bad.pdf,b.md S03");
    await endOf(x);
    expect(names(await assistantMsg(st, x))).toEqual(["b.md"]);
  }, 120_000);

  it("WRK-FR-18 · S03 · '#fake:out-link=x.md' → symlink bị bỏ: tin assistant không khoá attachments [HUB-H2c-AC-12]", async () => {
    const x = await runWith(st, "@assistant #fake:out-link=x.md S03");
    await endOf(x);
    const msg = await assistantMsg(st, x);
    expect(msg?.content).toBeDefined();
    expect(msg && "attachments" in msg).toBe(false);
  }, 120_000);
});

describe("S04 · run huỷ không gắn output [H2c-R26]", () => {
  it("WRK-FR-18 · S04 · '@assistant #fake:out=r.md #fake:sleep=10' → huỷ → run.failed CANCELLED; 0 hàng origin='output' có message_id [H2c-R26 · PL10]", async () => {
    const x = await runWith(st, "@assistant #fake:out=r.md #fake:sleep=10 S04");
    const jobId = await runningJob(st, x.runId, "assistant");
    const cancel = await call(st.hub, "POST", `/runs/${x.runId}/cancel`, {
      token: await st.token("lan"),
    });
    expect(cancel.status).toBeLessThan(300);
    const data = await endOf(x, "run.failed");
    expect(data?.code).toBe("CANCELLED");
    const [row] = await st.sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
      where origin = 'output' and job_id = ${jobId} and message_id is not null`;
    expect(row?.n).toBe(0);
  }, 120_000);
});
