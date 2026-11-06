// CR-121 R-8 · FLOW-FR-01 · mount gói community (runtime bật) ghi 3 khe vào `flowAdapterSlots` ⇒ kiểm khe không còn gap adapter.
import { describe, expect, test } from "bun:test";
import type { Db } from "@ai/db";
import { currentSlotContractGaps } from "../kit/adapters/slot-contract.check";
import type { ExternalOrgResolver, PackAccessView } from "../kit/public";
import { communityModule } from "./community.mount";

describe("FLOW-FR-01 · community đăng ký khe adapter", () => {
  test("mount runtime bật ⇒ không còn gap `adapter` cho 3 khe community", () => {
    communityModule({} as Db, {} as PackAccessView, {} as ExternalOrgResolver, {
      flows: { runtimeOn: true },
    });
    const gaps = currentSlotContractGaps(true).filter((g) => g.app === "community");
    expect(gaps).toEqual([]);
  });
});
