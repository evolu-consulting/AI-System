// HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b-R01–R03, R07, R08, R10–R12, R16, R17, R19 · luật thuần `room-agent.rules.ts`
// (plan §8, test-plan X2b §3). Nạp động: module chưa có ⇒ `{}` ⇒ mọi ca đỏ ở `expect(typeof fn)`.
// Mô hình thread chung (plan d5f39da): `answerAccess`, `placementOf`, `roomContext` 2 phần (main ≤ 20 + thread ≤ 50).
import { describe, expect, it } from "bun:test";
import { type Loose, loadRoomAgentRules } from "../_modules";

// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
async function fn(name: string): Promise<(...a: unknown[]) => any> {
  const m = await loadRoomAgentRules();
  expect(typeof m[name]).toBe("function");
  return m[name];
}

describe("X2b-R01–R03 · routeRoomMessage(content, {answerRunId?}) [plan §8, D8]", () => {
  it("HUB-FR-101 · X2b-R02 · không @ đầu tin / tag giữa câu / @@ / lệnh / → plain [X2b-AC03]", async () => {
    const route = await fn("routeRoomMessage");
    for (const c of [
      "xin chào cả nhà",
      "nhờ @hoadon kiểm tra",
      "@@hoadon là tag",
      "/dich en xin chào",
    ])
      expect(route(c, {})).toEqual({ kind: "plain" });
  });

  it("HUB-FR-101 · X2b-R02 · '@hoadon kiểm tra' → agents, tags [hoadon], content 'kiểm tra' [X2b-AC01]", async () => {
    const route = await fn("routeRoomMessage");
    const r = route("@hoadon kiểm tra", {});
    expect(r.kind).toBe("agents");
    expect(r.routed).toEqual({ kind: "mention", tags: ["hoadon"], content: "kiểm tra" });
  });

  it("HUB-FR-101 · X2b-R03 · '@hoadon @trello …' → một route agents 2 tag (Orchestrator thu hẹp) [X2b-AC04]", async () => {
    const route = await fn("routeRoomMessage");
    const r = route("@hoadon @trello đối chiếu hoá đơn với thẻ", {});
    expect(r.kind).toBe("agents");
    expect(r.routed?.kind).toBe("mention");
    expect([...(r.routed?.tags ?? [])].sort()).toEqual(["hoadon", "trello"]);
  });

  it("HUB-FR-101 · X2b-R02 · '@orchestrator tóm tắt' → orchestrator; kèm @hoadon → onlyKeys {hoadon} [D8, Q15]", async () => {
    const route = await fn("routeRoomMessage");
    const a = route("@orchestrator tóm tắt giúp", {});
    expect(a.kind).toBe("orchestrator");
    expect(a.content).toBe("tóm tắt giúp");
    expect(a.onlyKeys === undefined || a.onlyKeys.size === 0).toBe(true);
    const b = route("@orchestrator @hoadon tóm tắt giúp", {});
    expect(b.kind).toBe("orchestrator");
    expect([...(b.onlyKeys ?? [])]).toEqual(["hoadon"]);
  });
});

describe("X2b-R01 · canTriggerRun [plan §8]", () => {
  it("HUB-FR-101 · X2b-R01 · chỉ tin user của thành viên hiện tại; tin agent không bao giờ [X2b-AC12]", async () => {
    const can = await fn("canTriggerRun");
    expect(can({ senderType: "user", activeMember: true })).toBe(true);
    expect(can({ senderType: "user", activeMember: false })).toBe(false);
    expect(can({ senderType: "agent", activeMember: true })).toBe(false);
    expect(can({ senderType: "agent", activeMember: false })).toBe(false);
  });
});

