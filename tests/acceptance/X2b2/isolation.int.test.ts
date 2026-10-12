// HUB-BR-22 · HUB-FR-44 · X2b2-R06, R18, D3–D6 · test-plan X2b2 §3.3 I23–I29b (rủi ro cao; S1, S2, S4, S5): file phòng không đi
// vào hội thoại riêng (E12 ⇒ 404, `/conversations*` không thấy, không xoá được qua `DELETE /attachments/:id`); lớp DB: FK kép
// cùng tenant/cùng phòng (23503), CHECK "một nơi" (23514), RLS ghi chỉ chủ, definer sweeper từ chối scope ≠ system (42501).
// Trước B1: ca DB kiểm `hasColumn('room_id')` trước ⇒ đỏ ở `expect`, không `PostgresError 42703`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { R, T } from "../H1/_fixtures";
import { expectAttachNotFound, insertAttachmentRow, sendWith } from "../H2c/_h2c";
import { asUser, pgCode } from "../X2a/_x2a";
import { P, settle } from "../X2b/_x2b";
import {
  attCols,
  type CtxX,
  call,
  dropUnbound,
  group,
  hasColumn,
  type Json,
  pdf,
  type Sql,
  sendFiles,
  startX2b2,
  text,
  uploadId,
} from "./_x2b2";

