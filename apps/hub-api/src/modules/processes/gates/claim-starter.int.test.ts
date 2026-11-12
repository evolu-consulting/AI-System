// SEC 2026-11-12 · N2-FR-05 · int (DB thật, role `hub_api`): bước bật `exclude_starter` ⇒ người gửi (started_by) KHÔNG Nhận việc
// được — kể cả là thành viên phòng được giao hoặc thuộc Group Toàn quyền (`also_group_ids`); thành viên khác nhận bình thường.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { ClaimService } from "./claim.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;

function deps(): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    now: () => new Date("2026-11-12T08:00:00.000Z"),
    log: { warn: () => {}, info: () => {}, error: () => {} },
  } as unknown as ProcessDeps;
}
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;
const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as { code?: string; status?: number };
    return { code: x.code, status: x.status };
  }
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1276);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("SEC · exclude_starter chặn Nhận việc của người gửi", () => {
  it("người gửi thuộc phòng ⇒ 403 STARTER_CANNOT_REVIEW, task vẫn chưa ai giữ; người khác nhận được", async () => {
    w.groupsOf.set(w.S, [w.G]);
    const { taskId } = await groupTask(o, w, w.G, {
      kind: "review",
      group_id: w.G,
      exclude_starter: true,
    });
    const claims = new ClaimService(deps());
    const e = await err(claims.claim(who(w.S), taskId));
    expect([e?.code, e?.status]).toEqual(["STARTER_CANNOT_REVIEW", 403]);
    const [t] = await o<{ claimed_by: string | null }[]>`
      select claimed_by::text from hub.review_tasks where id = ${taskId}`;
    expect(t?.claimed_by).toBeNull();
    const c = await claims.claim(who(w.A), taskId);
    expect([c.claim.state, c.claim.by?.id]).toEqual(["mine", w.A]);
  });

  it("người gửi chỉ thuộc Group Toàn quyền ⇒ cũng bị chặn", async () => {
    w.groupsOf.set(w.S, [w.G0]);
    const { taskId } = await groupTask(o, w, w.G, {
      kind: "review",
      group_id: w.G,
      also_group_ids: [w.G0],
      exclude_starter: true,
    });
    const e = await err(new ClaimService(deps()).claim(who(w.S), taskId));
    expect(e?.code).toBe("STARTER_CANNOT_REVIEW");
  });

  it("bước không bật exclude_starter ⇒ người gửi thuộc phòng vẫn nhận được (hành vi cũ)", async () => {
    w.groupsOf.set(w.S, [w.G]);
    const { taskId } = await groupTask(o, w, w.G, { kind: "review", group_id: w.G });
    const c = await new ClaimService(deps()).claim(who(w.S), taskId);
    expect(c.claim.state).toBe("mine");
  });
});
