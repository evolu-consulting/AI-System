// CR-169 · lát 6 · mục «Người» khi tìm: người (đồng nghiệp hoặc của công ty đã kết nối) khớp tên/chức vụ, chưa có cuộc trong danh sách.
// Chỉ lộ tên · chức vụ · công ty (không email/điện thoại). Bấm ⇒ mở 1-1 (`partner` nếu khác công ty). Tải dần khi cuộn.

import type { MsgPerson } from "@ai/contracts/pack-contracts";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../ui";
import { Section } from "./ListSection";
import { LoadSentinel } from "./LoadSentinel";

export type PeopleSearchProps = {
  people: readonly MsgPerson[];
  status: "loading" | "error" | "ready";
  hasMore: boolean;
  loadingMore: boolean;
  openingId: string | null;
  onPick: (p: MsgPerson) => void;
  onMore: () => void;
  onRetry: () => void;
};

export function PeopleSearch(p: PeopleSearchProps) {
  const { t } = useTranslation();
  const label = t("contracts.messages.peopleSection");
  if (p.status === "loading")
    return (
      <Section label={label}>
        <div className="space-y-2 px-4 py-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </Section>
    );
  if (p.status === "error")
    return (
      <Section label={label}>
        <p role="alert" className="m-0 px-4 py-2 text-label text-late">
          {t("contracts.messages.peopleError")}{" "}
          <button type="button" className="underline" onClick={p.onRetry}>
            {t("contracts.messages.retry")}
          </button>
        </p>
      </Section>
    );
  if (p.people.length === 0) return null;
  return (
    <Section label={label}>
      <ul className="m-0 list-none p-0" data-testid="people-results">
        {p.people.map((x) => {
          const sub = [x.job_title, x.company.name].filter(Boolean).join(" · ");
          return (
            <li key={`${x.company.id}:${x.id}`}>
              <button
                type="button"
                data-testid="person-row"
                disabled={p.openingId === x.id}
                onClick={() => p.onPick(x)}
                className="flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none"
              >
                <PersonAvatar name={x.name} src={null} size={36} testId="person-avatar" />
                <span className="min-w-0 flex-1">
                  <TruncText
                    text={x.name}
                    focusable={false}
                    className="block text-[14px] font-medium"
                  />
                  <TruncText text={sub} focusable={false} className="block text-micro text-dim" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
    </Section>
  );
}
