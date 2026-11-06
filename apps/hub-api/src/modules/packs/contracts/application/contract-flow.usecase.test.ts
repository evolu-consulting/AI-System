// CR-122 · A1 · FLOW2-FR-18/19 · cờ flow: bật ⇒ `contract.submitted` ghi CÙNG tx và KHÔNG mở run theo đường khe cũ; tắt ⇒ giữ nguyên.
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { CONTRACT_EVENTS, contractEventId, FACT_KEYS } from "../domain/contract-flow-events.rules";
import { startApproval } from "./approval.usecase";
import { type ContractFlowGate, emitGuarded, type FlowPrep } from "./contract-flow.ports";
import { handleExtractJob } from "./extract-job.usecase";

const who = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};
const CID = "33333333-3333-4333-8333-333333333333";

type Call = { event: string; cid: string; key: string; actor: string | null; departments: unknown };
function harness(prep: FlowPrep) {
  const emitted: Call[] = [];
  const order: string[] = [];
  const repos = {
    approval: {
      open: async () => {
        order.push("open");
        return "ok" as const;
      },
      afterExtraction: async () => {
        order.push("after");
        return "level1" as const;
      },
      markStarted: async () => true,
    },
    contractFlow: {
      emitContract: async (
        event: string,
        cid: string,
        key: string,
        o: { actor: string | null; departments: unknown },
      ) => {
        order.push("emit");
        emitted.push({ event, cid, key, actor: o.actor, departments: o.departments });
        return true;
      },
    },
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: never) => Promise<unknown>) => fn(repos as never),
  };
  const gate: ContractFlowGate = { prepare: async () => prep };
  const started: string[] = [];
  const engine = async (_w: unknown, id: string) => {
    started.push(id);
  };
  return { emitted, order, uow, gate, started, engine };
}

describe("A1 · manifest ⇄ luật thuần", () => {
  it("3 sự kiện + khoá dữ kiện khớp manifest events[]", () => {
    const evs = CONTRACTS_MANIFEST.events ?? [];
    expect(evs.map((e) => e.key).sort()).toEqual([...CONTRACT_EVENTS].sort());
    for (const e of evs)
      expect(e.facts.map((f) => f.key).sort()).toEqual(
        [...FACT_KEYS[e.key as (typeof CONTRACT_EVENTS)[number]]].sort(),
      );
  });
  it("event_id ổn định theo bản ghi + phiên bản (lượt)", () => {
    expect(contractEventId("contract.submitted", CID, "a1")).toBe(`contract.submitted:${CID}:a1`);
    expect(contractEventId("contract.submitted", CID, "a1")).toBe(
      contractEventId("contract.submitted", CID, "a1"),
    );
    expect(contractEventId("contract.submitted", CID, "a2")).not.toBe(
      contractEventId("contract.submitted", CID, "a1"),
    );
    expect(contractEventId("contract.uploaded", CID)).toBe(`contract.uploaded:${CID}`);
  });
});

describe("A1 · emitGuarded (savepoint khi cờ tắt)", () => {
  const calls: string[] = [];
  const repo = {
    shadow: async (e: string, fn: (r: unknown) => Promise<unknown>) => {
      calls.push(`shadow:${e}`);
      await fn({});
    },
  } as never;
  it("cờ tắt ⇒ chạy qua repo.shadow; cờ bật ⇒ chạy thẳng, không savepoint", async () => {
    await emitGuarded(repo, false, "contract.submitted", async () => calls.push("fn"));
    await emitGuarded(repo, true, "contract.submitted", async () => calls.push("fn-on"));
    expect(calls).toEqual(["shadow:contract.submitted", "fn", "fn-on"]);
  });
});

describe("A1 · gửi duyệt (startApproval level1)", () => {
  it("cờ BẬT: ghi contract.submitted sau open, cùng tx, theo lượt, không gọi engine cũ", async () => {
    const h = harness({ on: true, departments: ["pb-kd"] });
    const out = await startApproval({
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "level1");
    expect(out).toBe("ok");
    expect(h.order).toEqual(["open", "emit"]);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      event: "contract.submitted",
      cid: CID,
      actor: who.userId,
      departments: ["pb-kd"],
    });
    expect(h.emitted[0]?.key).toMatch(/^[0-9a-f-]{36}$/); // id lượt duyệt
    expect(h.started).toEqual([]);
  });
  it("cờ TẮT: vẫn ghi sự kiện (bóng) và mở run theo đường cũ", async () => {
    const h = harness({ on: false, departments: ["pb-kd"] });
    await startApproval({
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "level1");
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({ event: "contract.submitted", departments: ["pb-kd"] });
    expect(h.started).toEqual([CID]);
  });
  it("không cổng (test cũ): như cờ tắt", async () => {
    const h = harness({ on: true, departments: null });
    await startApproval({
      uow: h.uow,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "level1");
    expect(h.emitted).toEqual([]);
    expect(h.started).toEqual([CID]);
  });
  it("initial extracting: chưa bắn (bắn lúc vào level1 sau AI đọc)", async () => {
    const h = harness({ on: true, departments: null });
    await startApproval({
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "extracting");
    expect(h.emitted).toEqual([]);
  });
});

describe("A1 · sau AI đọc (handleExtractJob → level1)", () => {
  const job = { ...who, contractId: CID, approvalId: "44444444-4444-4444-8444-444444444444" };
  it("cờ BẬT: contract.submitted cùng tx afterExtraction, event_id theo approvalId, không mở run cũ", async () => {
    const h = harness({ on: true, departments: null });
    await handleExtractJob({
      run: async () => "ok",
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
    } as never)(job);
    expect(h.order).toEqual(["after", "emit"]);
    expect(h.emitted[0]).toMatchObject({
      event: "contract.submitted",
      cid: CID,
      key: job.approvalId,
    });
    expect(h.started).toEqual([]);
  });
  it("cờ TẮT: giữ đường cũ, vẫn ghi sự kiện bóng", async () => {
    const h = harness({ on: false, departments: null });
    await handleExtractJob({
      run: async () => "ok",
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
    } as never)(job);
    expect(h.emitted).toHaveLength(1);
    expect(h.started).toEqual([CID]);
  });
});
