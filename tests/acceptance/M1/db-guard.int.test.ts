// ADM-NFR-07 · assertSafeDbRole chặn role DB nguy hiểm (test-plan D3; plan.md §3.3).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb } from "@ai/db";
import { ADMIN_API_URL, createEnv, type Env, OWNER_URL, withDangerRole } from "./_fixtures";
import { loadDbGuard } from "./_modules";

let env: Env;
beforeAll(async () => {
  env = await createEnv({ fixture: false });
});
afterAll(async () => {
  await env.close();
});

/** Chạy assertSafeDbRole với url; trả Error nếu ném, null nếu qua. */
async function guard(url: string): Promise<Error | null> {
  const { assertSafeDbRole } = await loadDbGuard();
  const db = createDb(url, { max: 1 });
  try {
    await assertSafeDbRole(db);
    return null;
  } catch (e) {
    return e as Error;
  } finally {
    await db.close();
  }
}

describe("ADM-NFR-07 · assertSafeDbRole", () => {
  it("ADM-NFR-07 · spec §4 · kết nối owner/superuser → ném, thông báo nêu ADMIN_API_DATABASE_URL", async () => {
    const err = await guard(OWNER_URL);
    expect(err).not.toBeNull();
    expect(err?.message).toContain("ADMIN_API_DATABASE_URL");
  });

  it("ADM-NFR-07 · spec §4 · kết nối bằng admin_api → qua", async () => {
    expect(await guard(ADMIN_API_URL)).toBeNull();
  });

  it("ADM-NFR-07 · spec §4 · role có BYPASSRLS → ném", async () => {
    await withDangerRole(env.owner, "bypass", async (url) => {
      expect(await guard(url)).not.toBeNull();
    });
  });

  it("ADM-NFR-07 · spec §4 · role sở hữu bảng trong schema admin → ném", async () => {
    await withDangerRole(env.owner, "owner", async (url) => {
      expect(await guard(url)).not.toBeNull();
    });
  });
});
