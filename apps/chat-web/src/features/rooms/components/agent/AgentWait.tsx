// HUB-FR-101 · X2b D9, D13, §4 (chờ): phần chờ của khối agent. Người gửi lượt: AskCard (chip / "Đồng ý"·"Huỷ", gửi kèm
// `answer_run_id`). Người khác: `need_input` → câu hỏi (U1) không chip + WaitingNote; `side_effect` → chỉ WaitingNote.
// Hết chờ (đã trả lời / run mới) → chip vô hiệu, không còn WaitingNote.
import type { RoomMessage } from "@ai/contracts/chat";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AskCard } from "~/features/answer/components/AskCard";
import { WaitingNote } from "./WaitingNote";

type Props = {
  message: RoomMessage;
  /** Tên agent đã dịch. */
  name: string;
  mine: boolean;
  /** Lượt còn trong `active_runs` với `status=waiting`. */
  waiting: boolean;
  onAnswer?: (message: RoomMessage, choice: string) => Promise<boolean>;
};

/** `side_effect` thiếu lựa chọn → "Đồng ý"/"Huỷ" (khớp `isAgreeReply` của Hub ở cả hai ngôn ngữ). */
function choicesOf(ask: NonNullable<RoomMessage["ask"]>, t: TFunction): readonly string[] {
  if (ask.choices && ask.choices.length > 0) return ask.choices;
  return ask.kind === "side_effect" ? [t("roomAgent.confirmYes"), t("roomAgent.confirmNo")] : [];
}

export function AgentWait({ message, name, mine, waiting, onAnswer }: Props) {
  const { t } = useTranslation();
  const ask = message.ask;
  if (!ask) return null;
  const confirm = ask.kind === "side_effect";
  if (mine) {
    return (
      <AskCard
        title={t(confirm ? "roomAgent.confirmTitle" : "roomAgent.askTitle", { agent: name })}
        question={ask.question ?? ""}
        choices={choicesOf(ask, t)}
        answered={!waiting}
        onPick={onAnswer ? (c) => onAnswer(message, c) : undefined}
      />
    );
  }
  return (
    <>
      {!confirm && ask.question && <p className="font-medium">{ask.question}</p>}
      {waiting && <WaitingNote kind={ask.kind} callerName={message.caller?.display_name ?? ""} />}
    </>
  );
}
