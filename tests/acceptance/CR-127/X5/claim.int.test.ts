// CR-127 · X5 · spec §5.9 · BR-40: xác nhận mốc là việc nhóm — `recordFulfillment` đọc người giữ việc (`hub.task_holder`) và ghi tín hiệu đóng việc
// (`hub.task_signal`) CÙNG tx. Người khác khi mốc đã có người nhận ⇒ 409 TASK_CLAIMED{by}; chưa ai nhận ⇒ 409 TASK_NOT_CLAIMED; người nhận /
// quản trị công ty ghi được; xong ⇒ tín hiệu `done`; dời hạn ⇒ tín hiệu `cancelled` (một); công ty không có việc ⇒ đường cũ; ≤ 7 câu SQL.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql } from "../../HD1/_support/hd1";
import { arrangeV2d, type CtxN1, call, d, deal, ok, P, startHd1, T } from "../../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const ev = { note: "Đã nhận đủ chứng từ" };
const fulfill = (who: typeof P.hoa | typeof P.lan, id: string) =>
  call(c, who, "POST", `/obligations/${id}/fulfill`, { evidence: ev });
const code = (r: { json?: { error?: { code?: string }; code?: string } }) =>
  r.json?.error?.code ?? r.json?.code;

/** HĐ bán + một đợt thu (dựng bằng owner, bỏ RLS). */
async function mốc() {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done" });
  const [r] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, direction, kind, seq, due_date, amount, owner, source)
    values (${T.acme}, ${k}, 'receive', 'payment', 1, ${d(5)}::date, 1000000, 'partner', 'manual') returning id::text`;
  return { k, ob: (r as { id: string }).id };
}
/**
 * Việc «Xác nhận mốc» đang mở của mốc (hàng hub dựng thẳng, bỏ FK bằng `session_replication_role` — engine mở việc là phạm vi E10): giao cho
 * `assignees`, `claimedBy` = người đã Nhận việc (null = chưa ai nhận).
 */
async function việc(ob: string, o: { assignees: string[]; claimedBy: string | null }) {
  const id = crypto.randomUUID();
  await c.sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`insert into hub.review_tasks (id, tenant_id, process_run_id, stage_run_id, kind, status, remind_at, subject_ref, claimed_by, claimed_at)
      values (${id}, ${T.acme}, ${crypto.randomUUID()}, ${crypto.randomUUID()}, 'milestone', 'open', now() + interval '1 day', ${ob},
        ${o.claimedBy}, ${o.claimedBy ? new Date() : null})`;
    for (const u of o.assignees)
      await t`insert into hub.review_task_assignees (tenant_id, task_id, user_id) values (${T.acme}, ${id}, ${u})`;
  });
  return id;
}
const signals = (ob: string) =>
  c.sql<{ result: string; processed_at: string | null }[]>`select result, processed_at::text
    from hub.task_signals where tenant_id = ${T.acme} and kind = 'milestone' and subject_ref = ${ob} order by created_at`;
const status = async (ob: string) =>
  (await c.sql<{ s: string }[]>`select status as s from contracts.obligations where id = ${ob}`)[0]
    ?.s;

describe("CR-127 X5 · xác nhận mốc là việc nhóm", () => {
  it("công ty không có việc cho mốc ⇒ đường cũ: ghi được, tín hiệu done (idempotent, engine bỏ qua khi không có việc)", async () => {
    const { ob } = await mốc();
    const r = await call(c, P.hoa, "POST", `/obligations/${ob}/fulfill`, { evidence: ev });
    expect(r.status).toBe(200);
    expect(await status(ob)).toBe("done");
    expect((await signals(ob)).map((s) => s.result)).toEqual(["done"]);
  });

  it("mốc đã có người nhận ⇒ người khác 409 TASK_CLAIMED{by}, mốc vẫn mở, chưa có tín hiệu", async () => {
    const { ob } = await mốc();
    await việc(ob, { assignees: [P.hoa.id, P.tam.id], claimedBy: P.tam.id });
    const r = await fulfill(P.hoa, ob);
    expect([r.status, code(r)]).toEqual([409, "TASK_CLAIMED"]);
    expect(r.json?.error?.details?.by ?? r.json?.details?.by).toBe(P.tam.id);
    expect(await status(ob)).toBe("open");
    expect([...(await signals(ob))]).toEqual([]);
  });

  it("chưa ai nhận ⇒ 409 TASK_NOT_CLAIMED; nhận việc xong ⇒ ghi được + tín hiệu done", async () => {
    const { ob } = await mốc();
    const t = await việc(ob, { assignees: [P.hoa.id], claimedBy: null });
    const r = await fulfill(P.hoa, ob);
    expect([r.status, code(r)]).toEqual([409, "TASK_NOT_CLAIMED"]);
    await c.sql`update hub.review_tasks set claimed_by = ${P.hoa.id}, claimed_at = now() where id = ${t}`;
    expect((await fulfill(P.hoa, ob)).status).toBe(200);
    expect(await status(ob)).toBe("done");
    expect((await signals(ob)).map((s) => s.result)).toEqual(["done"]);
  });

  it("quản trị công ty ghi được dù mốc đang do người khác xử lý", async () => {
    const { ob } = await mốc();
    await việc(ob, { assignees: [P.hoa.id], claimedBy: P.hoa.id });
    expect((await fulfill(P.lan, ob)).status).toBe(200);
    expect(await status(ob)).toBe("done");
  });

  it("dời hạn ⇒ tín hiệu cancelled (một hàng chờ, không trùng); danh sách mốc trả task đang xử lý", async () => {
    const { k, ob } = await mốc();
    await việc(ob, { assignees: [P.hoa.id], claimedBy: null });
    const list = await ok(call(c, P.hoa, "GET", `/obligations?contract_id=${k}`));
    expect(list[0].task).toMatchObject({ state: "unclaimed", claimed_by: null });
    const to = d(12);
    const r = await call(c, P.lan, "POST", `/obligations/${ob}/postpone`, { to, evidence: ev });
    expect(r.status).toBe(200);
    await call(c, P.lan, "POST", `/obligations/${ob}/postpone`, { to: d(20), evidence: ev });
    const s = await signals(ob);
    expect(s.every((x) => x.result === "cancelled")).toBe(true);
    expect(s.filter((x) => x.processed_at === null).length).toBe(1);
  });

  it("tách mốc (split) ⇒ việc của mốc gốc vẫn mở, không có tín hiệu", async () => {
    const { ob } = await mốc();
    const t = await việc(ob, { assignees: [P.hoa.id], claimedBy: null });
    const r = await call(c, P.lan, "POST", `/obligations/${ob}/change-requests`, {
      kind: "split",
      payload: { due_date: d(30), amount: 400_000 },
      evidence: ev,
    });
    expect(r.status).toBeLessThan(300);
    expect([...(await signals(ob))]).toEqual([]);
    const [row] = await c.sql<
      { s: string }[]
    >`select status as s from hub.review_tasks where id = ${t}`;
    expect(row?.s).toBe("open");
  });

  it("Luật 4c: ghi thực hiện có việc nhóm ≤ 7 câu SQL (đã gồm đọc người giữ + 1 tín hiệu)", async () => {
    const { ob } = await mốc();
    await việc(ob, { assignees: [P.hoa.id], claimedBy: P.hoa.id });
    const cap = await captureSql(c, () => fulfill(P.hoa, ob));
    expect((cap.r as { status: number }).status).toBe(200);
    const qs = cap.queries.filter((q) => !/set_config/.test(q.text));
    console.log(`X5 fulfill (có việc nhóm) = ${qs.length} câu`);
    expect(qs.length).toBeLessThanOrEqual(7);
  });
});
