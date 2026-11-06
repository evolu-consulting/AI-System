// CR-122 · A1 · FLOW2-FR-15 · OutcomeHandler của gói Hợp đồng: định tuyến theo (sự kiện, kết cục) — phần SQL ở int (chờ soát `inPack`).
import { describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { flowPortRegistry } from "../kit/public";
import { CONTRACT_EVENTS } from "./domain/contract-flow-events.rules";
import { contractsOutcomeHandler } from "./flow-events.mount";

const input = (event: string, outcome: string) => ({
  tenantId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  event,
  ref: "not-a-uuid", // ref sai ⇒ applyContractOutcome trả not_found TRƯỚC khi chạm DB
  outcome,
  actorId: null,
});

describe("A1 · OutcomeHandler contracts", () => {
  const h = contractsOutcomeHandler();
  const tx = {} as Tx; // không được chạm
  it("khai đủ 3 sự kiện của manifest", () => {
    expect([...h.events].sort()).toEqual([...CONTRACT_EVENTS].sort());
  });
  it("submitted: approved/rejected/returned đi vào áp dụng (ref sai ⇒ not_found, không chạm DB)", async () => {
    for (const o of ["approved", "rejected", "returned"])
      expect(await h.apply(tx, input("contract.submitted", o))).toBe("not_found");
  });
  it("approved/done và uploaded/accepted không đổi HĐ, kết cục chưa hỗ trợ thì ném", async () => {
    expect(await h.apply(tx, input("contract.approved", "done"))).toBe("applied");
    expect(await h.apply(tx, input("contract.uploaded", "accepted"))).toBe("applied");
    await expect(h.apply(tx, input("contract.uploaded", "cancelled"))).rejects.toThrow();
    await expect(h.apply(tx, input("contract.submitted", "lạ"))).rejects.toThrow();
  });
  it("đăng ký vào sổ kit theo (gói, sự kiện); đăng ký lại ⇒ thay", () => {
    flowPortRegistry.registerOutcomeHandler(h);
    for (const e of CONTRACT_EVENTS)
      expect(flowPortRegistry.outcomeHandlerFor("contracts", e)).toBe(h);
    const h2 = contractsOutcomeHandler();
    flowPortRegistry.registerOutcomeHandler(h2);
    expect(flowPortRegistry.outcomeHandlerFor("contracts", "contract.submitted")).toBe(h2);
    flowPortRegistry.clearPack("contracts");
    expect(flowPortRegistry.outcomeHandlerFor("contracts", "contract.submitted")).toBeUndefined();
  });
});
