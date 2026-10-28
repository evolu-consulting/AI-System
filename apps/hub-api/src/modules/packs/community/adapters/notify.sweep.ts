// CR-102 · com-c9 · vòng nền Community (scope hệ thống, mọi tenant bật gói; theo mẫu esign-sweep): mỗi tenant MỘT tx — (1) tự lưu
// trữ bài quá 30 ngày, (2) nhắc người đăng bài còn ≤ 3 ngày (một lần mỗi hạn), (3) tổng hợp 8:00 cho chủ quản đã bật. Mỗi pha MỘT
// câu SQL `FOR UPDATE SKIP LOCKED` (lô ≤ `limit`), chuông một lô; giờ là tham số `now` (test đồng hồ giả, KHÔNG sleep). Ngủ CHỈ
// giữa các lượt. Chạy lại / nhiều instance: ghi có điều kiện + khoá dedup ⇒ không nhắc trùng.
import type { Tx } from "@ai/db";
import type { Notifier } from "../../kit/application/notify";
import type { PackSystemUow } from "../../kit/application/ports";
import { digestDue } from "../domain/notify.rules";
import { deliver } from "./notify.events";
import { archiveExpired, claimDigest, markExpiring } from "./notify.repo";

type R = { tx: Tx; notify: Notifier };
export const COMMUNITY_SWEEP_LIMIT = 500;
export const DIGEST_TZ = "Asia/Ho_Chi_Minh";

export type CommunitySweepDeps = {
  uow: PackSystemUow<R>;
  tenants: () => Promise<readonly string[]>;
  hosts: (tenantId: string) => Promise<readonly string[]>;
  now?: () => Date;
  limit?: number;
  tz?: string;
  warn?: (m: string, meta: Record<string, unknown>) => void;
};
export type CommunitySweepResult = {
  tenants: number;
  archived: number;
  expiring: number;
  digests: number;
  bells: number;
};
const ZERO = { archived: 0, expiring: 0, digests: 0, bells: 0 };

async function sweepTenant(d: CommunitySweepDeps, t: string, now: Date) {
  const limit = d.limit ?? COMMUNITY_SWEEP_LIMIT;
  const hosts = await d.hosts(t);
  return d.uow.system(t, async (r) => {
    const archived = await archiveExpired(r.tx, t, now, limit);
    const soon = await markExpiring(r.tx, t, now, limit);
    let bells = await deliver(
      r,
      soon.map((p) => ({
        c: { userId: p.author, kind: "expiring" as const },
        post: { id: p.id, title: p.title },
        o: { actor: "", ref: String(new Date(p.expires_at).getTime()) },
      })),
    );
    let digests = 0;
    const g = digestDue(now, d.tz ?? DIGEST_TZ);
    if (g.due && hosts.length > 0) {
      const c = await claimDigest(r.tx, t, g.day, now, hosts);
      if (c.users.length > 0 && (c.fresh > 0 || c.openSell > 0)) {
        const text = `Hôm nay: ${c.fresh} bài mới từ đối tác, ${c.openSell} bài Cần bán đang mở`;
        const post = { id: "00000000-0000-0000-0000-000000000000", title: "" };
        bells += await deliver(
          r,
          c.users.map((u) => ({
            c: { userId: u, kind: "digest" as const },
            post,
            o: { actor: text, ref: g.day },
          })),
        );
        digests = c.users.length;
      }
    }
    return { archived, expiring: soon.length, digests, bells };
  });
}

export async function sweepCommunityOnce(
  d: CommunitySweepDeps,
  at?: Date,
): Promise<CommunitySweepResult> {
  const now = at ?? d.now?.() ?? new Date();
  const ts = await d.tenants();
  const sum: CommunitySweepResult = { tenants: ts.length, ...ZERO };
  for (let i = 0; i < ts.length; i += 4) {
    const part = await Promise.all(
      ts.slice(i, i + 4).map((t) =>
        sweepTenant(d, t, now).catch((e: unknown) => {
          d.warn?.("community-sweep-tenant-failed", {
            tenant_id: t,
            error: e instanceof Error ? e.name : "unknown",
            cause: String((e as { cause?: { message?: string } }).cause?.message ?? "").slice(
              0,
              200,
            ),
          });
          return ZERO;
        }),
      ),
    );
    for (const p of part) {
      sum.archived += p.archived;
      sum.expiring += p.expiring;
      sum.digests += p.digests;
      sum.bells += p.bells;
    }
  }
  return sum;
}

/** Vòng nền: một lượt mỗi `everyMs`, dừng theo `signal`. */
export function startCommunitySweeper(
  d: CommunitySweepDeps & { everyMs: number; signal?: AbortSignal },
): void {
  const tick = async () => {
    if (d.signal?.aborted) return;
    await sweepCommunityOnce(d).catch(() => d.warn?.("community-sweep-failed", {}));
    if (d.signal?.aborted) return;
    const t = setTimeout(tick, d.everyMs);
    (t as { unref?: () => void }).unref?.();
  };
  const t = setTimeout(tick, d.everyMs);
  (t as { unref?: () => void }).unref?.();
}
