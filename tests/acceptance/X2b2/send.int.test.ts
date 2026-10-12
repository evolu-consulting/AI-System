// HUB-FR-44 · HUB-FR-101 · X2b2-R01–R04, R14 · test-plan X2b2 §3.2 I11–I20, I22 (I21 cần engine P-a ⇒ `regress.int`):
// gắn file vào tin phòng trong cùng tx; id sai ⇒ 404 ATTACHMENT_NOT_FOUND{ids} đúng thứ tự gửi, 0 tin, 0 run; thứ tự kiểm
// plan §3 (ROOM_NOT_FOUND → zod → … → ATTACHMENT_NOT_FOUND → đường X2b); lỗi sau bước gắn ⇒ ROLLBACK, file vẫn chưa gắn;
// `client_msg_id` trùng ⇒ 200 tin cũ, không gắn lại; upload giữ luật H2c (415/413/409). Đỏ trước code: 400 strict X2a.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { R } from "../H1/_fixtures";
import { expectAttachNotFound, insertAttachmentRow, pathOf } from "../H2c/_h2c";
import { codeOf, e400, e404 } from "../X2a/_x2a";
import {
  answer,
  invoke,
  roomMsgCount,
  runCount,
  settle,
  timeline,
  waitAgentMsg,
} from "../X2b/_x2b";
import {
  age,
  attCols,
  type CtxX,
  dropUnbound,
  group,
  kick,
  pdf,
  roomFiles,
  sendFiles,
  sendRoom,
  startHubX2b2,
  startX2b2,
  upload,
  uploadId,
  waitRunStatus,
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

const DAY_MS = 86_400_000;
const roomIdOf = async (id: string) => (await attCols(c.sql, id))?.room_id ?? null;
/** File `rieng.pdf` của A đã gắn tin hội thoại riêng (fixture H1 `msgU1`) — như sau E12 thành công. */
async function privateFile(): Promise<string> {
  const [m] = await c.sql<
    { conversation_id: string; flow_id: string }[]
  >`select conversation_id, flow_id from hub.messages where id = ${R.msgU1}`;
  const r = await insertAttachmentRow(c.sql, {
    who: "lan",
    filename: "rieng.pdf",
    content: pdf(2048),
    dir: c.hub.dir,
    bind: {
      messageId: R.msgU1,
      conversationId: m?.conversation_id ?? "",
      flowId: m?.flow_id ?? "",
      position: 0,
    },
  });
  return r.id;
}

describe("X2b2-AC03 · id sai ⇒ 404 ATTACHMENT_NOT_FOUND{ids} [R02]", () => {
  it("HUB-FR-44 · X2b2-AC03 · I11 · 4 id sai (của B / đã gắn G2 / hết hạn / hội thoại riêng) + 1 id đúng ⇒ 404 ids đúng thứ tự gửi; 0 tin, 0 run; id đúng vẫn chưa gắn", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I11");
    const g2 = await group(c, "lan", ["cuc"], "Phòng khác I11");
    const ofB = await uploadId(c, "hoa", "cua-b.pdf", pdf(2048));
    const inG2 = await uploadId(c, "lan", "phongkhac.pdf", pdf(2048));
    await sendFiles(c, "lan", g2, "tệp phòng khác", [inG2]);
    const expired = await uploadId(c, "lan", "het-han.pdf", pdf(2048));
    await age(c.sql, expired, DAY_MS + 1000);
    const rieng = await privateFile();
    const okId = await uploadId(c, "lan", "dung.pdf", pdf(2048));
    const n = await roomMsgCount(c.sql, g1);
    const s = await sendRoom(c, "lan", g1, {
      content: "@hoadon xem các tệp",
      attachment_ids: [ofB, inG2, expired, rieng, okId],
    });
    expectAttachNotFound(s.res, [ofB, inG2, expired, rieng]);
    expect(await roomMsgCount(c.sql, g1)).toBe(n);
    expect(await runCount(c.sql, g1)).toBe(0);
    expect(await roomIdOf(okId)).toBeNull();
    expect(await roomIdOf(inG2)).toBe(g2);
  });

  it("HUB-FR-44 · X2b2-AC03 · I12 · id có nội dung mất (purged_at + xoá file trên đĩa) ⇒ 404 ATTACHMENT_NOT_FOUND", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I12");
    const ok = await uploadId(c, "lan", "doi-chung.pdf", pdf(2048));
    await sendFiles(c, "lan", g1, "đối chứng I12", [ok]);
    const id = await uploadId(c, "lan", "mat.pdf", pdf(2048));
    const key = String((await attCols(c.sql, id))?.storage_key ?? "");
    await c.sql`update hub.attachments set purged_at = now() where id = ${id}`;
    await rm(pathOf(c.hub.dir, key), { force: true });
    const s = await sendRoom(c, "lan", g1, { content: "tệp mất", attachment_ids: [id] });
    expectAttachNotFound(s.res, [id]);
  });

  it("HUB-FR-44 · X2b2-AC03 · I13 · 2 POST song song (client_msg_id khác) cùng id ⇒ 1 × 201, 1 × 404; file gắn đúng 1 tin; +1 tin", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I13");
    const id = await uploadId(c, "lan", "dua.pdf", pdf(2048));
    const n = await roomMsgCount(c.sql, g1);
    const rs = await Promise.all([
      sendRoom(c, "lan", g1, { content: "lượt 1", attachment_ids: [id] }),
      sendRoom(c, "lan", g1, { content: "lượt 2", attachment_ids: [id] }),
    ]);
    expect(rs.map((r) => r.res.status).sort()).toEqual([201, 404]);
    const lost = rs.find((r) => r.res.status === 404)?.res;
    expect(lost && codeOf(lost)).toEqual({ status: 404, code: "ATTACHMENT_NOT_FOUND" });
    const win = rs.find((r) => r.res.status === 201);
    const files = await roomFiles(c.sql, g1);
    expect(files.map((f) => [f.id, f.room_message_id])).toEqual([[id, win?.res.json.id]]);
    expect(await roomMsgCount(c.sql, g1)).toBe(n + 1);
  });
});

