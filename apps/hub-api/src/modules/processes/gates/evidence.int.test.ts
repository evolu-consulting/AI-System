// CR-127 · E4 · spec §5.3 · BR-26 · int (DB thật, role `hub_api`): quyết định kèm bằng chứng ⇒ lưu + đọc lại; bước bật "Ý kiến + chữ ký hoặc
// tệp" mà Duyệt thiếu ⇒ 422 EVIDENCE_REQUIRED (task vẫn mở, không ghi gì); người chỉ xem không nhận id bằng chứng; tenant khác không đọc được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { evidenceReadable, redactHistoryEvidence } from "../domain/runs/run-redact.rules";
import { loadHistory } from "../runs/history.repo";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { GateService } from "./gates.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
let T2: string;

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    launcher: { kick: async () => {} },
    postThread: async () => {},
    now: () => new Date(),
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
const PLUS = { kind: "review", group_id: null, evidence: "opinion_plus" };

async function attachment(): Promise<string> {
  const id = crypto.randomUUID();
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${w.T}, ${w.A}, 'upload', 'bb.pdf', 'bb.pdf', 'application/pdf', 1000, ${"a".repeat(64)}, ${`${w.T}/${id}`})`;
  });
  return id;
}
const evCount = async (taskId: string) =>
  Number(
    (
      await o<{ n: number }[]>`select count(*)::int as n from hub.evidence
        where subject_kind = 'task_decision' and subject_id = ${taskId}`
    )[0]?.n,
  );
const taskRow = async (taskId: string) =>
  (
    await o<
      { status: string; feedback: string | null }[]
    >`select status, feedback from hub.review_tasks where id = ${taskId}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1274);
  [T2] = (await tenants(o, 1, 1275)) as [string];
  db = connectDb(urls().hubApi, 6);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E4 · bằng chứng khi quyết định", () => {
  it("thiếu bằng chứng: Duyệt ở bước opinion_plus không kèm / chỉ có ý kiến ⇒ 422 EVIDENCE_REQUIRED, task vẫn mở, không ghi bằng chứng", async () => {
    const { taskId } = await groupTask(o, w, w.G, PLUS);
    const gates = new GateService(deps());
    const none = await err(gates.reviewDecision(who(w.A), taskId, { result: "pass" } as never));
    expect([none?.code, none?.status]).toEqual(["EVIDENCE_REQUIRED", 422]);
    const noteOnly = await err(
      gates.reviewDecision(who(w.A), taskId, { result: "pass", evidence: { note: "ok" } } as never),
    );
    expect(noteOnly?.code).toBe("EVIDENCE_REQUIRED");
    expect([(await taskRow(taskId))?.status, await evCount(taskId)]).toEqual(["open", 0]);
  });

  it("có bằng chứng: lưu cùng lúc đóng task + đọc lại (evidence_get, lịch sử); tenant khác không đọc được", async () => {
    const { taskId, runId } = await groupTask(o, w, w.G, PLUS);
    const file = await attachment();
    let evId = "";
    const detail = await new GateService(deps()).reviewDecision(
      who(w.A),
      taskId,
      {
        result: "pass",
        evidence: { note: "Đã đối chiếu điều khoản", attachment_ids: [file] },
      } as never,
      undefined,
      { onEvidence: (id) => (evId = id) },
    );
    expect(detail.status).toBe("closed");
    expect(evId).not.toBe("");
    expect(await evCount(taskId)).toBe(1);
    const read = (tenantId: string, userId: string) =>
      withHubScope(db, { kind: "user", tenantId, userId }, (tx) =>
        tx.execute<{
          note: string;
          by_user: string;
          attachment_ids: string[];
          on_behalf_of: string | null;
        }>(
          sql`select note, by_user::text, attachment_ids::text[], on_behalf_of::text from hub.evidence_get(array[${evId}]::uuid[])`,
        ),
      );
    const mine = [...(await read(w.T, w.A))];
    expect(mine).toHaveLength(1);
    expect([
      mine[0]?.note,
      mine[0]?.by_user,
      mine[0]?.attachment_ids,
      mine[0]?.on_behalf_of,
    ]).toEqual(["Đã đối chiếu điều khoản", w.A, [file], null]);
    expect([...(await read(T2, w.A))]).toHaveLength(0); // tenant khác ⇒ rỗng
    // Lịch sử của run mang `evidence_id`; người chỉ xem (không phải người gửi/được giao/quản trị) không nhận.
    const hist = await withHubScope(db, { kind: "user", tenantId: w.T, userId: w.A }, (tx) =>
      loadHistory(tx, runId, w.T),
    );
    expect(hist.find((h) => h.kind === "review")?.evidence_id).toBe(evId);
    const base = { tenantId: w.T, startedBy: w.S, taskAssignee: false };
    const viewOnly = { userId: w.X, tenantId: w.T, role: "member" as const };
    expect(evidenceReadable(viewOnly, base)).toBe(false);
    expect(redactHistoryEvidence(hist, false).some((h) => h.evidence_id)).toBe(false);
    expect(evidenceReadable({ ...viewOnly, userId: w.S }, base)).toBe(true); // người gửi
    expect(evidenceReadable({ ...viewOnly, userId: w.TA, role: "tenant_admin" }, base)).toBe(true);
    expect(evidenceReadable({ ...viewOnly, tenantId: T2, role: "tenant_admin" }, base)).toBe(false);
  });

  it("bước chỉ ý kiến: Duyệt không bắt buộc bằng chứng; Từ chối cần ý kiến (feedback hoặc evidence.note)", async () => {
    const gates = new GateService(deps());
    const a = await groupTask(o, w, w.G, { kind: "review", group_id: null, evidence: "opinion" });
    expect(
      (await gates.reviewDecision(who(w.A), a.taskId, { result: "pass" } as never)).status,
    ).toBe("closed");
    const b = await groupTask(o, w, w.G);
    const miss = await err(gates.reviewDecision(who(w.A), b.taskId, { result: "reject" } as never));
    expect(miss?.code).toBe("FEEDBACK_REQUIRED");
    await gates.reviewDecision(who(w.A), b.taskId, {
      result: "reject",
      evidence: { note: "Sai giá" },
    } as never);
    // Ý kiến của bằng chứng KHÔNG chép sang `feedback` (BR-26): task không có lý do công khai nào.
    expect([(await taskRow(b.taskId))?.feedback, await evCount(b.taskId)]).toEqual([null, 1]);
  });

  it("người chỉ xem không thấy ý kiến ở lịch sử run (feedback + evidence_id); người đã quyết vẫn thấy", async () => {
    const { taskId, runId } = await groupTask(o, w, w.G);
    await new GateService(deps()).reviewDecision(who(w.A), taskId, {
      result: "reject",
      feedback: "Lý do công khai",
      evidence: { note: "Ý KIẾN MẬT" },
    } as never);
    const hist = await withHubScope(db, { kind: "user", tenantId: w.T, userId: w.X }, (tx) =>
      loadHistory(tx, runId, w.T),
    );
    const row = hist.find((h) => h.kind === "review");
    expect([row?.feedback, !!row?.evidence_id]).toEqual(["Lý do công khai", true]); // dữ liệu gốc
    const hidden = redactHistoryEvidence(hist, false);
    expect(JSON.stringify(hidden)).not.toContain("Ý KIẾN MẬT");
    expect(hidden.find((h) => h.kind === "review")).not.toHaveProperty("evidence_id");
    expect(hidden.find((h) => h.kind === "review")).not.toHaveProperty("feedback");
    const base = { tenantId: w.T, startedBy: w.S, taskAssignee: false };
    const viewer = { userId: w.X, tenantId: w.T, role: "member" as const };
    expect(evidenceReadable(viewer, { ...base, decidedBy: new Set([w.A]) })).toBe(false);
    expect(
      evidenceReadable({ ...viewer, userId: w.A }, { ...base, decidedBy: new Set([w.A]) }),
    ).toBe(true);
  });
});
