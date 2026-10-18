// HUB-FR-144 · review T12 #6: múi giờ tenant hỏng/thiếu ⇒ mặc định + warn chỉ có tenantId.
import { describe, expect, it } from "bun:test";
import { TENANT_TZ_DEFAULT } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { tenantTzRepo } from "./tenant-tz.repo";

const txOf = (rows: { timezone: string }[]) => ({ execute: async () => rows }) as unknown as Tx;

describe("tenantTzRepo.read", () => {
  it("hợp lệ ⇒ giữ nguyên, không log", async () => {
    const warns: unknown[] = [];
    const tz = await tenantTzRepo(txOf([{ timezone: "America/New_York" }]), "t1", {
      warn: (...a) => void warns.push(a),
    }).read();
    expect([tz, warns.length]).toEqual(["America/New_York", 0]);
  });
  it("hỏng ⇒ mặc định + warn chỉ tenantId", async () => {
    const warns: unknown[][] = [];
    const tz = await tenantTzRepo(txOf([{ timezone: "Not/AZone" }]), "t1", {
      warn: (...a) => void warns.push(a),
    }).read();
    expect(tz).toBe(TENANT_TZ_DEFAULT);
    expect(warns).toEqual([["process-tenant-tz-invalid", { tenantId: "t1" }]]);
  });
  it("không hàng ⇒ mặc định", async () => {
    expect(await tenantTzRepo(txOf([]), "t1").read()).toBe(TENANT_TZ_DEFAULT);
  });
});