describe("X2b2-AC04 · thứ tự kiểm [R03, plan §3]", () => {
  it("HUB-BR-22 · X2b2-AC04 · I14 · C (ngoài G1) gửi G1 + id sai ⇒ 404 ROOM_NOT_FOUND (không lộ file)", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I14");
    const s = await sendRoom(c, "cuc", g1, {
      content: "người ngoài",
      attachment_ids: ["a2b20000-0000-4000-8000-000000000014"],
    });
    expect(codeOf(s.res)).toEqual(e404);
  });

  it("HUB-FR-44 · X2b2-AC04 · I15 · '@khongco xem' + id sai ⇒ 404 ATTACHMENT_NOT_FOUND (trước AGENT_NOT_FOUND)", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I15");
    const bad = "a2b20000-0000-4000-8000-000000000015";
    const s = await sendRoom(c, "lan", g1, { content: "@khongco xem", attachment_ids: [bad] });
    expectAttachNotFound(s.res, [bad]);
  });

  it("HUB-FR-101 · X2b2-AC04 · I16 · A đang 2 run ⇒ '@hoadon xem' + id ⇒ 429 TOO_MANY_RUNS, file chưa gắn; run xong gửi lại ⇒ 201, gắn", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I16");
    const busy = await group(c, "lan", [], "Phòng bận I16");
    const r1 = await invoke(c, "lan", busy, "@hoadon việc 1");
    await invoke(c, "lan", busy, "@hoadon việc 2");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(4096));
    const s = await sendRoom(c, "lan", g1, { content: "@hoadon xem", attachment_ids: [id] });
    expect(codeOf(s.res)).toEqual({ status: 429, code: "TOO_MANY_RUNS" });
    expect(await roomIdOf(id)).toBeNull();
    await answer(c, r1.runId, "Xong việc 1.");
    await waitRunStatus(c.sql, r1.runId, ["finished"]);
    const again = await sendFiles(c, "lan", g1, "@hoadon xem", [id]);
    expect(again.runId ?? "").not.toBe("");
    expect(await roomIdOf(id)).toBe(g1);
  });

  it("HUB-FR-44 · X2b2-R14 · I22 · A upload, A bị bớt khỏi G1, A gửi G1 + id ⇒ 404 ROOM_NOT_FOUND; file chưa gắn", async () => {
    const g1 = await group(c, "hoa", ["lan"], "Phòng hoá đơn I22");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    expect((await kick(c, "hoa", g1, "lan")).status).toBe(204);
    const s = await sendRoom(c, "lan", g1, { content: "vẫn gửi", attachment_ids: [id] });
    expect(codeOf(s.res)).toEqual(e404);
    expect(await roomIdOf(id)).toBeNull();
  });
});