describe("X2b-R11/R13 · answer, answerAccess, placementOf [plan §8, D12, D13]", () => {
  const RUN = "a2bb0000-0000-4000-8000-000000000071";
  it("HUB-FR-28 · X2b-R11 · có answerRunId → kind answer, không parse tag (nội dung giữ nguyên) [X2b-AC05]", async () => {
    const route = await fn("routeRoomMessage");
    expect(route("@hoadon HD-12", { answerRunId: RUN })).toEqual({
      kind: "answer",
      runId: RUN,
      content: "@hoadon HD-12",
    });
    expect(route("Đồng ý", { answerRunId: RUN })).toEqual({
      kind: "answer",
      runId: RUN,
      content: "Đồng ý",
    });
  });

  it("HUB-BR-21 · X2b-R11 · answerAccess: null/khác thread/không chờ → not_found (trước not_caller); người khác → not_caller", async () => {
    const aa = await fn("answerAccess");
    const A = "a2bb0000-0000-4000-8000-000000000101";
    const B = "a2bb0000-0000-4000-8000-000000000102";
    const run = { inThread: true, waiting: true, callerId: A };
    expect(aa({ run, userId: A })).toBe("ok");
    expect(aa({ run, userId: B })).toBe("not_caller");
    expect(aa({ run: null, userId: A })).toBe("not_found");
    expect(aa({ run: { ...run, inThread: false }, userId: A })).toBe("not_found");
    expect(aa({ run: { ...run, waiting: false }, userId: A })).toBe("not_found");
    expect(aa({ run: { ...run, waiting: false }, userId: B })).toBe("not_found");
  });

  it("HUB-FR-101 · X2b-R13 · placementOf: timeline/mở thread = main; tin trong thread = flow; tin agent theo tin gọi (D12)", async () => {
    const po = await fn("placementOf");
    const F = "a2bb0000-0000-4000-8000-000000000072";
    expect(po({ senderType: "user", flowId: null, opensThread: false })).toBe("main");
    expect(po({ senderType: "user", flowId: F, opensThread: true })).toBe("main");
    expect(po({ senderType: "user", flowId: F, opensThread: false })).toBe("flow");
    expect(
      po({ senderType: "agent", flowId: F, opensThread: false, triggerPlacement: "main" }),
    ).toBe("main");
    expect(
      po({ senderType: "agent", flowId: F, opensThread: false, triggerPlacement: "flow" }),
    ).toBe("flow");
  });
});

const ROOM = "a2bb0000-0000-4000-8000-000000000081";
const OTHER = "a2bb0000-0000-4000-8000-000000000082";
const T = "a2bb0000-0000-4000-8000-000000000083";
const T2 = "a2bb0000-0000-4000-8000-000000000084";
const row = (seq: number, o: Loose = {}) => ({
  roomId: ROOM,
  flowId: null,
  seq,
  senderType: "user",
  senderName: "Lan",
  content: `tin ${seq}`,
  placement: "main",
  ...o,
});
/** Gộp mọi mục thành danh sách dòng (mục liền nhau cùng role gộp bằng `\n`, plan §6). */
const lines = (h: Loose) => (h as Loose[]).flatMap((x) => String(x.content).split("\n"));

