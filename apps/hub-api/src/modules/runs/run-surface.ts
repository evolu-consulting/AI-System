// ADM-FR-42 · usage-analytics · bề mặt gửi tin E12 (header `X-Ai-Surface`, vd dock Sổ Hợp Tác) ghi lên run của chính người
// gửi qua `hub.set_run_surface` (hub 0049, SECURITY DEFINER, một câu) — để thống kê token theo app. Lỗi chỉ cảnh báo.
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";

export async function noteRunSurface(
  d: { db: Db; log: Pick<Logger, "warn"> },
  u: AuthUser,
  runId: string,
  surface: string,
): Promise<void> {
  await d.db.db
    .execute(
      sql`select hub.set_run_surface(${u.tenantId}::uuid, ${u.userId}::uuid, ${runId}::uuid, ${surface})`,
    )
    .then(
      () => undefined,
      () => d.log.warn("run-surface-failed", { run_id: runId }),
    );
}
