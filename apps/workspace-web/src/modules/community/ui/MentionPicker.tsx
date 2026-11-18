// CR-147c · «Nhắc tên» (bản mẫu cr147-mention-picker): thanh công cụ chỉ có biểu tượng 👤+; bấm mở hộp thoại tìm + chọn tối đa 10 người,
// danh sách tải dần khi cuộn. Chỉ người xem được bài (server lọc, CR-145). Người đã chọn hiện thành chip ở ô đăng (MentionChips).
// CR-186: chủ quản có thêm ô lọc nhóm (Tất cả · Nội bộ · Đối tác · Khách hàng) cạnh ô tìm tên; mỗi dòng: avatar + họ tên + công ty
// (nội bộ ⇒ «Nội bộ»), cao ≥ 44px, cách đều. Chức vụ: API chưa trả ⇒ chưa hiện (ghi ở Delta).

import { MENTION_GROUPS, type MentionGroup, POST_MENTIONS_MAX } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import { Input } from "@ai/web-kit/ui/kit/input";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai/web-kit/ui/kit/select";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { IconButton } from "~/shared/ui/IconButton";
import { useApp } from "../application/ctx";
import type { PeopleScope } from "../application/ports";
import { usePeople } from "../application/usePeople";
import type { DraftMention } from "../domain/mention";
import { t } from "../i18n";
import { IconX } from "./icons";

const GROUP_LABEL: Record<MentionGroup, () => string> = {
  internal: () => t("community.draft.mentionGroupInternal"),
  partner: () => t("community.draft.mentionGroupPartner"),
  customer: () => t("community.draft.mentionGroupCustomer"),
};

type Person = { userId: string; name: string; orgName?: string | undefined };
const toMention = (o: Person): DraftMention => ({
  userId: o.userId,
  name: o.name,
  ...(o.orgName ? { orgName: o.orgName } : {}),
});

export function MentionChips({
  mentions,
  onChange,
}: {
  mentions: DraftMention[];
  onChange: (m: DraftMention[]) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className="attachrow" data-testid="mention-people">
      <span className="fhint">{t("community.draft.mentionLabel")}:</span>
      {mentions.map((m) => (
        <span className="attach" key={m.userId} data-testid="mention-chip">
          {m.name}
          <button
            type="button"
            aria-label={t("community.draft.mentionRemove", { name: m.name })}
            onClick={() => onChange(mentions.filter((x) => x.userId !== m.userId))}
          >
            <IconX size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

function PersonRow({
  p,
  on,
  disabled,
  toggle,
}: {
  p: Person;
  on: boolean;
  disabled: boolean;
  toggle: () => void;
}) {
  return (
    <li>
      <div
        className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
        data-testid="mention-option"
      >
        <Checkbox
          id={`mp-${p.userId}`}
          checked={on}
          disabled={disabled && !on}
          onCheckedChange={toggle}
        />
        <label
          htmlFor={`mp-${p.userId}`}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3"
        >
          <PersonAvatar name={p.name} id={p.userId} size={32} interactive={false} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {p.orgName ?? t("community.draft.mentionGroupInternal")}
            </span>
          </span>
        </label>
      </div>
    </li>
  );
}

const UserPlus = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6" />
  </svg>
);

export function MentionPicker({
  mentions,
  onChange,
  scope,
  open: openProp,
  onOpenChange,
}: {
  mentions: DraftMention[];
  onChange: (m: DraftMention[]) => void;
  scope: PeopleScope;
  /** CR-186 · điều khiển từ ngoài (ô bình luận mở hộp khi gõ «@»); vắng ⇒ tự quản. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { brandAccent, isHostViewer } = useApp();
  const [openIn, setOpenIn] = useState(false);
  const open = openProp ?? openIn;
  const setOpen = (v: boolean) => {
    setOpenIn(v);
    onOpenChange?.(v);
  };
  const [sel, setSel] = useState<DraftMention[]>(mentions);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<MentionGroup | undefined>();
  // mỗi lần hộp MỞ (bấm nút hay gõ «@»): chọn lại từ danh sách đã nhắc, xoá ô tìm, nhóm «Tất cả»
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi `open` đổi
  useEffect(() => {
    if (!open) return;
    setSel(mentions);
    setQ("");
    setGroup(undefined);
  }, [open]);
  const { people, more, state, loadMore } = usePeople(open, q, scope, group);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!more || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void loadMore());
    io.observe(el);
    return () => io.disconnect();
  }, [more, loadMore]);
  const full = sel.length >= POST_MENTIONS_MAX;
  const toggle = (o: Person) =>
    setSel((l) =>
      l.some((x) => x.userId === o.userId)
        ? l.filter((x) => x.userId !== o.userId)
        : l.length >= POST_MENTIONS_MAX
          ? l
          : [...l, toMention(o)],
    );
  const label = t("community.draft.mentionLabel");
  return (
    <>
      <IconButton
        className="ghost icononly"
        data-testid="mention-open"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <UserPlus />
        {mentions.length > 0 && <span className="n">{mentions.length}</span>}
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px]" aria-describedby={undefined}>
          <div data-mod="community" data-accent={brandAccent} data-testid="mention-dialog">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
            </DialogHeader>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row" data-testid="mention-filters">
              {isHostViewer && (
                <Select
                  value={group ?? "all"}
                  onValueChange={(v) => setGroup(v === "all" ? undefined : (v as MentionGroup))}
                >
                  <SelectTrigger
                    className="sm:w-40"
                    aria-label={t("community.draft.mentionGroupLabel")}
                    data-testid="mention-group"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("community.draft.mentionGroupAll")}</SelectItem>
                    {MENTION_GROUPS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GROUP_LABEL[g]()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                type="search"
                className="flex-1"
                aria-label={t("community.draft.mentionSearch")}
                placeholder={t("community.draft.mentionSearch")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <p className="fhint">
              {t("community.draft.mentionScopeHint", { max: POST_MENTIONS_MAX })}
            </p>
            {full && (
              <div className="cnote" role="status" data-testid="mention-full">
                {t("community.draft.mentionFull", { max: POST_MENTIONS_MAX })}
              </div>
            )}
            <ul
              className="mplist flex flex-col gap-1"
              data-testid="mention-list"
              aria-busy={state === "loading"}
            >
              {state === "loading" && people.length === 0 && (
                <li className="fhint">{t("community.draft.mentionLoading")}</li>
              )}
              {state === "error" && <li className="fhint">{t("community.draft.mentionError")}</li>}
              {state === "ok" && people.length === 0 && (
                <li className="fhint">{t("community.draft.mentionEmpty")}</li>
              )}
              {people.map((o) => (
                <PersonRow
                  key={o.userId}
                  p={o}
                  on={sel.some((x) => x.userId === o.userId)}
                  disabled={full}
                  toggle={() => toggle(o)}
                />
              ))}
              {more && (
                <li ref={end}>
                  <Button variant="link" onClick={() => void loadMore()}>
                    {t("community.draft.mentionMore")}
                  </Button>
                </li>
              )}
            </ul>
            <div className="cbar">
              <div className="sp" />
              <Button variant="quiet" onClick={() => setOpen(false)}>
                {t("community.common.cancel")}
              </Button>
              <Button
                variant="primary"
                data-testid="mention-done"
                onClick={() => {
                  onChange(sel);
                  setOpen(false);
                }}
              >
                {t("community.draft.mentionDone", { count: sel.length })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
