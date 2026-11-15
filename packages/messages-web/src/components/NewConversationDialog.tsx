// CR-132 · W2 · «Nhắn tin mới»: chọn 1 người ⇒ mở 1-1; chọn ≥ 2 ⇒ hiện «Tên nhóm» (bắt buộc) + «Tạo nhóm».
import { MSG_GROUP_MAX, MSG_TITLE_MAX, type MsgPerson } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompanies, useCreateConversation } from "../hooks/use-conversations";
import { errorKey } from "../lib/errors";
import { pickMode } from "../lib/people";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui";
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

/** CR-169 · «Người của công ty»: công ty mình (nhắn riêng/nhóm) hoặc một công ty đã kết nối (nhắn riêng 1 người). */
function ScopeField({
  value,
  onChange,
  ownId,
  ownName,
  enabled,
}: {
  value: string;
  onChange: (v: string) => void;
  ownId: string;
  ownName: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const companies = useCompanies(enabled);
  if (companies.items.length === 0 && !companies.hasNextPage) return null;
  return (
    <label className="grid gap-1 text-label">
      <span className="font-medium">{t("contracts.messages.scopeLabel")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="new-conv-scope"
        className="h-9 rounded-lg border border-field bg-panel px-2 text-[13.5px] outline-none focus-visible:border-act-line"
      >
        <option value="own">{ownName || ownId}</option>
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
  ownId,
  ownName,
  onClose,
  onOpened,
}: {
  open: boolean;
  myId: string;
  ownId: string;
  ownName: string;
  onClose: () => void;
  /** Mở hội thoại vừa tạo / đã có. */
  onOpened: (id: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateConversation();
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [scope, setScope] = useState("own");
  const [pickedPerson, setPickedPerson] = useState<MsgPerson | null>(null);
  const partner = scope !== "own";
  const mode = partner ? (sel.size > 0 ? "direct" : "none") : pickMode(sel.size);
  const nameMissing = mode === "group" && title.trim() === "";
  const reset = () => {
    setSel(new Set());
    setTitle("");
    setTouched(false);
    setScope("own");
    setPickedPerson(null);
    create.reset();
  };
  const changeScope = (v: string) => {
    setScope(v);
    setSel(new Set());
    setPickedPerson(null);
    create.reset();
  };
  const toggle = (id: string, person: MsgPerson) => {
    if (partner) {
      // Công ty khác: nhắn riêng 1 người, chọn người khác thì thay.
      setSel((s) => (s.has(id) ? new Set() : new Set([id])));
      setPickedPerson((p) => (p?.id === id ? null : person));
      return;
    }
    setSel((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  };
  const submit = () => {
    setTouched(true);
    const ids = [...sel];
    if (mode === "none" || mode === "full" || nameMissing || create.isPending) return;
    const body =
      partner && pickedPerson
        ? ({
            kind: "partner",
            tenant_id: pickedPerson.company.id,
            user_id: pickedPerson.id,
          } as const)
        : mode === "direct" && ids[0]
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
          <DialogDescription>
            {partner ? t("contracts.messages.pickHintPartner") : t("contracts.messages.pickHint")}
          </DialogDescription>
        </DialogHeader>
        <ScopeField
          value={scope}
          onChange={changeScope}
          ownId={ownId}
          ownName={ownName}
          enabled={open}
        />
        <PeoplePicker
          key={scope}
          enabled={open}
          selected={sel}
          onToggle={toggle}
          disabledIds={[myId]}
          company={scope}
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
            {t("contracts.common.cancel")}
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
