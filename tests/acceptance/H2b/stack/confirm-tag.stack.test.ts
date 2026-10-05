// HUB-FR-95 · HUB-BR-20 · AC-H22 (vế `@`) · H2b-R12 · TD #47 · test-plan-py §3 S05: stack thật — `@trello` (run
// `direct`, agent `trello` fake-cli) gọi tool `side_effect` `create-trello-card` qua `/mcp` Hub thật → `ask`, MK 0.
// "Đồng ý" không tag → Orchestrator delegate lại `trello` theo tag tin trước (PY-04 + B8) → MK +1, đúng 1 job `trello`;
// "@trello Đồng ý" cùng flow → MK +1 (R12); "@helper Đồng ý" (tag khác) → MK không đổi.
// Chạy: bun run test:h2b:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { jobsOf } from "../_h2b";
import { bootStackH2b, endOf, type StackH2b, settleStack, stackRun } from "./_stack";

const RT = "qc-h2b-stack-confirm";
const TASK = '@trello #fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ';
let st: StackH2b;
beforeAll(async () => {
  st = await bootStackH2b(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

/** Tin đầu `@trello …` trong flow mới → `ask{Đồng ý, Huỷ}`, MK không đổi. */
async function askFirst(label: string) {
  const before = st.dify.runs().length;
  const x = await stackRun(st, `${TASK} ${label}`);
  await endOf(x);
  const ask = x.s.events.find((e) => e.event === "ask");
  expect(ask?.data?.choices).toEqual(["Đồng ý", "Huỷ"]);
  expect(st.dify.runs().length).toBe(before);
  return x;
}

describe("S05 · xác nhận side_effect sau run `@trello` [AC-H22 · H2b-R12]", () => {
  it("HUB-FR-95 · S05 · '@trello … Tạo thẻ' → ask, MK 0; 'Đồng ý' → Orchestrator delegate lại trello (tag tin trước) → MK 1, đúng 1 job trello, run.finished [AC-H22 · H2b-R12]", async () => {
    const first = await askFirst("S05a");
    const before = st.dify.runs().length;
    const second = await stackRun(st, "Đồng ý", { conv: first.conv, flowId: first.flowId });
    await endOf(second);
    expect(second.s.events.some((e) => e.event === "ask")).toBe(false);
    expect(st.dify.runs().length).toBe(before + 1);
    expect(st.dify.runs().at(-1)?.body).toMatchObject({ inputs: { title: "A" } });
    const jobs = await jobsOf(st.sql, second.runId);
    expect(jobs.filter((j) => j.key === "trello").length).toBe(1);
  }, 180_000);

  it("HUB-FR-95 · S05 · flow mới '@trello … Tạo thẻ' → ask → '@trello Đồng ý' cùng flow → MK 1 [AC-H22 · H2b-R12]", async () => {
    const first = await askFirst("S05b");
    const before = st.dify.runs().length;
    const second = await stackRun(st, "@trello Đồng ý", {
      conv: first.conv,
      flowId: first.flowId,
    });
    await endOf(second);
    expect(st.dify.runs().length).toBe(before + 1);
  }, 180_000);

  it("HUB-FR-95 · S05 · flow mới '@trello … Tạo thẻ' → ask → '@helper Đồng ý' (tag khác) → MK 0 [AC-H22 · H2b-R12]", async () => {
    const first = await askFirst("S05c");
    const before = st.dify.runs().length;
    const second = await stackRun(st, "@helper Đồng ý", {
      conv: first.conv,
      flowId: first.flowId,
    });
    await endOf(second);
    expect(st.dify.runs().length).toBe(before);
  }, 180_000);
});
