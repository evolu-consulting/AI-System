// CR-132 · W2 · «Nhắn tin mới»: chọn 1 người ⇒ mở 1-1; chọn ≥ 2 ⇒ hiện «Tên nhóm» (bắt buộc) + «Tạo nhóm».
import { MSG_GROUP_MAX, MSG_TITLE_MAX } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useCreateConversation, usePeople } from "../hooks/use-conversations";
import { errorKey } from "../lib/errors";
import { pickMode } from "../lib/people";
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
  const people = usePeople(open);
  const create = useCreateConversation();
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const mode = pickMode(sel.size);
  const nameMissing = mode === "group" && title.trim() === "";
  const reset = () => {
    setSel(new Set());
    setTitle("");
    setTouched(false);
    create.reset();
  };
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const submit = () => {
    setTouched(true);
    const ids = [...sel];
    if (mode === "none" || mode === "full" || nameMissing || create.isPending) return;
    const body =
      mode === "direct" && ids[0]
        ? ({ kind: "direct", user_id: ids[0] } as const)
        : ({ kind: "group", title: title.trim(), member_ids: ids } as const);
    create.mutate(body, {
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
    mode === "group" || mode === "full"
      ? t("contracts.messages.createGroup")
      : t("contracts.messages.openChat");
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
          <DialogDescription>{t("contracts.messages.pickHint")}</DialogDescription>
        </DialogHeader>
        <PeoplePicker
          people={people.data?.items ?? []}
          status={people.isPending ? "loading" : people.isError ? "error" : "ready"}
          selected={sel}
          onToggle={toggle}
          onRetry={() => void people.refetch()}
          disabledIds={[myId]}
        />
        {sel.size > 0 && (
          <p className="m-0 text-label text-dim">
            {t("contracts.messages.selectedN", { n: sel.size })}
          </p>
        )}
        {mode === "full" && (
          <p role="alert" className="m-0 text-label text-late">
            {t("contracts.messages.groupFull", { n: MSG_GROUP_MAX })}
          </p>
        )}
        {(mode === "group" || mode === "full") && (
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
            disabled={mode === "none" || mode === "full" || create.isPending}
            onClick={submit}
          >
            {label}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