describe("X2b2-AC05 · validate + idempotent + luật upload [R04]", () => {
  it("HUB-FR-44 · X2b2-AC05 · I17 · 11 id / trùng / trùng khác hoa-thường / content rỗng + id / [] ⇒ 400 VALIDATION_ERROR ×5, 0 tin; đối chứng 1 id ⇒ 201", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I17");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    const eleven = Array.from({ length: 11 }, () => crypto.randomUUID());
    const n = await roomMsgCount(c.sql, g1);
    const bodies: [string, Record<string, unknown>][] = [
      ["11 id", { content: "x", attachment_ids: eleven }],
      ["trùng", { content: "x", attachment_ids: [id, id] }],
      ["trùng khác hoa/thường", { content: "x", attachment_ids: [id, id.toUpperCase()] }],
      ["content rỗng", { content: "", attachment_ids: [id] }],
      ["mảng rỗng", { content: "x", attachment_ids: [] }],
    ];
    for (const [label, b] of bodies) {
      const s = await sendRoom(c, "lan", g1, b as never);
      expect({ label, ...codeOf(s.res) }).toEqual({ label, ...e400 });
    }
    expect(await roomMsgCount(c.sql, g1)).toBe(n);
    expect(await roomIdOf(id)).toBeNull();
    await sendFiles(c, "lan", g1, "đối chứng I17", [id]);
  });

  it("HUB-FR-44 · X2b2-AC05 · I18 · gửi lại cùng client_msg_id + id ⇒ 200 cùng tin, attachments như cũ; bound_at không đổi; 1 hàng gắn", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I18");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    const client_msg_id = crypto.randomUUID();
    const body = { content: "gửi một lần", attachment_ids: [id], client_msg_id };
    const first = await sendRoom(c, "lan", g1, body);
    expect(first.res.status).toBe(201);
    const bound = (await attCols(c.sql, id))?.bound_at;
    const again = await sendRoom(c, "lan", g1, body);
    expect(again.res.status).toBe(200);
    expect(again.res.json.id).toBe(first.res.json.id);
    expect(again.res.json.attachments).toEqual(first.res.json.attachments);
    expect((await attCols(c.sql, id))?.bound_at).toBe(bound);
    expect((await roomFiles(c.sql, g1)).map((f) => f.id)).toEqual([id]);
  });

  it("HUB-FR-44 · X2b2-AC05 · I19 · upload .exe ⇒ 415; 20 MiB + 1 ⇒ 413; vượt hạn mức tenant ⇒ 409 (hồi quy H2c)", async () => {
    const exe = await upload(c, "lan", "cai-dat.exe", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]));
    expect(codeOf(exe)).toEqual({ status: 415, code: "ATTACHMENT_TYPE_NOT_ALLOWED" });
    const big = await upload(c, "lan", "lon.pdf", pdf(20 * 1_048_576 + 1));
    expect(codeOf(big)).toEqual({ status: 413, code: "ATTACHMENT_TOO_LARGE" });
    const full = await startHubX2b2(c.k, { tenantMaxBytes: 1, instanceId: "qc-x2b2-quota" });
    try {
      const r = await upload({ ...c, hub: full }, "lan", "nho.pdf", pdf(2048));
      expect(codeOf(r)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    } finally {
      await full.stop();
    }
  });

  it("HUB-FR-44 · X2b2-R04 · I20 · tin thread (flow_id) + file ⇒ 201; ?flow_id= có attachments; timeline không có tin", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I20");
    const s = await invoke(c, "lan", g1, "@hoadon kiểm tra HD-20");
    await answer(c, s.runId, "HD-20 hợp lệ.");
    expect(await waitAgentMsg(c, "lan", g1, s.runId)).toBeDefined();
    const T = s.flowId as string;
    const id = await uploadId(c, "hoa", "bo-sung.pdf", pdf(2048));
    const m = await sendFiles(c, "hoa", g1, "bổ sung chứng từ", [id], T);
    const inThread = (await timeline(c, "lan", g1, `?flow_id=${T}`)).find(
      (x) => x.id === m.res.json.id,
    );
    expect(inThread?.attachments?.map((a: { id: string }) => a.id)).toEqual([id]);
    expect((await timeline(c, "lan", g1)).some((x) => x.id === m.res.json.id)).toBe(false);
  });
});
