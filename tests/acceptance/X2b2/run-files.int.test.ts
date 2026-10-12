// HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b2-R07–R10, R15 · test-plan X2b2 §3.4 I30, I31, I33–I41 (rủi ro cao; S3; I32 bỏ —
// sandbox theo job đã phủ ở H2c `files.stack.test.ts`): tập file run phòng = file của tin gọi + cửa sổ ngữ cảnh X2b-R07 (timeline
// ≤ 20, thread ≤ 50 + ≤ 20 timeline trước gốc), CHỈ phòng đó, mới nhất trước, ≤ 10; chốt lúc tạo run (`runs.attachment_ids`);
// Runtime tải qua endpoint nội bộ bằng token job (`jobFetch`); quyền/usage của người tag. Đỏ trước code: gửi tin phòng có file
// ⇒ 400 strict X2a (ở `sendFiles`), run phòng `attachment_ids = {}`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { R } from "../H1/_fixtures";
import { insertAttachmentRow, sha256 } from "../H2c/_h2c";
import { say } from "../X2a/_x2a";
import {
  answer,
  invoke,
  P,
  roomRuns,
  roomUsage,
  runCount,
  settle,
  waitAgentMsg,
} from "../X2b/_x2b";
import {
  type CtxX,
  dropUnbound,
  finishWith,
  getContent,
  group,
  HOADON,
  type Json,
  jobFetch,
  jobOutput,
  leave,
  pdf,
  runFiles,
  sendFiles,
  sendRoom,
  startX2b2,
  text,
  uploadId,
  type Who,
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

/** Upload + gửi 1 file vào phòng; trả id file. */
async function shareFile(
  who: Who,
  room: string,
  name: string,
  content = "tệp kèm",
  flowId?: string,
) {
  const id = await uploadId(c, who, name, pdf(2048));
  await sendFiles(c, who, room, content, [id], flowId);
  return id;
}
const payloadIds = (p: Json): string[] => ((p.attachments ?? []) as Json[]).map((a) => a.id);

describe("X2b2-AC06 · agent nhận file phòng qua job [R07, FR-101]", () => {
  it("HUB-FR-101 · X2b2-AC06 · I30 · A gửi hoadon.pdf rồi '@hoadon kiểm tra file' ⇒ runs.attachment_ids=[file]; payload.attachments 1; jobFetch đúng byte; B thấy tin agent", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I30");
    const bytes = HOADON();
    const id = await uploadId(c, "lan", "hoadon.pdf", bytes);
    await sendFiles(c, "lan", room, "đây là hoá đơn", [id]);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra file");
    expect(await runFiles(c.sql, s.runId)).toEqual([id]);
    const job = await c.rt.next(s.runId);
    const atts = ((job.payload as unknown as Json).attachments ?? []) as Json[];
    expect(atts.map((a) => [a.id, a.name, a.sha256])).toEqual([[id, "hoadon.pdf", sha256(bytes)]]);
    const r = await jobFetch(c, job, id);
    expect(r.status).toBe(200);
    expect(sha256(r.bytes)).toBe(sha256(bytes));
    await finishWith(c, job, "Hoá đơn hợp lệ.", []);
    expect(await waitAgentMsg(c, "hoa", room, s.runId)).toBeDefined();
  });
});

