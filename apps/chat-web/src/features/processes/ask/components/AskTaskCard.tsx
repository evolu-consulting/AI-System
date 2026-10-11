// CHAT-AC-57 · HUB-FR-110/111 · plan-frontend §4: thẻ hỏi lại (chip / `Trả lời bằng văn bản` / `Nhờ người khác trả lời`).
// External trong thread (`useThreadBinding()` ≠ null): chỉ chip + nút, ô nhập là composer thread. Inline (null): có ô `Câu trả lời`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useSession } from "~/lib/auth/use-session";
import type { TaskCardProps } from "../../shared/types";
import { useAskCard } from "../hooks/use-ask-card";
import { askMode, forwardedToMe, hhmm, lastForwardByMe } from "../lib/ask-rules";
import { AskAnswerBox } from "./AskAnswerBox";
import { AskBody, AskRegion } from "./AskBody";
import { ForwardedByYou, ForwardedToYou } from "./AskForwardInfo";
import { ForwardAction } from "./ForwardAction";

export function AskTaskCard({ runId, task, view, onResolved }: TaskCardProps) {
  const { t, i18n } = useTranslation();
  const myId = useSession((s) => s.me?.id ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lang = i18n.language.startsWith("en") ? "en" : "vi";
  const stage = view?.stages[task.stage_idx];
  const agent = stage?.executor.name[lang] ?? task.stage_name;
  const card = useAskCard({
    runId,
    task,
    agent,
    onInsert: (c) => setText((s) => (s ? `${s} ${c}` : c)),
  });

  if (task.status === "closed") return <AskClosed task={task} view={view} />;

  const title = stage
    ? t("process.ask.title", { agent, n: Math.max(stage.asks_count, 1), max: stage.ask_limit })
    : t("process.ask.titleShort", { agent });
  const toMe = forwardedToMe(task.forwards, myId);
  const byMe = lastForwardByMe(task.forwards, myId);
  const question = task.question ?? "";
  const run = (fn: () => Promise<void>) =>
    fn().then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  const submit = () =>
    run(async () => {
      await card.send(text);
      setText("");
      onResolved?.("answer");
    });

  return (
    <AskRegion title={title}>
      {toMe && (
        <ForwardedToYou
          forward={toMe}
          starter={view?.started_by.display_name ?? null}
          excerpt={task.excerpt}
        />
      )}
      <AskBody
        question={question}
        choices={task.choices ?? []}
        titles={card.descriptions}
        onPick={(c) =>
          void run(async () => {
            await card.pick(c);
            // Chip đơn câu gửi ngay ⇒ coi như đã trả lời (gộp nhiều câu chỉ điền vào ô, không gửi).
            if (askMode(question) === "single") onResolved?.("answer");
          })
        }
        disabled={card.pending}
      />
      {byMe && <ForwardedByYou {...byMe} />}
      {card.binding ? (
        <>
          {error && (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={card.begin}>
              {t("process.ask.typed")}
            </Button>
            <Actions task={task} />
          </div>
        </>
      ) : (
        <>
          <AskAnswerBox
            value={text}
            onChange={setText}
            onSubmit={() => void submit()}
            pending={card.pending}
            error={error}
            hint={askMode(question) === "multi"}
          />
          <div>
            <Actions task={task} />
          </div>
        </>
      )}
    </AskRegion>
  );
}

function Actions({ task }: Pick<TaskCardProps, "task">) {
  return (
    <ForwardAction
      taskId={task.id}
      kind="ask"
      forwardCount={task.forwards.length}
      excludeIds={new Set(task.forwards.map((f) => f.to.id))}
    />
  );
}

/** `status=closed` ⇒ không nút: "✓ {{who}} đã trả lời · {{time}}" + nội dung (từ `history`). */
function AskClosed({ task, view }: Pick<TaskCardProps, "task" | "view">) {
  const { t } = useTranslation();
  const hit = view?.history.find((h) => h.kind === "ask" && h.task_id === task.id && h.answer);
  if (!hit) return null;
  const who = hit.actor?.display_name ?? "";
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">✓ {t("process.ask.answered", { who, time: hhmm(hit.at) })}</p>
      <p className="whitespace-pre-wrap">{hit.answer}</p>
    </div>
  );
}
