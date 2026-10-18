// HUB-FR-143 · review T6c (Thấp + Trung #1): `tenant`/`system` chặn `tenantId` sai dạng TRƯỚC khi mở tx (DomainError
// `TENANT_INVALID`, không chạm DB); `tenantOnly`/`systemOnly` là object riêng — ép kiểu cũng không lộ cổng kia.
import { describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { DomainError } from "../domain/errors";
import { createHubUow, systemOnly, tenantOnly } from "./hub-uow";

/** DB chạm vào là ném — chứng minh guard chạy trước khi mở tx. */
const noDb = new Proxy({} as Db, {
  get() {
    throw new Error("không được mở tx");
  },
});
const uow = createHubUow(noDb, { clock: { now: () => new Date(0) }, publish: async () => {} });
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );
const USER = "a1000000-0000-4000-8000-000000000101";

describe("T6c · guard uuid tenant", () => {
  const bad = ["", " ", "acme", "a1000000-0000-4000-8000-00000000000", "'; drop table x; --"];
  it("HUB-FR-143 · tenant/system với tenantId sai dạng ⇒ TENANT_INVALID, không mở tx", async () => {
    const got = await Promise.all(
      bad.flatMap((t) => [
        codeOf(uow.tenant({ tenantId: t, userId: USER }, async () => 1)),
        codeOf(uow.system(t, async () => 1)),
      ]),
    );
    expect(got).toEqual(bad.flatMap(() => ["TENANT_INVALID", "TENANT_INVALID"]));
  });
  it("HUB-FR-143 · tenantId không phải chuỗi (lọt kiểu ở biên) ⇒ TENANT_INVALID", async () => {
    const t = undefined as unknown as string;
    expect(await codeOf(uow.system(t, async () => 1))).toBe("TENANT_INVALID");
  });
});

describe("T6c · tách cổng tenant / system", () => {
  it("HUB-FR-143 · tenantOnly chỉ có `tenant`; systemOnly chỉ có `system`, `systemBatch`", () => {
    expect(Object.keys(tenantOnly(uow)).sort()).toEqual(["tenant"]);
    expect(Object.keys(systemOnly(uow)).sort()).toEqual(["system", "systemBatch"]);
  });
});
