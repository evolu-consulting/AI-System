// CR-190 · BR-190-7 · chưa chọn cuộc nào: hình minh hoạ nhẹ + «Chọn một người để bắt đầu trò chuyện», căn giữa ngang + dọc.
import { useTranslation } from "react-i18next";

export function ChatPick() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="chat-pick"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center"
    >
      <svg width="140" height="110" viewBox="0 0 140 110" fill="none" aria-hidden="true">
        <rect
          x="8"
          y="10"
          width="78"
          height="46"
          rx="14"
          className="fill-sunk stroke-act"
          strokeWidth="2"
        />
        <path
          d="M26 56 20 72l20-16"
          className="fill-sunk stroke-act"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <rect
          x="54"
          y="48"
          width="78"
          height="46"
          rx="14"
          className="fill-panel stroke-rule"
          strokeWidth="2"
        />
        <path
          d="M112 94l8 14-22-14"
          className="fill-panel stroke-rule"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="30" cy="33" r="4" className="fill-act" />
        <circle cx="47" cy="33" r="4" className="fill-act" />
        <circle cx="64" cy="33" r="4" className="fill-act" />
        <path
          d="M72 71h44M72 82h28"
          className="stroke-rule"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      <h3 className="m-0 mt-2 text-[15px] font-semibold">{t("contracts.messages.pickPerson")}</h3>
      <p className="m-0 text-[13px] text-dim">{t("contracts.messages.pickPersonHint")}</p>
    </div>
  );
}
