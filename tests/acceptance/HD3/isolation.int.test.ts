// HD-FR-32 · HD-FR-34 · AC32b · AC34c · AC34f · AC34g · D3-03: cách ly tenant + quyền của flow duyệt — id HĐ tenant khác ⇒ 404
// (như không có), không vai gói ⇒ 403, tool gói chỉ chạm HĐ mà `run_id` = run đang gọi (def tự dựng dùng tool `contracts-finalize`
// không "Đã duyệt" được HĐ tuỳ ý), def `contracts-approval` của acme không chạy được từ beta.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract } from "../HD1/_support/hd1";
import { createDef, defBody, PA, startRun } from "../P-d/_support/pd";
import { toolStage } from "../P-d/d2/_d2";
import {
  act,
  approval,
  C1_TEXT,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
  errCode,
  seedContract,
  settled,
  startHd3,
  T,
  toLevel1,
} from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("AC34c · tenant khác / không vai", () => {
  it("HĐ beta: GET/POST approval + /extract từ A (acme) ⇒ 404; X (không vai gói) ⇒ 403", async () => {
    await insContract(c.sql, {
      id: cid(50),
      tenant: T.beta,
      status: "extract_failed",
      source: C1_TEXT,
      createdBy: PA.D.id,
    } as never);
    for (const r of [
      await approval(c, "A", cid(50)),
      await act(c, "A", cid(50), "approve"),
      await c.call("A", "POST", `${CBASE}/${cid(50)}/extract`),
    ])
      expect(r.status).toBe(404);
    const id = await seedContract(c, 51);
    expect((await approval(c, "X", id)).status).toBe(403);
    expect((await act(c, "X", id, "approve")).status).toBe(403);
    expect((await contractRow(c, cid(50))).run_id).toBeNull();
  }, 60_000);

  it("AC34g · beta không chạy được def `contracts-approval` của acme ⇒ 404 PROCESS_NOT_FOUND", async () => {
    const id = await seedContract(c, 52);
    await toLevel1(c, id, 1); // acme đã có def (gói tự dựng)
    const r = await c.call("D", "POST", "/process-runs", {
      process_key: "contracts-approval",
      input: "x",
      origin: { kind: "none" },
    });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 404,
      code: "PROCESS_NOT_FOUND",
    });
  }, 60_000);
});

describe("AC32b · AC34f · tool gói chỉ chạm HĐ của run gọi [D3-03]", () => {
  it("def tự dựng gọi `contracts-finalize` cho HĐ needs_review của run khác ⇒ tool_failed, HĐ không đổi", async () => {
    const id = await seedContract(c, 53);
    await toLevel1(c, id, 245_000_000);
    const before = await contractRow(c, id);
    const d = await createDef(
      c,
      defBody(
        "hd3-hijack",
        [
          toolStage({
            key: "s0",
            step: 0,
            tool_key: "contracts-finalize",
            args: { contract_id: { from: "input", key: "hd" } },
            fields: [],
          }),
        ],
        { inputs: [{ key: "hd", type: "text", label: "HĐ", required: true }] },
      ),
    );
    const runId = await startRun(c, d.key, { inputs: [{ key: "hd", type: "text", text: id }] });
    await settled(c);
    // Lỗi tool (không side_effect) ⇒ engine hẹn thử lại / quyết (P-d2) — không bao giờ `done`; HĐ không đổi; audit failed.
    const [a] = await c.sql<
      { status: string }[]
    >`select summary->>'status' as status from hub.audit_log
      where action = 'tool_call' and entity_id = ${runId}`;
    expect(a?.status).toBe("failed");
    expect(
      (
        await c.sql<{ s: string }[]>`select status as s from hub.process_runs where id = ${runId}`
      )[0]?.s,
    ).not.toBe("done");
    expect(await contractRow(c, id)).toEqual(before);
  }, 60_000);
});
