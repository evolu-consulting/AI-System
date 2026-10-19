// PK-FR-10 · TF5 · M2-chat · khoang trợ lý — nạp lazy (chunk "assistant"). Chat tách khỏi app: hỏi agent dùng chung
// `mgmt-assistant` của Agent Hub (`features/assistant`); đổi backend (Dify ↔ Claude) là cấu hình agent, không đổi khoang này.
// Bố cục/giao diện như mgmt-app `assistant/Panel.tsx`: đầu khoang (robot + trạng thái + Thu gọn), tin, gợi ý, ô hỏi.
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import { Composer } from "~/features/assistant/components/Composer";
import { Messages } from "~/features/assistant/components/Messages";
import { ask, stop, useAssistantChat } from "~/features/assistant/hooks/use-assistant-chat";
import { errorText } from "~/features/assistant/lib/chat.rules";

const SUGGEST = ["suggest1", "suggest2", "suggest3"] as const;

export default function AssistantPanel({
  onClose,
  closeLabel,
}: {
  onClose: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  const { msgs } = useAssistantChat();
  const busy = msgs.some((m) => m.pending);
  const send = (q: string) => void ask(q, (code) => errorText(code, t));
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[58px] shrink-0 items-center gap-2.5 px-4">
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-act to-[#a855f7] text-on-act shadow-sm"
        >
          <IconRobot width={18} height={18} />
        </span>
        <span className="min-w-0 leading-tight">
          <h2 className="font-semibold text-[14.5px]">{t("contracts.shell.assistant")}</h2>
          <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
            <span
              className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-soon" : "bg-ok"}`}
            />
            {busy ? t("contracts.assistant.answering") : t("contracts.assistant.ready")}
          </span>
        </span>
        {closeLabel && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-dim text-label hover:bg-sunk"
          >
            {closeLabel}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <div className="rounded-2xl border border-rule-soft bg-sunk p-3.5 text-[13.5px]">
              {t("contracts.assistant.intro")}
            </div>
            <p className="font-medium text-[12px] text-dim">{t("contracts.assistant.try")}</p>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGEST.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => send(t(`contracts.assistant.${k}`))}
                  className="rounded-xl border border-rule bg-panel px-3 py-2 text-left text-[13px] text-ink-2 hover:border-act-line hover:bg-act-soft hover:text-act"
                >
                  {t(`contracts.assistant.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        <Messages msgs={msgs} />
      </div>
      <Composer busy={busy} onSend={send} onStop={() => void stop()} />
    </div>
  );
}
