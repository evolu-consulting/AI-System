// CR-132 · W2 · các phần đầu khung chat (tách khỏi ChatView cho gọn): lỗi/không còn trong cuộc, đầu khung, và (CR-178 M3) thanh tìm + «Ảnh & tệp».
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useJump } from "../hooks/use-jump";
import { IconBuilding, IconChevronLeft, IconImage } from "../icons";
import { cn } from "../ui";
import { AttachSheet } from "./AttachSheet";
import { FindBar } from "./FindBar";

export function ChatError({
  gone,
  titleKey,
  onBack,
  onRetry,
}: {
  gone: boolean;
  titleKey: string;
  onBack?: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (gone)
    return (
      <EmptyState
        kind="notFound"
        testId="chat-gone"
        title={t("contracts.messages.removedTitle")}
        hint={t("contracts.messages.removedHint")}
        action={
          <button type="button" className="btn btn-sm" onClick={() => onBack?.()}>
            {t("contracts.messages.back")}
          </button>
        }
      />
    );
  return (
    <EmptyState
      kind="error"
      title={t(titleKey)}
      action={
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          {t("contracts.messages.retry")}
        </button>
      }
    />
  );
}

export function ChatHeader({
  title,
  subtitle,
  company,
  members,
  onBack,
  backClass,
  compact,
  onMembers,
  onFeed,
  onFind,
  onAttach,
}: {
  /** CR-178 · M3 · «Tìm trong cuộc trò chuyện» và «Ảnh & tệp». */
  onFind: () => void;
  onAttach: () => void;
  title: string;
  /** CR-169 · cuộc `partner`: chức vụ người kia. */
  subtitle: string;
  /** CR-178 · cuộc `partner`: nhãn công ty + nút «Bảng tin <Công ty>». */
  company: string;
  onFeed: () => void;
  members: number | null;
  onBack?: () => void;
  backClass?: string;
  compact?: boolean;
  onMembers: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-rule-soft",
        compact ? "h-12 px-2" : "h-14 px-4",
      )}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("contracts.messages.back")}
          title={t("contracts.messages.back")}
          data-testid="chat-back"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink",
            backClass,
          )}
        >
          <IconChevronLeft width={18} height={18} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 truncate text-[14.5px] font-semibold" data-testid="chat-title">
            {title}
          </h2>
          {company && (
            <Badge
              status="warn"
              icon={<IconBuilding width={12} height={12} />}
              data-testid="chat-company"
              className="max-w-40 shrink truncate"
            >
              {company}
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="m-0 truncate text-micro text-dim" data-testid="chat-job">
            {subtitle}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onFind}
        aria-label={t("contracts.messages.find.inChat")}
        title={t("contracts.messages.find.inChat")}
        data-testid="chat-find"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink"
      >
        <ICONS.search width={18} height={18} />
      </button>
      <button
        type="button"
        onClick={onAttach}
        aria-label={t("contracts.messages.find.attachTitle")}
        title={t("contracts.messages.find.attachTitle")}
        data-testid="chat-attach"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink"
      >
        <IconImage width={18} height={18} />
      </button>
      {company && (
        <Button variant="outline" size="sm" data-testid="open-feed" onClick={onFeed}>
          {t("contracts.messages.feed.open", { company })}
        </Button>
      )}
      {members !== null && (
        <button type="button" className="btn btn-sm" onClick={onMembers} data-testid="chat-members">
          {t("contracts.messages.members", { n: members })}
        </button>
      )}
    </header>
  );
}

/** CR-178 · M3 · đầu khung: bình thường là `ChatHeader`; «Tìm trong cuộc» thay bằng thanh tìm; «Ảnh & tệp» mở Sheet. */
export function ChatTop({
  id,
  jump,
  children,
}: {
  id: string;
  jump: ReturnType<typeof useJump>;
  children: (onFind: () => void, onAttach: () => void) => ReactNode;
}) {
  const [finding, setFinding] = useState(false);
  const [attach, setAttach] = useState(false);
  return (
    <>
      {finding ? (
        <FindBar
          conversationId={id}
          onJump={(h) => void jump.jump(h.seq)}
          onClose={() => setFinding(false)}
        />
      ) : (
        children(
          () => setFinding(true),
          () => setAttach(true),
        )
      )}
      <AttachSheet
        conv={id}
        open={attach}
        onClose={() => setAttach(false)}
        onGoto={(seq) => void jump.jump(seq)}
      />
    </>
  );
}
