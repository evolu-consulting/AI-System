// HUB-FR-95 · HUB-BR-20 · AC-H22 · H2a-R21, R22 · test-plan H2a cases §5 S01: stack thật — agent `trello` (fake-cli) gọi
// tool `side_effect` `create-trello-card` qua `/mcp` Hub thật → Hub chặn (`CONFIRMATION_REQUIRED`), Runtime ép
// `need_input` → SSE `ask{choices:["Đồng ý","Huỷ"]}`, MK 0 lời gọi; "Đồng ý" → Orchestrator delegate lại → MK đúng 1 lời
// gọi; trace run 1 có `CONFIRMATION_REQUIRED`.
// Chạy: bun run test:h2a:stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insertConv, runIdOf, send } from "../../H1/_hub";
import { bootStackH2a, type StackH2a } from "./_stack";

const RT = "qc-h2a-stack-confirm";
const TASK =
  '#fake:delegate=trello #fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ A';
let s: StackH2a;
beforeAll(async () => {
  s = await bootStackH2a(RT);
  await s.runtime(`${RT}-1`, "fake-cli");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

describe("S01 · xác nhận side_effect qua stack thật [AC-H22]", () => {
  it("HUB-FR-95 · S01 · tool side_effect → ask{Đồng ý, Huỷ}, MK 0; 'Đồng ý' → delegate lại, MK đúng 1; trace run 1 CONFIRMATION_REQUIRED [AC-H22]", async () => {
    const conv = await insertConv(s.sql, "lan", "a2a30000-0000-4000-8000-000000000101");
    const token = await s.token("lan");
    const first = await send(s.hub, token, conv, TASK);
    expect(first.status).toBe(200);
    const flowId = first.headers.get("x-flow-id") ?? "";
    const run1 = runIdOf(first);
    const end1 = await first.terminal(60_000);
    first.close();
    expect(end1?.event).toBe("run.finished");
    const ask = first.events.find((e) => e.event === "ask");
    expect(ask?.data?.choices).toEqual(["Đồng ý", "Huỷ"]);
    expect(s.dify.runs().length).toBe(0);
    const steps = await s.sql<{ detail: unknown }[]>`select detail from hub.run_steps
      where run_id = ${run1} order by seq`;
    expect(JSON.stringify(steps.map((x) => x.detail))).toContain("CONFIRMATION_REQUIRED");

    const second = await send(s.hub, token, conv, "Đồng ý", flowId);
    expect(second.status).toBe(200);
    const end2 = await second.terminal(60_000);
    second.close();
    expect(end2?.event).toBe("run.finished");
    expect(second.events.some((e) => e.event === "ask")).toBe(false);
    expect(s.dify.runs().length).toBe(1);
    expect(s.dify.runs()[0]?.body).toMatchObject({ inputs: { title: "A" } });
  }, 180_000);
});
