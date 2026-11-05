// CR-121 F-4 · hồ sơ công ty: service tự kiểm vai (không chỉ route). Kiểm trước khi chạm DB ⇒ unit, không cần DB.
import { describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import {
  getTenantProfile,
  type ProfileActor,
  updateTenantProfile,
} from "./tenants.profile.service";

const A = "01900000-0000-7000-8000-00000000a001";
const B = "01900000-0000-7000-8000-00000000b001";
const db = {} as unknown as Db; // không được chạm tới
const actor = (role: ProfileActor["role"], tenantId: string): ProfileActor => ({
  userId: "01900000-0000-7000-8000-00000000c001",
  role,
  tenantId,
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "?",
  );

describe("CR-121 F-4 · quyền hồ sơ công ty ở service", () => {
  it("GET: member ⇒ FORBIDDEN, tenant_admin công ty khác ⇒ NOT_FOUND", async () => {
    const scope = { kind: "tenant", tenantId: B } as const;
    expect(await code(getTenantProfile({ db }, scope, A, actor("member", A)))).toBe("FORBIDDEN");
    expect(await code(getTenantProfile({ db }, scope, A, actor("tenant_admin", B)))).toBe(
      "NOT_FOUND",
    );
  });

  it("PATCH: tenant_admin (kể cả công ty mình) ⇒ FORBIDDEN, không ghi gì", async () => {
    const call = { ctx: { db }, scope: { kind: "tenant", tenantId: A } as const };
    const c = { ...call, actor: actor("tenant_admin", A) };
    expect(await code(updateTenantProfile(c, A, { version: 1 }))).toBe("FORBIDDEN");
  });
});
