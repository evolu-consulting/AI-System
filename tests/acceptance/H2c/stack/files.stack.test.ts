// WRK-FR-11 · WRK-BR-07 · HUB-H2c-AC-07 · H2c-R14, R16, R18, R19 · test-plan-py §3 S01, S02, S07: stack thật — `lan` tải file
// lên Hub (B2), gửi `@assistant #fake:files` kèm `attachment_ids` (B4) → payload job agent có `attachments` + khối file trong
// `prompt` (B6) → Runtime tải qua `GET /internal/jobs/:id/attachments/:att` (B5, PY-02) → `fake-cli` trả `<tên>:<sha>` (PY-04);
// job sau trong cùng flow không đọc được file của job trước qua `../<job_id>/` (hook `other_job`) nhưng có lại file của flow (R14).
// Chạy: bun run test:h2c:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { endOf, settleStack } from "../../H2b/stack/_stack";
import { sample } from "../_h2c";
import { agentBlock } from "../_h2c2";
import {
  agentJob,
  assistantMsg,
  bootStackH2c,
  filesLines,
  runWith,
  type StackH2c,
  up,
  workFiles,
} from "./_stack";

const RT = "qc-h2c-stack-files";
let st: StackH2c;
beforeAll(async () => {
  st = await bootStackH2c(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

describe("S01 · agent đọc file đính kèm end-to-end [HUB-H2c-AC-07 · H2c-R16]", () => {
  it("WRK-FR-11 · S01 · lan tải a.pdf + b.md → '@assistant #fake:files' + ids → content = 'a.pdf:<sha>\\nb.md:<sha>' (sha của Hub); jobs.payload.prompt có khối file [HUB-H2c-AC-07 · H2c-R19]", async () => {
    const a = await up(st, "a.pdf", sample.pdf(3000));
    const b = await up(st, "b.md", sample.md(500));
    const x = await runWith(st, "@assistant #fake:files S01", [a.id, b.id]);
    await endOf(x);
    expect((await assistantMsg(st, x))?.content).toBe(filesLines([a, b]));
    const job = await agentJob(st, x.runId, "assistant");
    expect(job?.payload?.prompt).toContain(
      agentBlock([
        { name: "a.pdf", mime: "application/pdf", size: 3000 },
        { name: "b.md", mime: "text/markdown", size: 500 },
      ]),
    );
    expect(workFiles(st, job?.id ?? "", "attachments")).toEqual(["a.pdf", "b.md"]);
  }, 120_000);
});

describe("S02 · job sau không đọc được file job trước [HUB-H2c-AC-07 · WRK-BR-07 · H2c-R18]", () => {
  it("WRK-BR-07 · S02 · run 1 '#fake:files' (a.pdf) → run 2 cùng flow '#fake:read=../<job run 1>/attachments/a.pdf' → 'denied'; run 3 '#fake:read=attachments/a.pdf' → 'read: 3000 chars' (file của flow, R14) [HUB-H2c-AC-07 · H2c-R14]", async () => {
    const a = await up(st, "a.pdf", sample.pdf(3000));
    const r1 = await runWith(st, "@assistant #fake:files S02", [a.id]);
    await endOf(r1);
    expect((await assistantMsg(st, r1))?.content).toBe(filesLines([a]));
    const j1 = await agentJob(st, r1.runId, "assistant");
    expect(workFiles(st, j1?.id ?? "", "attachments")).toEqual(["a.pdf"]);
    const flow = { conv: r1.conv, flowId: r1.flowId };
    const r2 = await runWith(
      st,
      `@assistant #fake:read=../${j1?.id}/attachments/a.pdf S02`,
      undefined,
      flow,
    );
    await endOf(r2);
    expect((await assistantMsg(st, r2))?.content).toBe("denied");
    const r3 = await runWith(st, "@assistant #fake:read=attachments/a.pdf S02", undefined, flow);
    await endOf(r3);
    const j3 = await agentJob(st, r3.runId, "assistant");
    expect(j3?.payload?.attachments?.map((f: { name: string }) => f.name)).toEqual(["a.pdf"]);
    expect((await assistantMsg(st, r3))?.content).toBe("read: 3000 chars");
  }, 180_000);
});

describe("S07 · tin sau cùng flow tải lại file [H2c-R18 · H2c-R14]", () => {
  it("WRK-FR-11 · S07 · tin 2 cùng flow (không file mới) '@assistant #fake:files' → job mới tải lại A vào work/<job mới>/attachments, content đúng sha [H2c-R18]", async () => {
    const a = await up(st, "a.pdf", sample.pdf(2048));
    const r1 = await runWith(st, "@assistant #fake:files S07", [a.id]);
    await endOf(r1);
    const r2 = await runWith(st, "@assistant #fake:files S07 lần 2", undefined, {
      conv: r1.conv,
      flowId: r1.flowId,
    });
    await endOf(r2);
    const j1 = await agentJob(st, r1.runId, "assistant");
    const j2 = await agentJob(st, r2.runId, "assistant");
    expect(j2?.id).not.toBe(j1?.id);
    expect(workFiles(st, j2?.id ?? "", "attachments")).toEqual(["a.pdf"]);
    expect((await assistantMsg(st, r2))?.content).toBe(filesLines([a]));
  }, 180_000);
});
