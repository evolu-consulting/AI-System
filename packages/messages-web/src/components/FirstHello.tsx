// CR-190 · BR-190-7 · mở người chưa từng nhắn: avatar to, tên, chức vụ, công ty, «Chưa có tin nhắn. Gửi lời chào đầu tiên» + 3 câu chào gợi ý (bấm là gửi).
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { useTranslation } from "react-i18next";
import { HELLO_KEYS } from "../lib/first-hello";

export function FirstHello({
  name,
  avatar,
  job,
  company,
  peerId,
  kind,
  disabled,
  onPick,
}: {
  name: string;
  avatar?: string | null | undefined;
  job: string;
  company: string;
  peerId?: string | undefined;
  kind: "person" | "company";
  /** Cuộc chỉ đọc / bị khoá ⇒ không có câu chào bấm gửi. */
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto p-6 text-center"
      data-testid="chat-first-hello"
    >
      <Avatar
        name={name}
        src={avatar}
        kind={kind}
        colorId={peerId}
        size={40}
        className="mb-2 size-20 text-2xl"
      />
      <h3 className="m-0 max-w-full text-[16px] font-semibold">
        <TruncText text={name} className="block" />
      </h3>
      {job && <TruncText text={job} className="block max-w-full text-label text-dim" />}
      {company && <TruncText text={company} className="block max-w-full text-label text-dim" />}
      <p className="mt-2 text-[13.5px] text-dim" data-testid="chat-empty">
        {t("contracts.messages.firstHello")}
      </p>
      {!disabled && (
        <div className="mt-2 flex max-w-sm flex-wrap justify-center gap-2">
          {HELLO_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              data-testid="chat-hello-chip"
              className="min-h-9 rounded-full border border-rule bg-sunk px-3.5 py-1.5 text-label text-ink hover:bg-rule-soft max-md:min-h-11"
              onClick={() => onPick(t(k))}
            >
              {t(k)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
