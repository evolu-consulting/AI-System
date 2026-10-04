// HUB-FR-23 · H2a-R14 · unit `RoutingRunner` (plan H2a §5.4): `agentic-cli` → job runner, `dify-*` → dify runner.
import { describe, expect, it } from "bun:test";
import type { RunEvent } from "@ai/contracts/hub";
import type { AgentRunner, AgentTask } from "./job-agent-runner";
import { RoutingRunner } from "./routing-runner";

function fake(name: string, calls: string[]): AgentRunner {
  return {
    run: (): AsyncIterable<RunEvent> => {
      calls.push(name);
      // `for await` nhận cả iterable đồng bộ: mảng rỗng = runner không phát gì.
      return [] as unknown as AsyncIterable<RunEvent>;
    },
  };
}
const task = (runtime: string) =>
  ({ agent: { runtime }, stepId: "00000000-0000-4000-8000-000000000001" }) as unknown as AgentTask;
const signal = new AbortController().signal;

async function drain(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("RoutingRunner [HUB-FR-23 · H2a-R14]", () => {
  it("HUB-FR-23 · chọn runner theo agents.runtime", async () => {
    const calls: string[] = [];
    const r = new RoutingRunner({ job: fake("job", calls), dify: fake("dify", calls) });
    for (const rt of ["agentic-cli", "dify-workflow", "dify-agent"])
      await drain(r.run(task(rt), signal));
    expect(calls).toEqual(["job", "dify", "dify"]);
  });

  it("HUB-FR-23 · thiếu dify runner → job.failed NOT_CONFIGURED (job_id = id bước)", async () => {
    const r = new RoutingRunner({ job: fake("job", []) });
    const [ev] = await drain(r.run(task("dify-workflow"), signal));
    expect(ev).toMatchObject({
      type: "job.failed",
      code: "NOT_CONFIGURED",
      job_id: "00000000-0000-4000-8000-000000000001",
    });
  });
});
