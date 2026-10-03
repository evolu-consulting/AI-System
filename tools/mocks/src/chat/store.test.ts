import { describe, expect, test } from "bun:test";
import { FlowSchema, MessageSchema, type RunSummary } from "@ai/contracts/chat";
import { MINH_SEED, seedChat } from "./seed";
import { ChatStore } from "./store";
import { findUser } from "./users";

const A = { userId: "00000000-0000-4000-8000-0000000c1a02", tenantId: "t-acme" };
const B = { userId: "00000000-0000-4000-8000-0000000c1a03", tenantId: "t-acme" };
const A_OTHER_TENANT = { ...A, tenantId: "t-beta" };

describe("C1-R09 · ChatStore lọc theo chủ", () => {
  test("user khác / tenant khác / đã xoá → không thấy", () => {
    const s = new ChatStore();
    const c = s.createConversation(A, "Hoá đơn tháng 9");
    expect(s.getConversation(A, c.id)?.id).toBe(c.id);
    expect(s.getConversation(B, c.id)).toBeNull();
    expect(s.getConversation(A_OTHER_TENANT, c.id)).toBeNull();
    expect(s.listConversations(B)).toEqual([]);
    expect(s.listConversations(A, "hoa don").map((x) => x.id)).toEqual([c.id]);
    expect(s.deleteConversation(c)).toEqual([]);
    expect(s.getConversation(A, c.id)).toBeNull();
    expect(s.listConversations(A)).toEqual([]);
  });
});

describe("C1-R01 · C1-R02 · flow và tin", () => {
  test("startFlow tạo flow + tin đầu; addAssistant cập nhật preview, last_active, updated_at", () => {
    const s = new ChatStore();
    const c = s.createConversation(A, "X");
    const { flow, message } = s.startFlow(c, "#scn:slow   Câu   đầu");
    expect(flow.title).toBe("Câu đầu");
    expect(message.content).toBe("#scn:slow   Câu   đầu");
    expect(c.updatedAt).toBeGreaterThan(c.createdAt);
    const run: RunSummary = {
      id: crypto.randomUUID(),
      status: "finished",
      ms: 5,
      steps: [],
      error: null,
    };
    s.addAssistantMessage(flow, { content: "Trả lời", runId: run.id, run, ask: null });
    s.setActiveRun(flow, run.id);
    const dto = FlowSchema.parse(s.toFlow(flow));
    expect(dto.message_count).toBe(2);
    expect(dto.preview.answer?.content).toBe("Trả lời");
    expect(dto.active_run_id).toBe(run.id);
    expect(s.deleteConversation(c)).toEqual([run.id]);
    expect(s.toConversation(c).flow_count).toBe(1);
  });

  test("clock tăng nghiêm ngặt; danh sách sắp updated_at giảm", () => {
    const s = new ChatStore();
    const t1 = s.clock();
    expect(s.clock()).toBeGreaterThan(t1);
    const x = s.createConversation(A, "X");
    const y = s.createConversation(A, "Y");
    expect(s.listConversations(A).map((c) => c.id)).toEqual([y.id, x.id]);
    s.startFlow(x, "Cập nhật X");
    expect(s.listConversations(A).map((c) => c.id)).toEqual([x.id, y.id]);
  });
});

describe("CHAT-AC-19 · seed minh", () => {
  test("4 hội thoại đúng thứ tự, mọi flow/tin hợp lệ theo contract", () => {
    const s = new ChatStore();
    const now = Date.now();
    seedChat(s, now);
    const u = findUser("acme", "minh");
    const owner = { userId: u?.id ?? "", tenantId: u?.tenant.id ?? "" };
    const convs = s.listConversations(owner);
    expect(convs.map((c) => c.title)).toEqual(MINH_SEED.map((c) => c.title));
    expect(convs[0]?.updatedAt).toBe(now - 2 * 60_000);
    for (const c of convs) {
      for (const f of s.flowsOf(c.id)) FlowSchema.parse(s.toFlow(f));
      for (const m of s.messagesOf(c.id)) MessageSchema.parse(m.message);
    }
    const [f1, f2] = s.flowsOf(convs[0]?.id ?? "");
    expect(f1 && s.toFlow(f1).preview.answer?.run?.ms).toBe(7800);
    expect(f2?.messageIds.length).toBe(4);
  });
});
