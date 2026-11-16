// CR-132 · W2 · «Nhắn tin mới»: chọn 1 người ⇒ mở 1-1; chọn ≥ 2 ⇒ hiện «Tên nhóm» (bắt buộc) + «Tạo nhóm».
// CR-178 · hai tab: «Công ty mình» (theo phòng ban, chọn nhiều ⇒ nhóm, tối đa 50) và «Đối tác» (chọn công ty rồi 1 người ⇒ nhắn riêng; nhóm chỉ nội bộ).
// Người đã chọn hiện thành chip ở ô «Tới:».
import { MSG_GROUP_MAX, MSG_TITLE_MAX, type MsgPerson } from "@ai/contracts/pack-contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompanies, useCreateConversation } from "../hooks/use-conversations";
import { IconClose } from "../icons";
import { errorKey } from "../lib/errors";
import { type NewChatTab, needsGroupName, planNewChat, toggleSelection } from "../lib/new-chat";
import { cn, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui";
import { PeoplePicker } from "./PeoplePicker";

function GroupNameField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className="grid gap-1 text-label">
      <span className="font-medium">{t("contracts.messages.groupName")}</span>
      <input
        value={value}
        maxLength={MSG_TITLE_MAX}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error}
        data-testid="new-conv-title"
        className="h-9 rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line"
      />
      <span className={error ? "text-late" : "text-dim"}>
        {error
          ? t("contracts.messages.groupNameRequired")
          : t("contracts.messages.groupNameHint", { max: MSG_TITLE_MAX })}
      </span>
    </label>
  );
}

/** Ô «Tới:» — chip người đã chọn (bấm × để bỏ). */
function ToField({
  people,
  onRemove,
}: {
  people: readonly MsgPerson[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-label" data-testid="new-conv-to">
      <span className="text-dim">{t("contracts.messages.toLabel")}</span>
      {people.map((p) => (
        <span
          key={p.id}
          data-testid="new-conv-chip"
          className="inline-flex max-w-44 items-center gap-1 rounded-full bg-act-soft py-0.5 pr-1 pl-2.5"
        >
          <span className="truncate">{p.name}</span>
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label={t("contracts.messages.removePicked", { name: p.name })}
            className="grid h-5 w-5 place-items-center rounded-full text-dim hover:bg-sunk hover:text-ink"
          >
            <IconClose width={12} height={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

function TabBar({ tab, onTab }: { tab: NewChatTab; onTab: (t: NewChatTab) => void }) {
  const { t } = useTranslation();
  const item = (id: NewChatTab, label: string) => (
    <button
      type="button"
      aria-pressed={tab === id}
      data-testid={`new-tab-${id}`}
      onClick={() => onTab(id)}
      className={cn(
        "h-8 rounded-lg px-3 text-label",
        tab === id ? "bg-act-soft font-semibold text-ink" : "text-dim hover:bg-sunk",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="toolbar" aria-label={t("contracts.messages.newTitle")} className="flex gap-1">
      {item("own", t("contracts.messages.tabOwn"))}
      {item("partner", t("contracts.messages.tabPartnerNew"))}
    </div>
  );
}

/** Tab «Đối tác»: chọn công ty đã kết nối (mặc định công ty đầu), rồi chọn 1 người của công ty đó. */
function CompanyField({
  value,
  onChange,
  enabled,
}: {
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const companies = useCompanies(enabled);
  const first = companies.items[0]?.id;
  useEffect(() => {
    if (!value && first) onChange(first);
  }, [value, first, onChange]);
  if (companies.items.length === 0 && !companies.hasNextPage)
    return <p className="m-0 text-label text-dim">{t("contracts.messages.partnerNone")}</p>;
  return (
    <label className="grid gap-1 text-label">
      <span className="font-medium">{t("contracts.messages.pickCompany")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="new-conv-scope"
        className="h-9 rounded-lg border border-field bg-panel px-2 text-[13.5px] outline-none focus-visible:border-act-line"
      >
        {companies.items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {companies.hasNextPage && (
        <button
          type="button"
          className="justify-self-start text-label underline"
          onClick={() => void companies.fetchNextPage()}
        >
          {t("contracts.messages.loadMore")}
        </button>
      )}
    </label>
  );
}

export function NewConversationDialog({
  open,
  myId,
  onClose,
  onOpened,
}: {
  open: boolean;
  myId: string;
  onClose: () => void;
  /** Mở hội thoại vừa tạo / đã có. */
  onOpened: (id: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateConversation();
  const [tab, setTab] = useState<NewChatTab>("own");
  const [picked, setPicked] = useState<readonly MsgPerson[]>([]);
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [company, setCompany] = useState("");
  const ids = picked.map((x) => x.id);
  const plan = planNewChat(tab, ids, title, picked[0] ?? null);
  const nameMissing = needsGroupName(tab, ids.length) && title.trim() === "";
  const full = tab === "own" && ids.length >= MSG_GROUP_MAX - 1;
  const reset = () => {
    setTab("own");
    setPicked([]);
    setTitle("");
    setTouched(false);
    setCompany("");
    create.reset();
  };
  const changeTab = (next: NewChatTab) => {
    setTab(next);
    setPicked([]);
    create.reset();
  };
  const toggle = (id: string, person: MsgPerson) => {
    const next = new Set(toggleSelection(ids, id, tab));
    setPicked((cur) =>
      [...cur, person].filter(
        (x, i, a) => next.has(x.id) && a.findIndex((y) => y.id === x.id) === i,
      ),
    );
  };
  const submit = () => {
    setTouched(true);
    if (!plan.ok || create.isPending) return;
    create.mutate(plan.body, {
      onSuccess: (d) => {
        reset();
        onOpened(d.id);
      },
    });
  };
  const close = () => {
    reset();
    onClose();
  };
  const label =
    ids.length >= 2 ? t("contracts.messages.createGroup") : t("contracts.messages.openChat");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent data-testid="new-conv-dialog">
        <DialogHeader>
          <DialogTitle>{t("contracts.messages.newTitle")}</DialogTitle>
          <DialogDescription>
            {tab === "partner"
              ? t("contracts.messages.pickHintPartner")
              : t("contracts.messages.pickHint")}
          </DialogDescription>
        </DialogHeader>
        <TabBar tab={tab} onTab={changeTab} />
        <ToField
          people={picked}
          onRemove={(id) => setPicked((c) => c.filter((x) => x.id !== id))}
        />
        {tab === "partner" && <CompanyField value={company} onChange={setCompany} enabled={open} />}
        {(tab === "own" || company) && (
          <PeoplePicker
            key={tab === "own" ? "own" : company}
            enabled={open}
            selected={new Set(ids)}
            onToggle={toggle}
            disabledIds={[myId]}
            company={tab === "own" ? "own" : company}
          />
        )}
        {full && (
          <p role="alert" className="m-0 text-label text-late">
            {t("contracts.messages.groupFull", { n: MSG_GROUP_MAX })}
          </p>
        )}
        {needsGroupName(tab, ids.length) && (
          <GroupNameField value={title} onChange={setTitle} error={touched && nameMissing} />
        )}
        {create.isError && (
          <p role="alert" className="m-0 text-label text-late">
            {t(errorKey(create.error))}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={close}>
            {t("contracts.messages.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={ids.length === 0 || create.isPending}
            onClick={submit}
          >
            {label}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
