// CR-182 · fix-cr182-owner-tap · «Phụ trách» trên điện thoại: chạm avatar ⇒ popover hiện tên; người có quyền đổi thấy thêm «Đổi người phụ trách»
// (mở danh sách ngay trong popover). Máy tính giữ cách cũ (rê chuột ⇒ tên, bấm ⇒ danh sách).
import type { PersonCard } from "@ai/contracts/people";
import { Button } from "@ai/web-kit/ui/kit/button";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@ai/web-kit/ui/kit/popover";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

export function OwnerFace({
  id,
  name,
  cards,
}: {
  id: string;
  name: string;
  cards: Map<string, PersonCard>;
}) {
  const p = cards.get(id);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={name} id={id} src={p?.avatar} size={24} interactive={false} />
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        {p?.job_title && <span className="block truncate text-dim text-xs">{p.job_title}</span>}
      </span>
    </span>
  );
}

export type OwnerPopoverProps = {
  /** Avatar (hoặc chữ «Chưa giao»). */
  face: ReactNode;
  /** «Phụ trách: tên» — nhãn đọc (không phải tooltip) màn hình của nút. */
  tip: string;
  /** Người đang phụ trách; null ⇒ chưa giao. */
  cur: string | null;
  name: string;
  /** Có quyền đổi người ⇒ có nút «Đổi người phụ trách». */
  write: boolean;
  busy: boolean;
  options: { id: string; name: string }[];
  cards: Map<string, PersonCard>;
  onPick: (id: string | null) => void;
};

export function OwnerPopover(p: OwnerPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const pick = (id: string | null) => {
    p.onPick(id);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPicking(false);
      }}
    >
      <PopoverTrigger
        data-testid="owner-select"
        aria-label={p.tip}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {p.face}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2" data-testid="owner-pop">
        {picking ? (
          <ul className="flex max-h-60 flex-col overflow-y-auto" data-testid="owner-list">
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start"
                data-testid="owner-option-none"
                onClick={() => pick(null)}
              >
                {t("contracts.gapa1.owner.none")}
              </Button>
            </li>
            {p.options.map((o) => (
              <li key={o.id}>
                <Button
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start"
                  data-testid={`owner-option-${o.id}`}
                  aria-current={o.id === p.cur ? "true" : undefined}
                  onClick={() => pick(o.id)}
                >
                  <OwnerFace id={o.id} name={o.name} cards={p.cards} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-sm" data-testid="owner-name">
              {p.name}
            </p>
            {p.write && (
              <Button
                size="sm"
                disabled={p.busy}
                data-testid="owner-change"
                onClick={() => setPicking(true)}
              >
                {t("contracts.gapa1.owner.change")}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
