// CR-107 (eng-links-race) · đua Đạt duyệt cuối: hai người (H, B) cùng bấm Đạt bước cuối với SP KHÁC nhau, hai kết nối thật
// (Promise.all). Cổng engine thật, chỉ `act` bị chặn bằng tín hiệu (không ngủ): người tới `act` trước thắng ("ok"), người sau
// nhận "not_open" như engine thật. Sau đó người thắng Đạt THẬT trên engine ⇒ `contracts-finalize` áp `pending_links`.
// Kỳ vọng: HĐ active, item gắn đúng SP của người thắng; lỗi của người thua KHÔNG xoá SP của người thắng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { urls } from "@ai/test-kit/env";
import { approvalEngineRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-engine.repo";
import type { ApprovalState } from "../../../apps/hub-api/src/modules/packs/contracts/application/approval.ports";
import type { ApprovalEnginePort } from "../../../apps/hub-api/src/modules/packs/contracts/application/approval-engine.ports";
import {
  type EngineActResult,
  type EngineCardDeps,
  engineAct,
} from "../../../apps/hub-api/src/modules/packs/contracts/application/approval-engine-card.usecase";
import { createPackUow } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { insItem } from "../HD1/_support/hd1";
import { contractRow, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
let db: Db;
beforeAll(async () => {
  c = await startCf();
  db = createDb(urls().hubApi, { max: 4 });
}, 180_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

type Gate = {
  first: string | null;
  arrived: Map<string, () => void>;
  done: Map<string, Promise<unknown>>;
};

/** Cổng engine thật, riêng `act` chặn: người tới trước chờ người kia tới `act` HOẶC kết thúc (bị chặn trước `act`) rồi thắng. */
function gatedPort(g: Gate): ApprovalEnginePort {
  const real = c.port as unknown as ApprovalEnginePort;
  const other = (u: string) => (u === PA.H.id ? PA.B.id : PA.H.id);
  const signal = (u: string) => {
    let r = () => {};
    const p = new Promise<void>((res) => {
      r = res;
    });
    g.arrived.set(u, r);
    return p;
  };
  const atAct = new Map([PA.H.id, PA.B.id].map((u) => [u, signal(u)]));
  return {
    ...real,
    stepsView: (u, run) => real.stepsView(u, run),
    act: async (u) => {
      g.arrived.get(u.userId)?.();
      if (g.first !== null) return "not_open";
      g.first = u.userId;
      const o = other(u.userId);
      await Promise.race([atAct.get(o), g.done.get(o)]);
      return "ok";
    },
  } as ApprovalEnginePort;
}

describe("CR-107 · đua Đạt duyệt cuối kèm SP", () => {
  it("hai người Đạt cùng lúc, SP khác nhau ⇒ HĐ duyệt với ĐÚNG SP của người thắng", async () => {
    const id = await seedContract(c, 791);
    const aid = (await toLevel1(c, id, 10_000_000)).runId; // dưới ngưỡng ⇒ bước 0 là bước cuối
    const [a] = await c.sql<
      Json[]
    >`select engine_run_id::text as run, flow_steps, started_by::text as by
      from contracts.approvals where id = ${aid}`;
    const run = a?.run as string;
    await waitStatus(c.sql, run, "waiting_review");
    const item = "e3000000-0000-4000-8000-000000000791";
    await insItem(c.sql, T.acme, id, 90, { id: item, name: "Thùng CF-791" } as never);
    const prod = (name: string) => [
      { item_id: item, new_product: { name, unit: "thùng", group: "goods" } },
    ];

    const g: Gate = { first: null, arrived: new Map(), done: new Map() };
    const uow = createPackUow(db, "contracts", (tx, tid) => ({
      approvalEngine: approvalEngineRepo(tx, tid),
    })) as unknown as EngineCardDeps["uow"];
    const port = gatedPort(g);
    const deps: EngineCardDeps = {
      port: () => port,
      uow,
      jobs: { enqueue: async () => {} },
    };
    const st = {
      runId: aid,
      status: "needs_review",
      hasSource: true,
      version: 1,
      approval: {
        id: aid,
        status: "level1",
        startedBy: a?.by as string,
        feedback: null,
        mode: "engine",
        engineRunId: run,
        flowSteps: a?.flow_steps,
      },
      value: 10_000_000,
      deal: null,
      threshold: 500_000_000,
    } as unknown as ApprovalState;
    const go = (u: { id: string }, name: string) =>
      engineAct(deps)(
        { tenantId: T.acme, userId: u.id },
        id,
        { action: "approve", products: prod(name) },
        st,
      );
    const pH = go(PA.H, "SP của H");
    g.done.set(
      PA.H.id,
      pH.catch(() => null),
    );
    const pB = go(PA.B, "SP của B");
    g.done.set(
      PA.B.id,
      pB.catch(() => null),
    );
    const out = await Promise.allSettled([pH, pB]);

    const winner = g.first as string;
    expect([PA.H.id, PA.B.id]).toContain(winner);
    const res = new Map<string, EngineActResult | string>([
      [PA.H.id, out[0].status === "fulfilled" ? out[0].value : "throw"],
      [PA.B.id, out[1].status === "fulfilled" ? out[1].value : "throw"],
    ]);
    const loser = winner === PA.H.id ? PA.B.id : PA.H.id;
    expect({ win: res.get(winner), lose: res.get(loser) }).toEqual({
      win: "ok",
      lose: { error: "APPROVAL_NOT_OPEN" },
    });

    // Người thắng Đạt THẬT ⇒ tool finalize đọc `pending_links` dưới khoá HĐ.
    expect(
      await c.port.act(
        caller({ id: winner, role: "member" }),
        run,
        { stage: "s0" },
        { result: "pass" },
      ),
    ).toBe("ok");
    await waitStatus(c.sql, run, "done");
    expect((await contractRow(c, id)).status).toBe("active");
    const [p] = await c.sql<Json[]>`select p.name from contracts.contract_items i
      left join contracts.products p on p.id = i.product_id where i.id = ${item}`;
    expect(p?.name).toBe(winner === PA.H.id ? "SP của H" : "SP của B");
  }, 90_000);
});
