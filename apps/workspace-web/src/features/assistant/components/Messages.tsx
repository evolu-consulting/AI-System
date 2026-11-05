// M2-chat · danh sách tin của khoang trợ lý (giao diện như mgmt-app `assistant/Panel.tsx`): tin người dùng là bong bóng phải,
// câu trả lời là chữ cạnh dấu robot; đang chờ ⇒ chấm + bước hiện tại; lỗi ⇒ hộp đỏ.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import type { Msg } from "../lib/chat.rules";
import { Rich } from "./Rich";

function Answer({ m }: { m: Msg }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-act-soft text-act"
      >
        <IconRobot width={14} height={14} />
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">
        {m.text ? (
          <Rich text={m.text} />
        ) : (
          m.pending && (
            <p className="flex items-center gap-2 text-dim">
              <span className="h-2 w-2 animate-pulse rounded-full bg-act" />
              {m.step ? `${m.step}…` : t("contracts.assistant.thinking")}
            </p>
          )
        )}
        {m.text && m.pending && m.step && <p className="text-[12px] text-dim">{m.step}…</p>}
        {m.error && (
          <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-late">
            {m.error}
          </p>
        )}
      </div>
    </div>
  );
}

export function Messages({ msgs }: { msgs: Msg[] }) {
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cuộn xuống mỗi khi có tin/mẩu chữ mới
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [msgs]);
  return (
    <>
      {msgs.map((m, i) =>
        m.role === "user" ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ thêm vào cuối
            key={i}
            className="ml-auto w-fit min-w-0 max-w-[88%] whitespace-pre-line rounded-2xl rounded-br-md bg-act-soft px-3.5 py-2.5 text-[13.5px] text-ink [overflow-wrap:anywhere]"
          >
            <p>{m.text}</p>
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ thêm vào cuối
          <Answer key={i} m={m} />
        ),
      )}
      <div ref={end} />
    </>
  );
}
