// fix-ai-unready · AI chưa sẵn sàng ⇒ lượt đọc đóng NGAY `extract_failed AGENT_UNAVAILABLE`, không chờ vòng quét STALE. Không DB.
import { describe, expect, it } from "bun:test";
import { unavailableAgent } from "../adapters/ai-unavailable";
import { createExtractionVerifier } from "../adapters/extraction-verifier";
import { extractJobs } from "../extraction.mount";
import { handleExtractJob } from "./extract-job.usecase";
import { createRunExtraction } from "./run-extraction.usecase";

const who = { tenantId: "t", userId: "u" };

function fake() {
  const log: string[] = [];
  const row = { status: "draft", extractState: "reading" };
  const repo = {
    source: async () => ({
      ...row,
      version: 1,
      kind: "contract",
      text: "Bên bán: Công ty A",
      file: null,
      parent: null,
      items: [],
      fields: {},
    }),
    saveFailure: async (_id: string, code: string) => {
      log.push(`fail:${code}`);
      row.extractState = "failed";
      return true;
    },
  };
  const approval = {
    markStarted: async () => void log.push("started"),
    afterExtraction: async () => void log.push("closed"),
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
      fn({ extraction: repo, approval, outbox: { enqueue: async () => {} } }),
  };
  return { uow: uow as never, log, row };
}

describe("AI chưa sẵn sàng", () => {
  it("enqueue khi ready=false ⇒ HĐ sang failed AGENT_UNAVAILABLE ngay, lượt đọc đóng (không chờ STALE)", async () => {
    const f = fake();
    const run = createRunExtraction({
      uow: f.uow,
      agent: unavailableAgent,
      verifier: createExtractionVerifier(),
      tax: null,
    });
    const down = handleExtractJob({ run, uow: f.uow });
    const never = async () => {
      throw new Error("không được chạy job thật");
    };
    const { jobs } = extractJobs({} as never, {} as never, never, {
      concurrency: 1,
      ready: false,
      down,
    });
    await jobs.enqueue({ ...who, contractId: "c", approvalId: "a" });
    expect(f.row.extractState).toBe("failed");
    expect(f.log).toEqual(["started", "fail:AGENT_UNAVAILABLE", "closed"]);
  });
});
