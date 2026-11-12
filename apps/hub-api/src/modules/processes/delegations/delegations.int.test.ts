// CR-127 · E3 · spec §5.2 · R#13/R#15/R#43 · int (DB thật, role `hub_api`): lưu uỷ quyền (tự mình / đặt thay / chuỗi / ký số), áp khi
// giao việc mới — đích danh và cửa trưởng phòng sang B "Thay A", việc nhóm need='one' không áp, B là người gửi không áp, hết khoảng
// về A (B mất quyền, mất nhãn). Kiểm cả thẻ người dùng thấy (`TaskDetail.can_act/delegated_from`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { insertTask } from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails } from "../core/task-view";
import { openTaskCount } from "../notify/inbox.repo";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { DelegationsService } from "./delegations.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const H = 3_600_000;
const who = (userId: string, role: "member" | "tenant_admin" = "member") =>
  ({ userId, tenantId: w.T, role }) as never;
const svc = () => new DelegationsService({ db } as unknown as ProcessDeps);
const span = (kinds: string[] = ["approve"]) => ({
  from_at: new Date(Date.now() - H).toISOString(),
  to_at: new Date(Date.now() + 24 * H).toISOString(),
  kinds: kinds as never,
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

/** Task mới qua đường thật `insertTask` (thay task nhóm của seed — một task mở mỗi bước). */
async function newTask(o2: {
  userIds?: string[];
  groupId?: string | null;
  after?: Record<string, unknown>;
}) {
  const s = await groupTask(o, w, w.G, o2.after);
  await o`update hub.review_tasks set status = 'closed', result = 'cancelled' where id = ${s.taskId}`;
  const id = await withHubScope(db, { kind: "system" }, (tx) =>
    insertTask(tx, {
      tenantId: w.T,
      runId: s.runId,
      stageRunId: s.stageRunId,
      kind: "review",
      outputId: s.outputId,
      remindAt: new Date(Date.now() + 24 * H),
      userIds: o2.userIds ?? [],
      groupId: o2.groupId ?? null,
    }),
  );
  return id;
}
const grants = async (taskId: string) => [
  ...(await o<{ user_id: string | null; via: string; on_behalf_of: string | null }[]>`
    select user_id::text, via, on_behalf_of::text from hub.review_task_assignees where task_id = ${taskId}
    order by via, user_id`),
];
const card = (u: string, taskId: string) =>
  withHubScope(db, { kind: "user", userId: u, tenantId: w.T }, async (tx) => {
    const [d] = await loadTaskDetails(
      tx,
      { userId: u, tenantId: w.T, role: "member", groupIds: new Set(w.groupsOf.get(u) ?? []) },
      [taskId],
    );
    return { can_act: d?.can_act, from: d?.delegated_from?.id ?? null };
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1273);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E3 · lưu uỷ quyền", () => {
  it("tự mình ok · người thường đặt thay 403 · trưởng phòng đặt thay ok · chuỗi · ký số không thuộc nhóm ký · R#43 danh sách", async () => {
    const mine = await svc().create(who(w.A), { to_user_id: w.B, ...span() });
    expect([mine.from_user.id, mine.to_user.id, mine.revoked_at]).toEqual([w.A, w.B, null]);
    expect(
      await code(svc().create(who(w.X), { to_user_id: w.B, for_user_id: w.A, ...span() }, w.T)),
    ).toBe("DELEGATE_FORBIDDEN");
    expect(await code(svc().create(who(w.B), { to_user_id: w.X, ...span() }))).toBe(
      "DELEGATE_CHAIN",
    );
    expect(await code(svc().create(who(w.X), { to_user_id: w.H, ...span(["esign"]) }))).toBe(
      "DELEGATE_NOT_SIGNER",
    );
    expect(await code(svc().create(who(w.A), { to_user_id: w.A, ...span() }))).toBe(
      "DELEGATE_SELF",
    );
    // R#43: X (không liên quan) không thấy; trưởng phòng H thấy uỷ quyền của A; quản trị thấy hết.
    const ids = async (u: string, role?: "tenant_admin") =>
      (await svc().list(who(u, role), { tid: w.T, mine: false })).items.map((d) => d.id);
    expect(await ids(w.X)).not.toContain(mine.id);
    expect(await ids(w.H)).toContain(mine.id);
    expect(await ids(w.TA, "tenant_admin")).toContain(mine.id);
    // X không thấy ⇒ huỷ 404; A huỷ được.
    expect(await code(svc().revoke(who(w.X), mine.id))).toBe("NOT_FOUND");
    expect((await svc().revoke(who(w.A), mine.id)).revoked_at).not.toBeNull();
  });
});

describe("CR-127 E3 · áp khi giao việc mới", () => {
  it("đích danh: A ⇒ thêm B 'Thay A' (A giữ hàng); hết khoảng ⇒ B mất quyền + nhãn (về A)", async () => {
    const d = await svc().create(
      who(w.H, "tenant_admin"),
      { to_user_id: w.X, for_user_id: w.A, ...span() },
      w.T,
    );
    const t = await newTask({ userIds: [w.A] });
    expect(await grants(t)).toEqual([
      { user_id: w.X, via: "delegated", on_behalf_of: w.A },
      { user_id: w.A, via: "initial", on_behalf_of: null },
    ]);
    expect(await card(w.X, t)).toEqual({ can_act: true, from: w.A });
    expect((await card(w.A, t)).can_act).toBe(true);
    await o`update hub.delegations set from_at = now() - interval '3 hours', to_at = now() - interval '1 hour'
      where id = ${d.id}`;
    expect(await card(w.X, t)).toEqual({ can_act: false, from: null });
  });

  it("việc nhóm need='one' không áp; B là người gửi không áp (R#15)", async () => {
    await svc().create(who(w.B), { to_user_id: w.S, ...span() });
    const g = await newTask({ groupId: w.G });
    expect((await grants(g)).filter((r) => r.via === "delegated")).toEqual([]);
    const s = await newTask({ userIds: [w.B] });
    expect((await grants(s)).filter((r) => r.via === "delegated")).toEqual([]);
  });

  it("cửa trưởng phòng (head_only): trưởng phòng H uỷ quyền ⇒ người thay quyết được, nhãn 'Thay H'; need='head'", async () => {
    await svc().create(who(w.H), { to_user_id: w.TA, ...span() });
    const t = await newTask({
      groupId: w.G,
      after: { kind: "review", group_id: w.G, head_only: true },
    });
    expect((await grants(t)).filter((r) => r.via === "delegated")).toEqual([
      { user_id: w.TA, via: "delegated", on_behalf_of: w.H },
    ]);
    expect(await card(w.TA, t)).toEqual({ can_act: true, from: w.H });
    expect((await card(w.A, t)).can_act).toBe(false);
    const [n] = await o<{ need: string }[]>`select need from hub.review_tasks where id = ${t}`;
    expect(n?.need).toBe("head");
  });

  it("R#15 · người duyệt duy nhất là người gửi ⇒ giao 'Quá hạn chuyển cho' (người); không có ⇒ quản trị công ty", async () => {
    const toUser = await newTask({
      userIds: [w.S],
      after: { kind: "review", group_id: null, escalate: { after_h: 24, user_id: w.X } },
    });
    expect((await grants(toUser)).filter((r) => r.via === "escalated")).toEqual([
      { user_id: w.X, via: "escalated", on_behalf_of: null },
    ]);
    expect((await card(w.X, toUser)).can_act).toBe(true);
    const toAdmin = await newTask({ userIds: [w.S] });
    expect((await grants(toAdmin)).filter((r) => r.via === "escalated")).toEqual([
      { user_id: w.TA, via: "escalated", on_behalf_of: null },
    ]);
    const normal = await newTask({ userIds: [w.A] });
    expect((await grants(normal)).filter((r) => r.via === "escalated")).toEqual([]);
  });

  it("Việc của tôi: việc làm thay ẩn khi uỷ quyền hết hiệu lực", async () => {
    const d = await svc().create(who(w.A), { to_user_id: w.TA, ...span() });
    const t = await newTask({ userIds: [w.A] });
    const count = () =>
      withHubScope(db, { kind: "user", userId: w.TA, tenantId: w.T }, (tx) =>
        openTaskCount(
          tx,
          { userId: w.TA, tenantId: w.T, role: "member", groupIds: new Set() },
          1000,
        ),
      );
    const before = await count();
    await svc().revoke(who(w.A), d.id);
    expect(await count()).toBe(before - 1);
    expect((await grants(t)).some((r) => r.user_id === w.TA)).toBe(true);
  });
});