describe("X2b2-AC07 · chỉ file của phòng này [R08, S3]", () => {
  it("HUB-BR-22 · X2b2-AC07 · I31 · rieng.pdf (hội thoại riêng), phongkhac.pdf (G2), chuagan.pdf (chưa gắn) KHÔNG vào file-set run G1", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I31");
    const g2 = await group(c, "lan", ["cuc"], "Phòng khác I31");
    const [m] = await c.sql<
      { conversation_id: string; flow_id: string }[]
    >`select conversation_id, flow_id from hub.messages where id = ${R.msgU1}`;
    const rieng = await insertAttachmentRow(c.sql, {
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
    const other = await shareFile("lan", g2, "phongkhac.pdf");
    const free = await uploadId(c, "lan", "chuagan.pdf", pdf(2048));
    const mine = await shareFile("lan", g1, "g1.pdf");
    const s = await invoke(c, "lan", g1, "@hoadon xem");
    expect(await runFiles(c.sql, s.runId)).toEqual([mine]);
    const job = await c.rt.next(s.runId);
    const ids = payloadIds(job.payload as unknown as Json);
    expect(ids).toEqual([mine]);
    for (const x of [rieng.id, other, free]) expect(ids).not.toContain(x);
  });

  it("HUB-BR-21 · X2b2-AC07 · I33 · jobFetch bằng token job của run G2 xin file G1 ⇒ 401; token rác ⇒ 401 (đối chứng: token đúng ⇒ 200)", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I33");
    const g2 = await group(c, "lan", ["cuc"], "Phòng khác I33");
    const f1 = await shareFile("lan", g1, "g1.pdf");
    const r1 = await invoke(c, "lan", g1, "@hoadon xem g1");
    const r2 = await invoke(c, "lan", g2, "@hoadon xem g2");
    const j1 = await c.rt.next(r1.runId);
    const j2 = await c.rt.next(r2.runId);
    expect((await jobFetch(c, j1, f1)).status).toBe(200);
    expect((await jobFetch(c, j2, f1)).status).toBe(401);
    expect((await jobFetch(c, j1, f1, "token-rac-khong-hop-le")).status).toBe(401);
  });
});

describe("X2b2-AC08 · cửa sổ ngữ cảnh [R07, D9]", () => {
  it("HUB-FR-101 · X2b2-AC08 · I34 · 30 tin, file ở tin 3 (ngoài 20) ⇒ không vào file-set; file ở tin 25 ⇒ vào", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I34");
    const lan = await c.tok("lan");
    let f3 = "";
    let f25 = "";
    for (let i = 1; i <= 30; i++) {
      if (i === 3) f3 = await shareFile("lan", room, "tin3.pdf", `tin ${i}`);
      else if (i === 25) f25 = await shareFile("lan", room, "tin25.pdf", `tin ${i}`);
      else await say(c.hub, lan, room, `tin ${i}`);
    }
    const s = await invoke(c, "lan", room, "@hoadon xem");
    const got = await runFiles(c.sql, s.runId);
    expect(got).toEqual([f25]);
    expect(got).not.toContain(f3);
  });

  it("HUB-FR-101 · X2b2-AC08 · I35 · thread: file ở tin thread #5 và file ở tin timeline ngay trước tin gốc ⇒ cả hai vào file-set (thread mới trước)", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I35");
    const before = await shareFile("lan", room, "truoc-goc.pdf", "chứng từ trước gốc");
    const root = await invoke(c, "lan", room, "@hoadon kiểm tra HD-35");
    await answer(c, root.runId, "HD-35 hợp lệ.");
    expect(await waitAgentMsg(c, "lan", room, root.runId)).toBeDefined();
    const T = root.flowId as string;
    for (let i = 1; i <= 4; i++)
      expect(
        (await sendRoom(c, "hoa", room, { content: `thread ${i}`, flow_id: T })).res.status,
      ).toBe(201);
    const inThread = await shareFile("hoa", room, "thread5.pdf", "thread 5", T);
    const s = await sendRoom(c, "lan", room, { content: "@hoadon tiếp", flow_id: T });
    expect(s.res.status).toBe(201);
    expect(s.runId ?? "").not.toBe("");
    expect(await runFiles(c.sql, s.runId ?? "")).toEqual([inThread, before]);
  });

  it("HUB-FR-101 · X2b2-AC08 · I36 · 12 tin có file trong cửa sổ + tin gọi có file ⇒ 10 file: file tin gọi đầu, rồi 9 mới nhất", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I36");
    const fs: string[] = [];
    for (let i = 1; i <= 12; i++) fs.push(await shareFile("lan", room, `f${i}.pdf`, `tệp ${i}`));
    const trig = await uploadId(c, "lan", "goi.pdf", pdf(2048));
    const s = await sendFiles(c, "lan", room, "@hoadon xem hết", [trig]);
    expect(s.runId ?? "").not.toBe("");
    const want = [trig, ...fs.slice(3).reverse()];
    expect(await runFiles(c.sql, s.runId ?? "")).toEqual(want);
  });

  it("HUB-FR-101 · X2b2-AC08 · I37 · tin có file gửi SAU tin gọi (run đang chờ) ⇒ không vào runs.attachment_ids", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I37");
    const f1 = await shareFile("lan", room, "truoc.pdf", "tệp trước");
    const s = await invoke(c, "lan", room, "@hoadon xem");
    await shareFile("hoa", room, "sau.pdf", "tệp sau");
    expect(await runFiles(c.sql, s.runId)).toEqual([f1]);
  });
});

