// CHAT-AC-14..17 · helper thuần của khung flow: ghép trang E11, run chưa có trong E11, khi nào bỏ run, kéo sheet.
import type { ChatPage, Flow, Message } from "@ai/contracts/chat";
import { isTerminal, type RunState } from "~/features/run/lib/reducer";
import { type AnswerView, answerFromMessage } from "~/features/thread/lib/thread-logic";

/** Kéo tay nắm sheet xuống quá ngưỡng này thì đóng (plan-frontend §5 FlowSheet). */
export const DRAG_CLOSE_PX = 120;

/** Gần đỉnh luồng khung → tải trang cũ hơn. */
export const LOAD_OLDER_PX = 48;

/** Trang E11 theo thứ tự tải (mới → cũ), mỗi trang sắp tăng → một dãy tăng dần. */
export function orderMessages(pages: readonly ChatPage<Message>[] | undefined): Message[] {
  if (!pages) return [];
  return [...pages].reverse().flatMap((p) => p.items);
}

/** Phần của run cần vẽ thêm vì E11 chưa chứa (vừa gửi / đang stream). */
export function runOverlay(
  run: RunState | undefined,
  ids: ReadonlySet<string>,
): { question: string | null; answer: boolean } {
  if (!run) return { question: null, answer: false };
  const q = run.request.content;
  const showQ = q !== "" && (run.messageId === null || !ids.has(run.messageId));
  return {
    question: showQ ? q : null,
    answer: run.answerId === null || !ids.has(run.answerId),
  };
}

/**
 * Run đã kết thúc và E11 đã có câu trả lời → khung bỏ run (bẫy F8: run trong flow không phải câu trả lời đầu).
 * Câu trả lời đầu mà E10 chưa có (`preview.answer` null) → để khối flow (F8) tự bỏ, tránh nháy.
 */
export function shouldDismissInPanel(
  run: RunState,
  ids: ReadonlySet<string>,
  flow: Pick<Flow, "preview">,
): boolean {
  if (!isTerminal(run.phase) || run.answerId === null || !ids.has(run.answerId)) return false;
  return flow.preview.answer !== null;
}

export function dragShouldClose(dy: number): boolean {
  return dy > DRAG_CLOSE_PX;
}

export type PanelItem =
  | { kind: "question"; id: string; text: string }
  | { kind: "answer"; id: string; answer: AnswerView };

/**
 * Tin E11 → mục hiển thị. Câu trả lời mang ngữ cảnh gửi lại (câu hỏi ngay trước, cùng flow);
 * chip hỏi lại vô hiệu khi đã có tin sau (`more` = còn tin chờ của run).
 */
export function buildItems(
  messages: readonly Message[],
  ctx: { convId: string; flowId: string },
  more: boolean,
): PanelItem[] {
  let lastQuestion = "";
  return messages.map((m, i) => {
    if (m.role === "user") {
      lastQuestion = m.content;
      return { kind: "question", id: m.id, text: m.content };
    }
    const answer = answerFromMessage(m, {
      context: { ...ctx, content: lastQuestion, origin: "flow" },
      askAnswered: more || i < messages.length - 1,
    });
    return { kind: "answer", id: m.id, answer };
  });
}
