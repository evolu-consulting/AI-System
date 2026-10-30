// CR-104 · ops-core · check mẫu "DB / Redis": ping như `/health` (server.ts). Lỗi ⇒ crit; không có ngưỡng warn.
import { pingDb } from "../../../../lib/db";
import { pingRedis } from "../../../../lib/redis";
import type { OpsCheck } from "../../application/ops.check";

export const dbRedisCheck: OpsCheck = {
  key: "db_redis",
  timeoutMs: 5_000,
  async run(d) {
    const t0 = performance.now();
    const [db, redis] = await Promise.allSettled([
      pingDb(d.db),
      d.redis ? pingRedis(d.redis, 2_000) : Promise.resolve(),
    ]);
    const ms = Math.round(performance.now() - t0);
    const down = [
      db.status === "rejected" ? "Postgres" : "",
      redis.status === "rejected" ? "Redis" : "",
    ].filter(Boolean);
    if (down.length === 0)
      return {
        status: "ok",
        value: { ms, redis: d.redis ? "ok" : "n/a" },
        message: `DB + Redis trả lời (${ms} ms)`,
      };
    return {
      status: "crit",
      value: { ms, down },
      message: `${down.join(" + ")} không trả lời`,
      hint: "Kiểm container: `docker compose ps`, `docker compose logs --tail 100 postgres redis`; khởi động lại dịch vụ lỗi.",
    };
  },
};