describe("X2b2-AC09 · người tag ≠ người gửi file [R09, R10]", () => {
  it("HUB-BR-21 · X2b2-AC09 · I38 · B gọi '@trello xem' dùng file A ⇒ file-set có file A; runs.user_id=B; usage B tăng, A không; không phụ thuộc số file", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I38");
    const fa = await shareFile("lan", room, "cua-a.pdf");
    const s = await invoke(c, "hoa", room, "@trello xem");
    expect(await runFiles(c.sql, s.runId)).toEqual([fa]);
    expect((await roomRuns(c.sql, room)).find((r) => r.id === s.runId)?.user_id).toBe(P.hoa.id);
    await answer(c, s.runId, "Đã tạo thẻ.");
    await waitRunStatus(c.sql, s.runId, ["finished"]);
    const plain = await group(c, "hoa", [], "Phòng không file I38");
    const p = await invoke(c, "hoa", plain, "@trello xem");
    await answer(c, p.runId, "Đã tạo thẻ.");
    await waitRunStatus(c.sql, p.runId, ["finished"]);
    expect(await roomUsage(c.sql, room, P.hoa.id)).toBeGreaterThan(0);
    expect(await roomUsage(c.sql, room, P.lan.id)).toBe(0);
    expect(await roomUsage(c.sql, room, P.hoa.id)).toBe(await roomUsage(c.sql, plain, P.hoa.id));
  });

  it("HUB-BR-21 · X2b2-AC09 · I39 · B gọi, B rời G1 khi run chạy ⇒ run cancelled, không tin agent; file còn, A tải 200", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I39");
    const fa = await shareFile("lan", room, "cua-a.pdf");
    const s = await invoke(c, "hoa", room, "@trello xem");
    expect(await runFiles(c.sql, s.runId)).toEqual([fa]);
    await c.rt.next(s.runId);
    expect((await leave(c, "hoa", room)).status).toBe(204);
    expect(await waitRunStatus(c.sql, s.runId, ["cancelled"])).toBe("cancelled");
    expect(await waitAgentMsg(c, "lan", room, s.runId, 1_500)).toBeUndefined();
    expect((await getContent(c, "lan", fa)).status).toBe(200);
  });
});

describe("X2b2-AC12 · tin agent có file không kích hoạt run [R15]", () => {
  it("HUB-FR-101 · X2b2-AC12 · I40 · tin agent có attachments '@hoadon.txt' và nội dung '@hoadon …' ⇒ 0 run mới ngoài run gốc", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I40");
    const s = await invoke(c, "lan", room, "@hoadon xuất");
    const job = await c.rt.next(s.runId);
    const out = await jobOutput(c, job, "@hoadon.txt", text("@hoadon chạy lại\n"));
    await finishWith(c, job, "@hoadon xem lại tệp đính kèm", [out]);
    const msg = await waitAgentMsg(c, "lan", room, s.runId);
    expect(msg?.attachments?.map((a: Json) => a.filename)).toEqual(["@hoadon.txt"]);
    await say(c.hub, await c.tok("hoa"), room, "mốc sau tin agent");
    expect(await runCount(c.sql, room)).toBe(1);
  });

  it("HUB-FR-101 · X2b2-AC13 · I41 · run phòng không file (đối chứng X2b-AC11 giữ) ⇒ payload không attachments; runs.attachment_ids = {}", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng không file I41");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    expect((job.payload as unknown as Json).attachments).toBeUndefined();
    expect(await runFiles(c.sql, s.runId)).toEqual([]);
  });
});
