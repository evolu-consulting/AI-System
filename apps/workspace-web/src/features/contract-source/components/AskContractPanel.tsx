// gap-a2 #6: "Hỏi về hợp đồng này" — hỏi trợ lý dùng chung `assistant` (không agent mới) qua ngữ cảnh dock (surface=contracts, id HĐ lấy từ URL
// trang này) kèm dặn chỉ trả lời từ văn bản/trường của HĐ + trích dẫn. Hội thoại là hội thoại Hub của người dùng (lịch sử chat), khoang
// trợ lý mở ra thấy tiếp được. Ở đây chỉ hiện lượt hỏi–đáp gần nhất của panel này.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Composer } from "~/features/assistant/components/Composer";
import { Messages } from "~/features/assistant/components/Messages";
import { ask, stop, useAssistantChat } from "~/features/assistant/hooks/use-assistant-chat";
import { CONTRACT_QA_INSTRUCTION, errorText } from "~/features/assistant/lib/chat.rules";

export function AskContractPanel() {
  const { t } = useTranslation();
  const { msgs } = useAssistantChat();
  const [asked, setAsked] = useState(false);
  const busy = msgs.some((m) => m.pending);
  const send = (q: string) => {
    setAsked(true);
    void ask(q, (code) => errorText(code, t), CONTRACT_QA_INSTRUCTION);
  };
  return (
    <Panel>
      <div className="border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{t("contracts.assistant.askTitle")}</h2>
        <p className="mt-0.5 text-[12.5px] text-dim">{t("contracts.assistant.askHint")}</p>
      </div>
      <div data-testid="ask-contract" className="px-2 pt-3 pb-1">
        {asked && msgs.length > 0 && (
          <div className="mb-2 space-y-4 px-3" aria-live="polite">
            <Messages msgs={msgs.slice(-2)} />
          </div>
        )}
        <Composer
          busy={busy}
          onSend={send}
          onStop={() => void stop()}
          placeholder={t("contracts.assistant.askPlaceholder")}
        />
      </div>
    </Panel>
  );
}
