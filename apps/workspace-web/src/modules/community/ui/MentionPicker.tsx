// CR-147c · «Nhắc tên» (bản mẫu cr147-mention-picker): thanh công cụ chỉ có biểu tượng 👤+; bấm mở hộp thoại tìm + chọn tối đa 10 người,
// danh sách tải dần khi cuộn. Chỉ người xem được bài (server lọc, CR-145). Người đã chọn hiện thành chip ở ô đăng (MentionChips).
// Ảnh đại diện: chưa có PersonAvatar trên nhánh này ⇒ chữ cái đầu; phòng ban · chức vụ: API chưa trả ⇒ chỉ hiện tên công ty (nếu có).

import { POST_MENTIONS_MAX } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { IconButton } from "~/shared/ui/IconButton";
import { useApp } from "../application/ctx";
import type { PeopleScope } from "../application/ports";
import { usePeople } from "../application/usePeople";
import { initials } from "../domain/format";
import type { DraftMention } from "../domain/mention";
import { t } from "../i18n";
import { IconX } from "./icons";

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
      <label className="mprow" data-testid="mention-option">
        <input type="checkbox" checked={on} disabled={disabled && !on} onChange={toggle} />
        <span className="av sm t1" aria-hidden="true">
          {initials(p.name)}
        </span>
        <span className="mpname">{p.name}</span>
        {p.orgName && <span className="muted">{p.orgName}</span>}
      </label>
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
}: {
  mentions: DraftMention[];
  onChange: (m: DraftMention[]) => void;
  scope: PeopleScope;
}) {
  const { brandAccent } = useApp();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<DraftMention[]>(mentions);
  const [q, setQ] = useState("");
  const { people, more, state, loadMore } = usePeople(open, q, scope);
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
        onClick={() => {
          setSel(mentions);
          setQ("");
          setOpen(true);
        }}
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
            <Input
              type="search"
              className="mb-3"
              aria-label={t("community.draft.mentionSearch")}
              placeholder={t("community.draft.mentionSearch")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <p className="fhint">
              {t("community.draft.mentionScopeHint", { max: POST_MENTIONS_MAX })}
            </p>
            {full && (
              <div className="cnote" role="status" data-testid="mention-full">
                {t("community.draft.mentionFull", { max: POST_MENTIONS_MAX })}
              </div>
            )}
            <ul className="mplist" data-testid="mention-list" aria-busy={state === "loading"}>
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
