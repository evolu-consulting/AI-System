// [AUDIT] · «duyệt hợp lệ thì giữ — lỗi bước SAU hiện ở thẻ riêng»: quyết task duyệt đã COMMIT mà khởi động bước kế ném lỗi ⇒ trả kết quả
// bình thường (không báo như duyệt lỗi), task đóng, lượt ⇒ «Cần xử lý» `start_failed` (Thử lại / Huỷ). Run gắn gói, quyết đi đường chung
// ⇒ báo gói ghi lịch sử (`packDecided`); quyết từ thẻ gói (`hooks`) ⇒ không báo (thẻ tự ghi). Người quyết (A) ≠ người gửi (S).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { PackDecidedEvent, ProcessDeps } from "../core/ports";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { GateService } from "./gates.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(seen: PackDecidedEvent[]): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    launcher: {
      kick: async () => {
        throw Object.assign(new Error("tool lỗi"), { code: "TOOL_FAILED" });
      },
    },
    postThread: async () => {},
    now: () => new Date(),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    packDecided: async (e: PackDecidedEvent) => {
      seen.push(e);
    },
  } as unknown as ProcessDeps;
}
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;

/** Lượt 2 bước gắn gói `contracts`: bước 1 (task mở giao phòng G) Đạt ⇒ phải kick bước 2. */
async function twoStepTask() {
  const t = await groupTask(o, w, w.G);
  const stages = [
    { key: "duyet", name: "Duyệt", step: 0, after: { kind: "review", group_id: null } },
    { key: "ky", name: "Ký", step: 1, after: { kind: "review", group_id: null } },
  ];
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`; // trigger khoá `pack_key` (chỉ gắn lúc tạo lượt)
    await tx`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid(),
        snapshot = jsonb_set(snapshot, '{stages}', ${o.json(stages as never)}) where id = ${t.runId}`;
  });
  return t;
}
const runRow = async (id: string) =>
  (
    await o<
      { status: string; reason: string | null }[]
    >`select status, decision ->> 'reason' as reason
      from hub.process_runs where id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1291);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("[AUDIT] quyết đã COMMIT ⇒ không báo lỗi; lịch sử gói", () => {
  it("Đạt qua đường chung, kick bước kế ném ⇒ trả task đóng, lượt «Cần xử lý» start_failed, gói nhận 1 sự kiện", async () => {
    const { taskId, runId } = await twoStepTask();
    const seen: PackDecidedEvent[] = [];
    const detail = await new GateService(deps(seen)).reviewDecision(who(w.A), taskId, {
      result: "pass",
      feedback: "  Đồng ý  ",
    } as never);
    expect(detail.status).toBe("closed");
    expect(await runRow(runId)).toEqual({ status: "needs_decision", reason: "start_failed" });
    expect(seen).toEqual([
      {
        tenantId: w.T,
        packKey: "contracts",
        runId,
        taskId,
        stageKey: "duyet",
        result: "pass",
        feedback: "Đồng ý",
        actor: w.A,
        evidenceId: null,
      },
    ]);
  });

  it("quyết từ thẻ gói (`hooks`) ⇒ không báo gói (thẻ tự ghi); vẫn không ném", async () => {
    const { taskId } = await twoStepTask();
    const seen: PackDecidedEvent[] = [];
    const detail = await new GateService(deps(seen)).reviewDecision(
      who(w.A),
      taskId,
      { result: "pass" } as never,
      undefined,
      {},
    );
    expect(detail.status).toBe("closed");
    expect(seen).toEqual([]);
  });
});
