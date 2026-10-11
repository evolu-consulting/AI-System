// P-b · PF-S2 · PB-R16 · D9 · CA-04 (test-plan §4.2, C22): biến thể stack RUNTIME_SOURCE_CACHE_MAX_MB=4 (container Runtime riêng).
// Snapshot của run đang mở (hub.runs.status='running') KHÔNG bị LRU xoá dù áp lực dung lượng và repo gốc đã biến mất.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  bootPb,
  bulkScript,
  gitPin,
  must,
  openRun,
  type PbStack,
  parseReads,
  revParse,
  runStage,
} from "../_support/pb-stack";

let st: PbStack;
beforeAll(async () => {
  st = await bootPb("lru", { cacheMaxMb: 4 });
  must(st.sh(bulkScript("med-a", { randomBytes: 3_000_000 })), "dựng med-a");
  must(st.sh(bulkScript("med-b", { randomBytes: 3_000_000 })), "dựng med-b");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});

const BLOB = (k: string) => `sources/${k}/data/blob.bin`;

describe("CA-04 · LRU không xoá snapshot run đang mở [PB-R16 · D9]", () => {
  it("PB-R16 · CA-04 · run A mở (med-a 3 MB), xoá repo med-a, run B (med-b 3 MB) ⇒ snapshot A không bị LRU xoá: stage kế của A vẫn đọc được", async () => {
    const pinA = gitPin("med-a", revParse(st, "med-a"));
    const srcA = { key: "med-a", pin: pinA, allowlist: [] as string[] };
    const runA = await openRun(st, "A");
    const first = await runStage(st, {
      prompt: `#fake:read=${BLOB("med-a")}`,
      sources: [srcA],
      run: runA,
    });
    const shaA = parseReads(first.text)[BLOB("med-a")];
    expect(shaA).toMatch(/^[0-9a-f]{64}$/);
    must(st.sh("rm -rf /fixtures/med-a.git"), "xoá repo med-a");
    const srcB = {
      key: "med-b",
      pin: gitPin("med-b", revParse(st, "med-b")),
      allowlist: [] as string[],
    };
    const b = await runStage(st, { prompt: `#fake:read=${BLOB("med-b")}`, sources: [srcB] });
    expect(parseReads(b.text)[BLOB("med-b")]).toMatch(/^[0-9a-f]{64}$/);
    const again = await runStage(st, {
      prompt: `#fake:read=${BLOB("med-a")}`,
      sources: [srcA],
      run: runA,
    });
    expect(again.status).toBe("succeeded");
    expect(parseReads(again.text)[BLOB("med-a")]).toBe(shaA);
  });
});
