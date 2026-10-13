// HUB-FR-66 · HUB-FR-67 · spec H4b2 §4 (migration 0030_h4b2_models) · Q8 · test-plan H4b2 §3 D20–D26: cột `version`
// (DEFAULT 1, CHECK ≥ 1), GRANT theo cột cho `hub_api` (key/kind/vendor/dev_only provider và key profile bất biến ⇒ 42501),
// INSERT/DELETE được, `provider_state` chỉ UPDATE `last_probe_at`, audit CHECK thêm `provider`/`model_profile`, migration
// chạy lại idempotent. Ghi thử trong transaction rồi huỷ (không để lại dữ liệu). Đỏ trước code: cột/GRANT chưa có ⇒
// SQLSTATE 42703/42501 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { HUB_API_URL, OWNER_URL } from "../H1/_fixtures";
import { setupH3b } from "../H3b/_h3b";
import type { Sql } from "./_h4b2";

let owner: Sql;
let api: Sql;
beforeAll(async () => {
  owner = await setupH3b();
  api = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await api?.end();
  await owner?.end();
});

const ROLLBACK = "qc-rollback";
/** "ok" hoặc SQLSTATE; chạy `fn` trong transaction `c` (scope system) rồi luôn huỷ. */
async function tryTx(
  c: Sql,
  fn: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<string> {
  try {
    await c.begin(async (tx) => {
      await tx`select set_config('app.scope', 'system', true)`;
      await fn(tx);
      throw new Error(ROLLBACK);
    });
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.message === ROLLBACK ? "ok" : String(err.code ?? err.message);
  }
}
const asApi = (fn: (tx: postgres.TransactionSql) => Promise<unknown>) => tryTx(api, fn);
const asOwner = (fn: (tx: postgres.TransactionSql) => Promise<unknown>) => tryTx(owner, fn);

describe("D20–D21 · cột version [spec §4 #1]", () => {
  it("HUB-FR-66 · D20 · providers.version, model_profiles.version: hàng có sẵn = 1", async () => {
    const got = [
      await asOwner((tx) =>
        tx`select version from hub.providers where key = 'claude-sub' and version = 1`.then((r) => {
          if (r.length !== 1) throw new Error("providers.version ≠ 1");
        }),
      ),
      await asOwner((tx) =>
        tx`select version from hub.model_profiles where key = 'fake-1' and version = 1`.then(
          (r) => {
            if (r.length !== 1) throw new Error("model_profiles.version ≠ 1");
          },
        ),
      ),
    ];
    expect(got).toEqual(["ok", "ok"]);
  });
  it("HUB-FR-66 · D21 · CHECK version ≥ 1 ⇒ 0 bị từ chối 23514", async () => {
    expect([
      await asOwner((tx) => tx`update hub.providers set version = 0 where key = 'claude-sub'`),
      await asOwner((tx) => tx`update hub.model_profiles set version = 0 where key = 'fake-1'`),
    ]).toEqual(["23514", "23514"]);
  });
});

describe("D22–D24 · GRANT theo cột cho hub_api [spec §4 #2–#4 · Q8]", () => {
  it("HUB-FR-66 · D22 · providers: UPDATE key/kind/vendor/dev_only ⇒ 42501; UPDATE base_url, secret_id, max_concurrency, enabled, version, updated_at ⇒ ok", async () => {
    const bad = await Promise.all(
      ["key = 'qc-x'", "kind = 'api'", "vendor = 'openai'", "dev_only = true"].map((set) =>
        asApi((tx) => tx.unsafe(`update hub.providers set ${set} where key = 'claude-sub'`)),
      ),
    );
    expect(bad).toEqual(["42501", "42501", "42501", "42501"]);
    const good = await asApi(
      (
        tx,
      ) => tx`update hub.providers set base_url = null, secret_id = null, max_concurrency = 3, enabled = false,
        version = version + 1, updated_at = now() where key = 'claude-sub'`,
    );
    expect(good).toBe("ok");
  });
  it("HUB-FR-66 · D23 · providers + model_profiles: INSERT và DELETE ⇒ ok; model_profiles UPDATE key ⇒ 42501, UPDATE steps/version/updated_at ⇒ ok", async () => {
    expect(
      await asApi(async (tx) => {
        await tx`insert into hub.providers (key, kind, vendor, max_concurrency) values ('qc-d23', 'subscription', 'openai', 1)`;
        await tx`delete from hub.providers where key = 'qc-d23'`;
        await tx`insert into hub.model_profiles (key, steps) values ('qc-d23', ${tx.json([{ provider_key: "fake-cli", model: null, on: [] }])})`;
        await tx`delete from hub.model_profiles where key = 'qc-d23'`;
      }),
    ).toBe("ok");
    expect(
      await asApi((tx) => tx`update hub.model_profiles set key = 'qc-y' where key = 'fake-1'`),
    ).toBe("42501");
    expect(
      await asApi(
        (
          tx,
        ) => tx`update hub.model_profiles set steps = steps, version = version + 1, updated_at = now()
          where key = 'fake-1'`,
      ),
    ).toBe("ok");
  });
  it("HUB-FR-66 · D24 · provider_state: UPDATE last_probe_at ⇒ ok; UPDATE status / updated_at ⇒ 42501 (Runtime sở hữu)", async () => {
    await owner`insert into hub.provider_state (provider_key, status, last_probe_at) values ('claude-sub', 'ok', now())
      on conflict (provider_key) do nothing`;
    expect([
      await asApi(
        (tx) =>
          tx`update hub.provider_state set last_probe_at = null where provider_key = 'claude-sub'`,
      ),
      await asApi(
        (tx) =>
          tx`update hub.provider_state set status = 'error' where provider_key = 'claude-sub'`,
      ),
      await asApi(
        (tx) =>
          tx`update hub.provider_state set updated_at = now() where provider_key = 'claude-sub'`,
      ),
    ]).toEqual(["ok", "42501", "42501"]);
  });
});

describe("D25–D26 · audit CHECK + migration chạy lại [spec §4 #5]", () => {
  it("HUB-FR-66 · D25 · audit entity provider / model_profile (tenant null) ⇒ ok; giá trị cũ secret, kh_connection, agent vẫn ok", async () => {
    const ins = (entity: string) =>
      asOwner(
        (tx) =>
          tx`insert into hub.audit_log (tenant_id, action, entity, entity_name) values (null, 'create', ${entity}, 'qc')`,
      );
    expect([
      await ins("provider"),
      await ins("model_profile"),
      await ins("secret"),
      await ins("kh_connection"),
      await ins("agent"),
    ]).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });
  it("HUB-FR-66 · D26 · chạy lại migration Hub ⇒ không lỗi; version giữ nguyên", async () => {
    await runHubMigrations({ url: OWNER_URL, appEnv: "test" });
    const [r] = await owner<
      { v: number }[]
    >`select (to_jsonb(p) ->> 'version')::int as v from hub.providers p
      where key = 'claude-sub'`;
    expect(r?.v).toBe(1);
  });
});
