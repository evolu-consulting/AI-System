// CR-127 · E2 · spec §5.1 · R#27 · int vòng tự trả việc đã nhận (đồng hồ giả, gọi `releaseClaims` trực tiếp — không ngủ):
// chưa quá giờ ⇒ giữ; quá giờ ⇒ việc về nhóm + báo trưởng phòng; nhóm không có trưởng phòng ⇒ báo quản trị công ty. Khoá: tx duyệt
// giữ `lockRun(R)` ⇒ lô tự trả BỎ task của R (không chờ, không 55P03/40P01), lô sau mới nhận. Lô: ≤ 3 câu, không theo số hàng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql as dsql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { releaseDueClaims } from "../../adapters/claim/claim.repo";
import { createHubUow, systemOnly } from "../../adapters/hub-uow";
import { lockRun } from "../../core/core.repo";
import type { ProcessDeps } from "../../core/ports";
import { ClaimService } from "../../gates/claim.service";
import { type ClaimWorld, claimWorld, groupTask } from "../../testing/claim-seed";
import type { BatchRepos } from "../ports";
import { releaseBatch, releaseClaims } from "./claim-release.usecase";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const T0 = new Date("2026-11-10T08:00:00.000Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

const claimAs = (u: string, taskId: string) =>
  new ClaimService({
    db,
    config: {
      user: async (id: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(id) ?? []) }),
    },
    now: () => T0,
  } as unknown as ProcessDeps).claim({ userId: u, tenantId: w.T, role: "member" } as never, taskId);
const sysUow = () =>
  systemOnly(createHubUow(db, { clock: () => new Date(), publish: async () => {} } as never));
const release = (h: number) =>
  releaseClaims({ sysUow: sysUow(), now: () => at(h), elapsedMs: () => 0 });
const holder = async (taskId: string) =>
  (
    await o<
      { c: string | null }[]
    >`select claimed_by::text as c from hub.review_tasks where id = ${taskId}`
  )[0]?.c;
const noticesOf = (taskId: string) =>
  o<{ user_id: string; kind: string }[]>`select user_id::text, kind from hub.process_notices
    where task_id = ${taskId} and kind = 'task_released' order by user_id`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1272);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E2 · tự trả việc đã nhận", () => {
  it("chưa quá giờ ⇒ giữ; quá giờ ⇒ về nhóm, báo trưởng phòng; nhóm không có trưởng phòng ⇒ báo quản trị công ty", async () => {
    const a = await groupTask(o, w, w.G);
    const b = await groupTask(o, w, w.G0);
    await claimAs(w.A, a.taskId);
    await claimAs(w.B, b.taskId);
    expect(await release(23)).toBe(0);
    expect([await holder(a.taskId), await holder(b.taskId)]).toEqual([w.A, w.B]);
    expect(await release(25)).toBe(2);
    expect([await holder(a.taskId), await holder(b.taskId)]).toEqual([null, null]);
    expect((await noticesOf(a.taskId)).map((n) => n.user_id)).toEqual([w.H]);
    expect((await noticesOf(b.taskId)).map((n) => n.user_id)).toEqual([w.TA]);
    expect(await release(26)).toBe(0); // đã trả ⇒ không báo lại
  });

  it("lock-order: tx duyệt giữ lockRun(R) ⇒ lô bỏ task của R (không chờ khoá), A commit ⇒ lô sau nhận", async () => {
    const a = await groupTask(o, w, w.G);
    const b = await groupTask(o, w, w.G);
    await claimAs(w.A, a.taskId);
    await claimAs(w.A, b.taskId);
    const mine = (ids: string[]) => ids.filter((x) => x === a.taskId || x === b.taskId);
    const batchB = () =>
      withHubScope(db, { kind: "system" }, async (tx) => {
        await tx.execute(dsql`set local lock_timeout = '200ms'`);
        const r = await releaseDueClaims(tx, at(25), 1000);
        return mine(r.tasks.map((t) => t.taskId));
      });
    const during = await withHubScope(db, { kind: "system" }, async (tx) => {
      expect((await lockRun(tx, w.T, a.runId))?.id).toBe(a.runId);
      return batchB();
    });
    expect(during).toEqual([b.taskId]);
    expect(await batchB()).toEqual([a.taskId]);
  });

  it("perf: mỗi lô số câu cố định (1 câu trả + 1 lượt chèn notice) bất kể số hàng", async () => {
    const ts = await Promise.all([1, 2, 3].map(() => groupTask(o, w, w.G)));
    for (const t of ts) await claimAs(w.B, t.taskId);
    const calls: string[] = [];
    const out = await sysUow().systemBatch((r: BatchRepos) =>
      releaseBatch(
        {
          ...r,
          reviewTasks: {
            ...r.reviewTasks,
            releaseDueClaims: (l, n) => {
              calls.push("release");
              return r.reviewTasks.releaseDueClaims(l, n);
            },
          },
          notices: {
            ...r.notices,
            notifyMany: (k, rows) => {
              calls.push(`notify:${rows.length}`);
              return r.notices.notifyMany(k, rows);
            },
          },
        },
        at(30),
        100,
      ),
    );
    expect(out.n).toBeGreaterThanOrEqual(3);
    expect(calls).toEqual(["release", `notify:${out.n}`]);
  });
});