let c: CtxX;
beforeAll(async () => {
  c = await startX2b2();
}, 60_000);
afterEach(async () => {
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(() => c?.stop());

/** Lỗi Postgres → `{code, constraint}` (thành công ⇒ `{code:"ok"}`). */
const pgErr = (p: Promise<unknown>): Promise<{ code: string; constraint?: string }> =>
  p.then(
    () => ({ code: "ok" }),
    (e: { code?: string; constraint_name?: string; message?: string }) => ({
      code: e.code ?? String(e.message ?? e),
      constraint: e.constraint_name,
    }),
  );
/** File `x.txt` của A đã gắn vào G1 (qua API) → {room, id, msgId}. */
async function roomFile(name: string) {
  const room = await group(c, "lan", ["hoa"], name);
  const id = await uploadId(c, "lan", "x.txt", text("xin chào"));
  const s = await sendFiles(c, "lan", room, "tệp của phòng", [id]);
  return { room, id, msgId: s.res.json.id as string };
}
async function msgOfFlow(sql: Sql) {
  const [m] = await sql<
    { conversation_id: string; flow_id: string }[]
  >`select conversation_id, flow_id from hub.messages where id = ${R.msgU1}`;
  return { conv: m?.conversation_id ?? "", flow: m?.flow_id ?? "" };
}

describe("X2b2-AC13 · file phòng không vào hội thoại riêng [R06, S1]", () => {
  it("HUB-BR-22 · X2b2-AC13 · I23 · file đã gắn G1 gửi vào hội thoại riêng A (E12) ⇒ 404 ATTACHMENT_NOT_FOUND; hàng vẫn room_id=G1, message_id NULL", async () => {
    const { room, id } = await roomFile("Phòng hoá đơn I23");
    const { conv, flow } = await msgOfFlow(c.sql);
    const s = await sendWith(c.hub, await c.tok("lan"), conv, "dùng tệp phòng", [id], flow);
    s.close();
    expectAttachNotFound(s, [id]);
    const row = await attCols(c.sql, id);
    expect({ room: row?.room_id, msg: row?.message_id }).toEqual({ room, msg: null });
  });

  it("HUB-BR-22 · X2b2-AC13 · I24 · GET /conversations/:id/messages của A không chứa id file phòng", async () => {
    const { id } = await roomFile("Phòng hoá đơn I24");
    const { conv, flow } = await msgOfFlow(c.sql);
    const r = await call(c, "lan", "GET", `/conversations/${conv}/messages?flow_id=${flow}`);
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(id);
    const list = await call(c, "lan", "GET", "/conversations?limit=100");
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(id);
  });

  it("HUB-BR-22 · X2b2-AC13 · I25 · DELETE /attachments/:id (chủ A) với file đã gắn phòng ⇒ 404, hàng còn", async () => {
    const { room, id } = await roomFile("Phòng hoá đơn I25");
    expect((await call(c, "lan", "DELETE", `/attachments/${id}`)).status).toBe(404);
    expect((await attCols(c.sql, id))?.room_id).toBe(room);
  });
});

describe("S4/S5 · lớp DB (FK kép, CHECK, RLS ghi, definer) [plan §4]", () => {
  it("HUB-BR-22 · X2b2-AC02 · I26 · room_id = phòng tenant khác (beta) cho file acme ⇒ 23503 attachments_room_fk", async () => {
    expect(await hasColumn(c.sql, "attachments", "room_id")).toBe(true);
    const beta = crypto.randomUUID();
    await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
      values (${beta}, ${T.beta}, 'group', 'Phòng beta I26', 0, now(), ${P.an.id}, now())`;
    const id = await uploadId(c, "lan", "acme.pdf", pdf(2048));
    const r =
      await pgErr(c.sql`update hub.attachments set room_id = ${beta}, bound_at = now(), position = 0
      where id = ${id}`);
    expect(r).toEqual({ code: "23503", constraint: "attachments_room_fk" });
  });

  it("HUB-BR-22 · X2b2-AC02 · I27 · room_id=G1, room_message_id = tin của G2 ⇒ 23503 attachments_room_message_fk", async () => {
    expect(await hasColumn(c.sql, "attachments", "room_message_id")).toBe(true);
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I27");
    const g2 = await group(c, "lan", ["cuc"], "Phòng khác I27");
    const m2 = await call(c, "lan", "POST", `/rooms/${g2}/messages`, {
      content: "tin G2",
      client_msg_id: crypto.randomUUID(),
    });
    expect(m2.status).toBe(201);
    const id = await uploadId(c, "lan", "lech.pdf", pdf(2048));
    const r =
      await pgErr(c.sql`update hub.attachments set room_id = ${g1}, room_message_id = ${m2.json.id},
      bound_at = now(), position = 0 where id = ${id}`);
    expect(r).toEqual({ code: "23503", constraint: "attachments_room_message_fk" });
  });

  it("HUB-BR-22 · X2b2-R06 · I28 · đặt room_id cho file đã gắn hội thoại ⇒ 23514 attachments_room_bound_ck; room_message_id không room_id ⇒ 23514 attachments_room_msg_ck", async () => {
    expect(await hasColumn(c.sql, "attachments", "room_id")).toBe(true);
    const { room, msgId } = await roomFile("Phòng hoá đơn I28");
    const { conv, flow } = await msgOfFlow(c.sql);
    const bound = await insertAttachmentRow(c.sql, {
      who: "lan",
      filename: "rieng.pdf",
      bind: { messageId: R.msgU1, conversationId: conv, flowId: flow, position: 3 },
    });
    const a = await pgErr(
      c.sql`update hub.attachments set room_id = ${room} where id = ${bound.id}`,
    );
    expect(a).toEqual({ code: "23514", constraint: "attachments_room_bound_ck" });
    const free = await uploadId(c, "lan", "tu-do.pdf", pdf(2048));
    const b = await pgErr(
      c.sql`update hub.attachments set room_message_id = ${msgId} where id = ${free}`,
    );
    expect(b).toEqual({ code: "23514", constraint: "attachments_room_msg_ck" });
  });

  it("HUB-BR-22 · X2b2-AC02 · I29 · RLS ghi: C (ngoài phòng) và B (thành viên, không phải chủ) UPDATE filename file G1 ⇒ 0 hàng", async () => {
    const { id } = await roomFile("Phòng hoá đơn I29");
    const upd = (who: "cuc" | "hoa") =>
      asUser(c.sql, P[who], async (tx) => {
        const rows =
          await tx`update hub.attachments set filename = 'x' where id = ${id} returning id`;
        return rows.length;
      });
    expect({ cuc: await upd("cuc"), hoa: await upd("hoa") }).toEqual({ cuc: 0, hoa: 0 });
    expect((await attCols(c.sql, id))?.filename).toBe("x.txt");
  });

  it("HUB-BR-22 · X2b2-AC11 · I29b · hub.attach_claim_deleted_rooms(now, 10) scope user ⇒ 42501", async () => {
    const code = await asUser(c.sql, P.lan, (tx) =>
      pgCode(tx`select * from hub.attach_claim_deleted_rooms(now(), 10)`),
    );
    expect(code).toBe("42501");
    const sys = await asUser(
      c.sql,
      null,
      async (tx) =>
        (await tx<Json[]>`select * from hub.attach_claim_deleted_rooms(now(), 10)`).length,
      { scope: "system" },
    );
    expect(sys).toBeGreaterThanOrEqual(0);
  });
});