describe("X2b-R07/R08 · roomContext({roomId, triggerSeq, main, thread?}, max?) [plan §6, §8]", () => {
  it("HUB-FR-101 · X2b-AC09 · timeline 30 tin, gọi ở seq 31 → đúng 20 dòng 'Lan: tin 11…30', cũ→mới", async () => {
    const ctx = await fn("roomContext");
    const main = Array.from({ length: 30 }, (_, i) => row(i + 1));
    const h = ctx({ roomId: ROOM, triggerSeq: 31, main });
    expect(lines(h)).toEqual(Array.from({ length: 20 }, (_, i) => `Lan: tin ${i + 11}`));
    expect((h as Loose[]).every((x) => x.role === "user")).toBe(true);
  });

  it("HUB-FR-101 · X2b-R08 · cắt tại tin gọi (seq ≥ triggerSeq bỏ); max.main tuỳ chọn", async () => {
    const ctx = await fn("roomContext");
    const main = [row(1), row(2), row(3), row(4), row(5)];
    expect(lines(ctx({ roomId: ROOM, triggerSeq: 3, main }))).toEqual(["Lan: tin 1", "Lan: tin 2"]);
    expect(lines(ctx({ roomId: ROOM, triggerSeq: 6, main }, { main: 2, thread: 50 }))).toEqual([
      "Lan: tin 4",
      "Lan: tin 5",
    ]);
  });

  it("HUB-FR-101 · X2b-R07 · user → role user '<tên>: …'; agent → role assistant nội dung công khai; luân phiên", async () => {
    const ctx = await fn("roomContext");
    const main = [
      row(1, { senderName: "Hoa", content: "hoá đơn 12" }),
      row(2, { senderType: "agent", senderName: "hoadon", content: "Đã kiểm tra." }),
      row(3, { senderName: "Cúc", content: "cảm ơn" }),
    ];
    expect(ctx({ roomId: ROOM, triggerSeq: 4, main })).toEqual([
      { role: "user", content: "Hoa: hoá đơn 12" },
      { role: "assistant", content: "Đã kiểm tra." },
      { role: "user", content: "Cúc: cảm ơn" },
    ]);
  });

  it("HUB-FR-101 · X2b-AC17 · thread 60 tin: 20 main trước tin gốc + 50 tin thread gần nhất (mọi người), cũ→mới", async () => {
    const ctx = await fn("roomContext");
    const main = Array.from({ length: 25 }, (_, i) => row(i + 1));
    const thread = [
      row(26, { flowId: T, content: "gốc" }),
      ...Array.from({ length: 59 }, (_, i) =>
        row(27 + i, { flowId: T, placement: "flow", senderName: i % 2 ? "Hoa" : "Lan" }),
      ),
    ];
    const h = ctx({
      roomId: ROOM,
      triggerSeq: 86,
      main,
      thread: { flowId: T, rootSeq: 26, rows: thread },
    });
    const l = lines(h);
    expect(l.length).toBe(70);
    expect(l[0]).toBe("Lan: tin 6");
    expect(l[19]).toBe("Lan: tin 25");
    expect(l[20]?.endsWith(": tin 36")).toBe(true);
    expect(l[69]?.endsWith(": tin 85")).toBe(true);
    expect(l.some((x) => x.startsWith("Hoa: "))).toBe(true);
  });

  it("HUB-BR-21 · X2b-AC10 · lớp 2: bỏ dòng lệch phòng / lệch thread dù được truyền vào", async () => {
    const ctx = await fn("roomContext");
    const main = [row(1), row(2, { roomId: OTHER, content: "PHONG-KHAC" }), row(3)];
    const thread = [
      row(4, { flowId: T, content: "gốc" }),
      row(5, { flowId: T2, placement: "flow", content: "THREAD-KHAC" }),
      row(6, { flowId: T, placement: "flow", roomId: OTHER, content: "PHONG-KHAC-2" }),
      row(7, { flowId: T, placement: "flow", content: "trong thread" }),
    ];
    const l = lines(
      ctx({ roomId: ROOM, triggerSeq: 8, main, thread: { flowId: T, rootSeq: 4, rows: thread } }),
    );
    expect(l).toEqual(["Lan: tin 1", "Lan: tin 3", "Lan: gốc", "Lan: trong thread"]);
  });
});

const outcome = (o: Loose = {}) => ({
  status: "finished",
  content: "Hoá đơn HD-12 hợp lệ.",
  ask: null,
  pendingConfirm: false,
  locale: "vi",
  ...o,
});
const SECRET = "PARAM-SECRET-77";

