// com-c10b · Trợ lý giá ở chế độ mẫu (dev không backend): trả một câu cố định như luồng SSE thật (delta → run.finished).
import type { ChatEvent } from "@ai/contracts/chat";
import type { DockChat } from "./client";

const REPLY =
  "Chế độ mẫu: kết nối server (PUBLIC_COMMUNITY_API=http) để Trợ lý giá trả lời từ Sổ giá.";

export const mockDockChat: DockChat = {
  createConversation: async () => ({ id: "mock-conv" }),
  send: async (_id, _req, onEvent) => {
    onEvent({ event: "delta", data: { text: REPLY } } as unknown as ChatEvent);
    onEvent({ event: "run.finished", data: { content: REPLY } } as unknown as ChatEvent);
    return { runId: null, flowId: "mock-flow" };
  },
  cancel: async () => {},
};
