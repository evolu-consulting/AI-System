// CR-122 · A1 · FLOW2-FR-18/19 · cờ flow: bật ⇒ `contract.submitted` ghi CÙNG tx và KHÔNG mở run theo đường khe cũ; tắt ⇒ giữ nguyên.
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { CONTRACT_EVENTS, contractEventId, FACT_KEYS } from "../domain/contract-flow-events.rules";
import { startApproval } from "../testing/start-approval";
import { type ContractFlowGate, emitGuarded, type FlowPrep } from "./contract-flow.ports";

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
    // esign.* (N1) là sự kiện của node Ký số; `contract.expiring` (CR-127 K6) phát từ vòng hiệu lực, dữ kiện kiểm ở expiry-outcome.int.
    const evs = (CONTRACTS_MANIFEST.events ?? []).filter(
      (e) => e.key.startsWith("contract.") && e.key !== "contract.expiring",
    );
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
  it("cờ BẬT: lượt level1 (fixture Z1) phát contract.submitted cùng tx mở lượt, không còn máy duyệt cũ", async () => {
    const h = harness({ on: true, departments: ["pb-kd"] });
    const out = await startApproval({
      uow: h.uow,
      flow: h.gate,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "level1");
    expect(out).toBe("ok");
    // CR-127 Z1: máy duyệt cũ + "Xác nhận và lưu" đã gỡ; fixture mô phỏng "Gửi": mở lượt rồi phát cùng tx
    expect(h.order).toEqual(["open", "emit"]);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({ event: "contract.submitted", departments: ["pb-kd"] });
    expect(h.started).toEqual([]);
  });
  it("cờ TẮT: vẫn ghi sự kiện (bóng), không mở run theo đường cũ (đã gỡ)", async () => {
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
    expect(h.started).toEqual([]);
  });
  it("không cổng (test cũ): không phát, không mở run", async () => {
    const h = harness({ on: true, departments: null });
    await startApproval({
      uow: h.uow,
      engine: h.engine,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never)(who, CID, "level1");
    expect(h.emitted).toEqual([]);
    expect(h.started).toEqual([]);
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