describe("X2b-R10/R12/R16 · agentMessageView [plan §8]", () => {
  it("HUB-FR-101 · X2b-R10 · finished → content giữ nguyên, waitKind null, ask null", async () => {
    const view = await fn("agentMessageView");
    expect(view(outcome())).toEqual({
      content: "Hoá đơn HD-12 hợp lệ.",
      runStatus: "finished",
      waitKind: null,
      ask: null,
    });
  });

  it("HUB-FR-28 · X2b-R11 · need_input → waitKind need_input, ask công khai [X2b-AC05]", async () => {
    const view = await fn("agentMessageView");
    const ask = { question: "Số hoá đơn?", choices: ["HD-12", "HD-13"] };
    const v = view(outcome({ content: "Số hoá đơn?", ask }));
    expect(v.waitKind).toBe("need_input");
    expect(v.ask).toEqual(ask);
  });

  it("HUB-FR-95 · X2b-R12 · side_effect → câu chung, ask null, không lộ tham số [X2b-AC06]", async () => {
    const view = await fn("agentMessageView");
    const v = view(outcome({ content: `Tạo thẻ ${SECRET}?`, pendingConfirm: true }));
    expect(v.waitKind).toBe("side_effect");
    expect(v.ask).toBeNull();
    expect(String(v.content ?? "").length).toBeGreaterThan(0);
    expect(String(v.content)).not.toContain(SECRET);
  });

  it("HUB-FR-94 · X2b-R16 · failed/cancelled → câu chung, không lộ chi tiết lỗi/quota", async () => {
    const view = await fn("agentMessageView");
    for (const status of ["failed", "cancelled"]) {
      const v = view(outcome({ status, content: "QUOTA_EXCEEDED user lan còn 0 token" }));
      expect(v.runStatus).toBe(status);
      expect(String(v.content ?? "").length).toBeGreaterThan(0);
      expect(String(v.content)).not.toContain("QUOTA");
      expect(String(v.content)).not.toContain("lan");
    }
  });
});

describe("X2b-R12 · askForViewer [plan §8, D3]", () => {
  const priv = { question: `Tạo thẻ ${SECRET}?`, choices: ["Đồng ý", "Huỷ"] };
  it("HUB-FR-95 · X2b-R12 · side_effect: người gọi thấy question/choices; người khác chỉ {kind} [X2b-AC06]", async () => {
    const af = await fn("askForViewer");
    expect(af({ waitKind: "side_effect", ask: null, privateAsk: priv, isCaller: true })).toEqual({
      kind: "side_effect",
      ...priv,
    });
    expect(af({ waitKind: "side_effect", ask: null, privateAsk: priv, isCaller: false })).toEqual({
      kind: "side_effect",
    });
  });

  it("HUB-FR-28 · X2b-R11 · need_input: mọi người xem thấy câu hỏi công khai; không chờ → undefined [X2b-AC05]", async () => {
    const af = await fn("askForViewer");
    const ask = { question: "Số hoá đơn?", choices: ["HD-12"] };
    for (const isCaller of [true, false])
      expect(af({ waitKind: "need_input", ask, privateAsk: null, isCaller })).toEqual({
        kind: "need_input",
        ...ask,
      });
    expect(af({ waitKind: null, ask: null, privateAsk: null, isCaller: true })).toBeUndefined();
  });
});

describe("X2b-R17/R19, Q2 · shouldPost, callerReadAfterPost, confirmStillAllowed [plan §8, D14, D15]", () => {
  it("HUB-BR-22 · X2b-R17 · chỉ đăng khi run đã dừng, chưa đăng, phòng còn, người gọi còn là thành viên", async () => {
    const sp = await fn("shouldPost");
    const base = { running: false, posted: false, roomDeleted: false, callerActive: true };
    expect(sp(base)).toBe(true);
    expect(sp({ ...base, running: true })).toBe(false);
    expect(sp({ ...base, posted: true })).toBe(false);
    expect(sp({ ...base, roomDeleted: true })).toBe(false);
    expect(sp({ ...base, callerActive: false })).toBe(false);
  });

  it("HUB-FR-100 · X2b-R19 · mốc đọc người gọi lên seq chỉ khi đang = seq−1; khác → null (D14)", async () => {
    const cr = await fn("callerReadAfterPost");
    expect(cr(9, 10)).toBe(10);
    expect(cr(7, 10)).toBeNull();
  });

  it("HUB-BR-21 · Q2 · confirmStillAllowed: agent còn trong AU người xác nhận ⇔ true (D15)", async () => {
    const ok = await fn("confirmStillAllowed");
    const AG = "a2bb0000-0000-4000-8000-000000000051";
    expect(ok(AG, new Set([AG]))).toBe(true);
    expect(ok(AG, new Set<string>())).toBe(false);
  });
});
