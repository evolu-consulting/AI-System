// HUB-FR-12 · HUB-H2c-AC-10 · H2c-R20, R21 · P13 · test-plan-py §3 S05: stack thật — `/hoadon-async` + `hoadon.pdf`: Hub (host)
// upload file lên Dify (MK `/v1/files/upload`) **trước** khi enqueue job `workflow.async` (B7) → Runtime (container, provider
// `dify`) gọi `/v1/workflows/run` với `inputs.file = {type:"document", transfer_method:"local_file", upload_file_id}` nguyên văn
// (F12, không tự upload) → run `finished`. `base_url` của `hoadon-file` = IP host (Lệch S05, đầu `_stack.ts`).
// Chạy: bun run test:h2c:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Json } from "../../H1/_fixtures";
import { endOf, settleStack } from "../../H2b/stack/_stack";
import { sample } from "../_h2c";
import { uploadsOf } from "../_h2c2";
import { bootStackH2c, runWith, type StackH2c, up } from "./_stack";

const RT = "qc-h2c-stack-async-file";
let st: StackH2c;
beforeAll(async () => {
  st = await bootStackH2c(RT, {}, "fake-cli,dify");
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

describe("S05 · lệnh async có file end-to-end [HUB-H2c-AC-10 · P13]", () => {
  it("HUB-FR-12 · S05 · '/hoadon-async' + hoadon.pdf → MK đúng 1 /v1/files/upload (Hub, trước jobs.created_at); /v1/workflows/run inputs.file.upload_file_id = id upload; run finished [HUB-H2c-AC-10 · H2c-R21]", async () => {
    st.dify.mock.reset();
    const f = await up(st, "hoadon.pdf", sample.pdf(4096));
    const x = await runWith(st, "/hoadon-async ghi chú S05", [f.id]);
    await endOf(x);
    const ups = uploadsOf(st.dify, "hoadon.pdf");
    expect(ups).toHaveLength(1);
    const [job] = await st.sql<{ created_at: Date; type: string }[]>`select created_at, type
      from hub.jobs where run_id = ${x.runId}`;
    expect(job?.type).toBe("workflow.async");
    expect(ups[0]?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(job?.created_at.getTime() ?? 0);
    const runs = st.dify.runs().filter((c) => c.path === "/v1/workflows/run");
    expect(runs).toHaveLength(1);
    expect((runs[0]?.body as Json)?.inputs?.file).toEqual({
      type: "document",
      transfer_method: "local_file",
      upload_file_id: "upl-1",
    });
  }, 120_000);
});
