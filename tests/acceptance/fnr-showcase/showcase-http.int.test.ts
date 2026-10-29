// CR-103 · fnr-fix-if2 · int: flow mẫu showcase chạy ĐÚNG đường HTTP của trang /processes/showcase (`POST /process-defs/:id/run`,
// cùng hình `inputs[]`), qua hai cổng duyệt song song ⇒ node If đọc input (number gửi dạng chuỗi, text dạng `text`) và rẽ đúng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildShowcaseDef } from "../../../tools/scripts/src/seed-flow-showcase.build";
import { type CtxPd, createDef, G1, type Json, startPd, waitStageStatus } from "../P-d/_support/pd";
import { settled } from "../P-d/d2/_d2";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

let defId = "";
async function startShowcase(inputs: Json[]): Promise<string> {
  if (!defId)
    defId = (
      await createDef(c, buildShowcaseDef({ legal: G1, accounting: G1, director: G1 }) as Json)
    ).id;
  const res = await c.call("Adm", "POST", `/process-defs/${defId}/run`, { input: "", inputs });
  expect(res.status).toBe(201);
  return res.json?.id as string;
}
async function passReviews(runId: string, idxs: number[]) {
  for (const i of idxs) {
    await waitStageStatus(c, runId, i, "waiting_review");
    const [t] = await c.sql<Json[]>`select t.id from hub.review_tasks t
      join hub.stage_runs s on s.id = t.stage_run_id
      where t.process_run_id = ${runId} and s.stage_idx = ${i} and t.kind = 'review' and t.status = 'open' limit 1`;
    const res = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
    expect(res.status).toBe(200);
    await settled(c);
  }
}
const status = async (runId: string, idx: number) =>
  (
    await c.sql<
      Json[]
    >`select status from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`
  )[0]?.status;

describe("CR-103 · showcase qua HTTP của trang", () => {
  const inputs = (amount: string, purpose: string): Json[] => [
    { type: "number", key: "amount", value: amount },
    { type: "text", key: "purpose", text: purpose },
  ];
  it("150.000.000 + mua sắm ⇒ Giám đốc duyệt chờ kiểm (nhánh Đúng), Hoàn tất chưa tới", async () => {
    const runId = await startShowcase(inputs("150000000", "mua sắm"));
    await passReviews(runId, [1, 2]);
    await waitStageStatus(c, runId, 4, "waiting_review");
    expect(await status(runId, 5)).toBe("pending"); // Hoàn tất chưa tới (không bị nhảy qua)
  }, 60_000);
  it('chuỗi NFD (trình duyệt) vẫn khớp "mua sắm" NFC', async () => {
    const runId = await startShowcase(inputs("150000000", "mua sắm".normalize("NFD")));
    await passReviews(runId, [1, 2]);
    await waitStageStatus(c, runId, 4, "waiting_review");
  }, 60_000);
  it("50.000.000 ⇒ Giám đốc duyệt bỏ qua, Hoàn tất xong", async () => {
    const runId = await startShowcase(inputs("50000000", "mua sắm"));
    await passReviews(runId, [1, 2]);
    await waitStageStatus(c, runId, 5, "done");
    expect(await status(runId, 4)).toBe("skipped");
  }, 60_000);
});
