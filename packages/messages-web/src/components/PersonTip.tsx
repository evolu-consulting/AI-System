// CR-148 · thẻ nhỏ khi rê chuột / focus bàn phím lên ảnh đại diện hoặc tên: ảnh đại diện, tên, phòng ban, chức vụ. Dữ liệu là thẻ đã đọc THEO LÔ
// (`usePersonCards`), thẻ chưa về ⇒ chỉ hiện tên. Trình bày thuần, không gọi mạng. Esc đóng.
import type { PersonCard } from "@ai/contracts/people";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";

export function usePersonTip() {
  const [open, set] = useState(false);
  return {
    open,
    /** Gắn vào phần ảnh + tên. */
    hover: { onMouseEnter: () => set(true), onMouseLeave: () => set(false) },
    /** Gắn vào phần tử focus được (nút dòng). */
    focus: {
      onFocus: () => set(true),
      onBlur: () => set(false),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Escape") set(false);
      },
    },
  };
}

export function PersonTip({ name, card }: { name: string; card: PersonCard | undefined }) {
  const { t } = useTranslation();
  return (
    <div
      role="tooltip"
      data-testid="person-tip"
      className="pointer-events-none absolute left-12 top-10 z-30 flex w-60 items-center gap-3 rounded-lg border border-rule-soft bg-panel p-3 shadow-lg"
    >
      <PersonAvatar name={name} src={card?.avatar} size={44} testId="person-tip-avatar" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold" data-testid="person-tip-name">
          {card?.display_name ?? name}
        </span>
        {card && (
          <>
            <span className="block truncate text-label text-dim" data-testid="person-tip-dept">
              {card.department?.name ?? t("contracts.messages.noDept")}
            </span>
            {card.job_title && (
              <span className="block truncate text-label text-dim" data-testid="person-tip-title">
                {card.job_title}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
