// HUB-FR-68 · HUB-BR-30 · unit: map metadata (không giá trị), lỗi secrets, target route, useSecret thiếu khoá.
import { describe, expect, test } from "bun:test";
import { HubSecretSchema } from "@ai/contracts/hub-admin";
import type { Db } from "../../lib/db";
import { secretError, secretsNotConfigured } from "./secrets.errors";
import { studioTarget, tenantTarget, toHubSecret } from "./secrets.service";
import { HubSecretReader, isSecretUseError } from "./secrets.use";

const T = "a1000000-0000-4000-8000-000000000003";
const row = {
  id: "a4b10000-0000-4000-8000-000000000001",
  kind: "source_credential" as const,
  tenantId: T,
  tenantKey: "acme",
  tenantName: "Acme",
  name: "git-acme",
  version: 2,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T01:00:00.000Z",
  updatedBy: "tadmin",
};

describe("HUB-FR-68 · toHubSecret", () => {
  test("hợp contract strict, tenant ref, không trường giá trị", () => {
    const s = toHubSecret(row, [{ type: "source", id: row.id, key: "src" }]);
    expect(HubSecretSchema.safeParse(s).success).toBe(true);
    expect(s.tenant).toEqual({ id: T, key: "acme", name: "Acme" });
    expect(Object.keys(s).sort()).toEqual(
      [
        "created_at",
        "id",
        "kind",
        "name",
        "tenant",
        "updated_at",
        "updated_by",
        "used_by",
        "version",
      ].sort(),
    );
  });
  test("tenant null ⇒ tenant null (nền tảng)", () => {
    expect(toHubSecret({ ...row, kind: "provider_api_key", tenantId: null }, []).tenant).toBeNull();
  });
});

describe("HUB-FR-68 · lỗi + target", () => {
  test("mã + status cố định", () => {
    expect([secretError("SECRET_NAME_TAKEN").status, secretError("SECRET_IN_USE").status]).toEqual([
      409, 409,
    ]);
    expect({ code: secretsNotConfigured().code, status: secretsNotConfigured().status }).toEqual({
      code: "NOT_CONFIGURED",
      status: 409,
    });
  });
  test("route tenant: filter source_credential + tenant, scope user", () => {
    const u = { userId: "u1", tenantId: T, role: "tenant_admin" as const };
    expect(tenantTarget(u, T)).toEqual({
      route: "tenant",
      filter: { kind: "source_credential", tenantId: T },
      scope: { kind: "user", tenantId: T, userId: "u1" },
    });
    expect(studioTarget.scope).toEqual({ kind: "system" });
  });
});

describe("HUB-BR-30 · useSecret thiếu khoá", () => {
  test("key null ⇒ SecretUseError key_missing, fn không chạy, log chỉ {secret_id, kind, failure}", async () => {
    const logs: Record<string, unknown>[] = [];
    const r = new HubSecretReader({
      db: {} as Db,
      key: null,
      log: { warn: (msg, f) => logs.push({ msg, ...f }) },
    });
    let called = false;
    const err = await r
      .useSecret({ id: row.id, kind: "kh_api_key", tenantId: T }, async () => {
        called = true;
      })
      .catch((e: unknown) => e);
    expect(isSecretUseError(err)).toBe(true);
    expect((err as Error).message).toBe("hub secret: key_missing");
    expect(called).toBe(false);
    expect(logs).toEqual([
      {
        msg: "hub_secret_use_failed",
        secret_id: row.id,
        kind: "kh_api_key",
        failure: "key_missing",
      },
    ]);
  });
});
