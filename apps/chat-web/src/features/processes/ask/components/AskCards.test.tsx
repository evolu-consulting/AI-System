// CHAT-AC-57 · AskTaskCard (inline / external), ForwardMessage (khoá theo task_kind), ForwardAction (khoá khi đủ 3 lần).
import { beforeAll, expect, test } from "bun:test";
import type { RoomMessage, TaskDetail } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance, type i18n as I18n } from "i18next";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { ThreadBindingProvider } from "../../shared/thread/thread-binding";
import { AskTaskCard } from "./AskTaskCard";
import { ForwardAction } from "./ForwardAction";
import { ForwardMessage } from "./ForwardMessage";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: {
      vi: { translation: { ...(await loadChatLocale("vi")), ...(await loadProcessLocale("vi")) } },
    },
    interpolation: { escapeValue: false },
  });
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (o: Partial<TaskDetail> = {}): TaskDetail => ({
  id: id(1),
  kind: "ask",
  status: "open",
  stage_idx: 0,
  stage_name: "Đọc hoá đơn",
  question: "Kỳ kế toán nào?",
  choices: ["09/2026", "10/2026"],
  forwards: [],
  can_act: true,
  created_at: "2026-10-10T00:00:00.000Z",
  ...o,
});
const wrap = (node: ReactNode, thread: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        {thread ? <ThreadBindingProvider>{node}</ThreadBindingProvider> : node}
      </QueryClientProvider>
    </I18nextProvider>,
  );

test("inline: có ô Câu trả lời + Gửi trả lời + Nhờ người khác trả lời, không có nút văn bản", () => {
  const h = wrap(<AskTaskCard runId={id(9)} task={task()} />, false);
  expect(h).toContain("Câu trả lời");
  expect(h).toContain("Gửi trả lời");
  expect(h).toContain("Nhờ người khác trả lời");
  expect(h).toContain("09/2026");
  expect(h).toContain("Kỳ kế toán nào?");
  expect(h).not.toContain("Trả lời bằng văn bản");
});

test("external (thread): chip + Trả lời bằng văn bản + Nhờ người khác trả lời, không ô nhập", () => {
  const h = wrap(<AskTaskCard runId={id(9)} task={task()} />, true);
  expect(h).toContain("Trả lời bằng văn bản");
  expect(h).toContain("Nhờ người khác trả lời");
  expect(h).not.toContain("<textarea");
  expect(h).toContain("cần thêm thông tin");
});

test("nhiều câu: inline hiện gợi ý chip điền vào ô", () => {
  const h = wrap(<AskTaskCard runId={id(9)} task={task({ question: "1. A?\n2. B?" })} />, false);
  expect(h).toContain("Bấm chip để điền vào ô trả lời");
});

test("đã đóng, không có history: không vẽ gì", () => {
  expect(wrap(<AskTaskCard runId={id(9)} task={task({ status: "closed" })} />, false)).toBe("");
});

test("ForwardAction: đủ 3 lần thì aria-disabled + tooltip; chưa đủ thì không; review đổi nhãn", () => {
  const locked = wrap(<ForwardAction taskId={id(1)} kind="ask" forwardCount={3} />, false);
  expect(locked).toContain('aria-disabled="true"');
  expect(locked).toContain("Đã nhờ tối đa 3 lần");
  expect(wrap(<ForwardAction taskId={id(1)} kind="ask" forwardCount={1} />, false)).not.toContain(
    "aria-disabled",
  );
  expect(wrap(<ForwardAction taskId={id(1)} kind="review" forwardCount={0} />, false)).toContain(
    "Chuyển người khác kiểm",
  );
});

test("ForwardMessage: ask thì 'đã nhờ … trả lời'; review thì 'đã chuyển việc cho …'", () => {
  const msg = { seq: 5 } as RoomMessage;
  const base = {
    stage_idx: 0,
    process_run_id: id(9),
    task_id: id(1),
    from: { id: id(2), display_name: "Lan Tran" },
    to: { id: id(3), display_name: "QC Người 01" },
    depth: 1,
  };
  const ask = wrap(
    <ForwardMessage
      message={msg}
      roomId={id(8)}
      myId={id(7)}
      part={{ kind: "forward", task_kind: "ask", ...base }}
    />,
    false,
  );
  expect(ask).toContain("Lan Tran đã nhờ QC Người 01 trả lời (chuyển 1/3)");
  const rv = wrap(
    <ForwardMessage
      message={msg}
      roomId={id(8)}
      myId={id(2)}
      part={{ kind: "forward", task_kind: "review", ...base }}
    />,
    false,
  );
  expect(rv).toContain("Bạn đã chuyển việc cho QC Người 01 (lần 1/3)");
});
