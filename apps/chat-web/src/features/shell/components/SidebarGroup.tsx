// CR-050 · một mục sidebar thu gọn được (Nhóm / Users / Hỏi AI): tiêu đề là nút (aria-expanded), huy hiệu chưa đọc,
// nút phụ bên phải (vd "+" tạo nhóm). Trạng thái mở nhớ theo `id` trong localStorage (mặc định mở).
import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { readLocal, writeLocal } from "~/lib/storage";

const keyOf = (id: string) => `chat:sidebar:${id}`;

type Props = {
  id: string;
  title: string;
  /** > 0 → huy hiệu chưa đọc cạnh tiêu đề. */
  unread?: number;
  badgeTestId?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function SidebarGroup({ id, title, unread = 0, badgeTestId, action, children }: Props) {
  const { t } = useTranslation();
  const hid = useId();
  const [open, setOpen] = useState(() => readLocal(keyOf(id)) !== "0");
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    writeLocal(keyOf(id), next ? "1" : "0");
  };
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <section aria-labelledby={hid} className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <h3 className="min-w-0 flex-1">
            <CollapsibleTrigger className="group/trigger flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight
                className="size-3.5 shrink-0 transition-transform group-data-[state=open]/trigger:rotate-90"
                aria-hidden
              />
              <span id={hid} className="truncate">
                {title}
              </span>
              {unread > 0 && (
                <span
                  data-testid={badgeTestId}
                  title={t("rooms.unreadBadge", { count: unread })}
                  className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground"
                >
                  {unread}
                </span>
              )}
            </CollapsibleTrigger>
          </h3>
          {action}
        </div>
        <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
