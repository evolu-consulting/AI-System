// HUB-FR-66 · spec H4b2 §3 A · Q6 · `toProviderDetail` hợp `ProviderDetailSchema`, không lọt cột lạ, `last_error` đã che.
import { describe, expect, it } from "bun:test";
import { ProviderDetailSchema } from "@ai/contracts/studio";
import { editableOf, toProviderDetail } from "./providers.map";
import type { ProviderDetailRow } from "./providers.repo";

const T = new Date("2026-10-13T01:02:03.000Z");
const row = (o: Partial<ProviderDetailRow> = {}): ProviderDetailRow => ({
  id: "a4b20000-0000-4000-8000-000000000001",
  key: "qc-api",
  kind: "api",
  vendor: "openai",
  baseUrl: null,
  secretId: "a4b20000-0000-4000-8000-000000000002",
  maxConcurrency: 2,
  enabled: true,
  devOnly: false,
  version: 3,
  updatedAt: T,
  secretName: "openai-prod",
  slotsInUse: 1,
  state: null,
  ...o,
});

describe("toProviderDetail · HUB-FR-66", () => {
  it("api có secret ⇒ secret {id,name}, has_secret, readonly false, hợp schema", () => {
    const d = toProviderDetail(row(), [
      { id: "a4b20000-0000-4000-8000-000000000003", key: "smart" },
    ]);
    expect(ProviderDetailSchema.safeParse(d).success).toBe(true);
    expect(d).toMatchObject({
      has_secret: true,
      secret: { id: row().secretId, name: "openai-prod" },
      readonly: false,
      version: 3,
      slots_in_use: 1,
      updated_at: T.toISOString(),
      state: null,
    });
    expect(Object.keys(d)).not.toContain("secret_id");
  });

  it("dify ⇒ readonly; subscription không secret ⇒ secret null", () => {
    const d = toProviderDetail(row({ vendor: "dify", kind: "subscription", secretId: null }), []);
    expect([d.readonly, d.secret, d.has_secret]).toEqual([true, null, false]);
  });

  it("state đủ trường; last_error che chuỗi giống key và cắt 500 (Q6)", () => {
    const leak = `Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX ${"x".repeat(600)}`;
    const d = toProviderDetail(
      row({
        state: {
          status: "cooldown",
          cooldownUntil: T,
          lastProbeAt: null,
          lastOkAt: T,
          utilization: 0.5,
          lastError: leak,
        },
      }),
      [],
    );
    expect(ProviderDetailSchema.safeParse(d).success).toBe(true);
    expect(d.state).toMatchObject({
      status: "cooldown",
      cooldown_until: T.toISOString(),
      last_probe_at: null,
    });
    expect(d.state?.last_error).not.toContain("ABCDEFGHIJKLMNOP");
    expect(d.state?.last_error?.length).toBeLessThanOrEqual(500);
  });
});

describe("editableOf", () => {
  it("chỉ 4 trường sửa được", () => {
    expect(editableOf(row())).toEqual({
      base_url: null,
      secret_id: row().secretId,
      max_concurrency: 2,
      enabled: true,
    });
  });
});
