// CR-132 · W2 · «Thành viên nhóm»: danh sách + vai; chủ nhóm đổi tên / thêm / bớt người; mọi thành viên «Rời nhóm».
// Người không phải chủ thấy lý do vì sao không có nút («Chỉ chủ nhóm…») — không để thao tác ẩn.
import type { ConversationDetail } from "@ai/contracts/pack-contracts";
import { MSG_GROUP_MAX, MSG_TITLE_MAX } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useGroupActions } from "../hooks/use-chat";
import { usePeople } from "../hooks/use-conversations";
import { errorKey } from "../lib/errors";
import { canLeave, canManage, canRemoveMember } from "../lib/perms";
import { PeoplePicker } from "./PeoplePicker";

export function GroupMembersSheet({
  open,
  detail,
  myId,
  onClose,
  onLeft,
}: {
  open: boolean;
  detail: ConversationDetail;
  myId: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const { t } = useTranslation();
  const act = useGroupActions(detail.id);
  const owner = canManage(detail);
  const people = usePeople(open && owner);
  const [title, setTitle] = useState(detail.title ?? "");
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const fail = (e: unknown) => toast(t(errorKey(e)), "late");
  const room = MSG_GROUP_MAX - detail.members.length;
  const others = detail.members.filter((m) => m.user_id !== myId).length;

  const rename = () =>
    act.rename.mutate(title.trim(), {
      onSuccess: () => toast(t("contracts.messages.renamed"), "ok"),
      onError: fail,
    });
  const add = () =>
    act.add.mutate([...adding], {
      onSuccess: () => {
        setAdding(new Set());
        toast(t("contracts.messages.added"), "ok");
      },
      onError: fail,
    });
  const kick = async (id: string, name: string) => {
    if (
      !(await confirmDialog({
        title: t("contracts.messages.removeMember"),
        body: t("contracts.messages.removeConfirm", { name }),
        danger: true,
      }))
    )
      return;
    act.remove.mutate(id, {
      onSuccess: () => toast(t("contracts.messages.removed"), "ok"),
      onError: fail,
    });
  };
  const leave = async () => {
    const body =
      others === 0 ? t("contracts.messages.leaveLast") : t("contracts.messages.leaveConfirm");
    if (!(await confirmDialog({ title: t("contracts.messages.leave"), body, danger: true })))
      return;
    act.remove.mutate(myId, {
      onSuccess: () => {
        toast(t("contracts.messages.left"), "ok");
        onLeft();
      },
      onError: fail,
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="group-members" className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("contracts.messages.membersTitle")}</DialogTitle>
        </DialogHeader>
        {owner ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) rename();
            }}
          >
            <input
              value={title}
              maxLength={MSG_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t("contracts.messages.rename")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line"
            />
            <button
              type="submit"
              className="btn"
              disabled={!title.trim() || title.trim() === detail.title || act.rename.isPending}
            >
              {t("contracts.messages.renameSave")}
            </button>
          </form>
        ) : (
          <p className="m-0 text-label text-dim">{t("contracts.messages.ownerOnly")}</p>
        )}
        <ul className="m-0 list-none p-0">
          {detail.members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-2 border-b border-rule-soft py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px]">
                {m.name}
                {!m.active && (
                  <span className="ml-2 text-micro text-dim">
                    {t("contracts.messages.inactive")}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-micro text-dim">
                {m.role === "owner"
                  ? t("contracts.messages.roleOwner")
                  : t("contracts.messages.roleMember")}
              </span>
              {canRemoveMember(detail, m.user_id, myId) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void kick(m.user_id, m.name)}
                >
                  {t("contracts.messages.removeMember")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && room > 0 && (
          <section aria-label={t("contracts.messages.addPeople")} className="grid gap-2">
            <h3 className="m-0 text-label font-semibold">{t("contracts.messages.addPeople")}</h3>
            <PeoplePicker
              people={people.data?.items ?? []}
              status={people.isPending ? "loading" : people.isError ? "error" : "ready"}
              selected={adding}
              onToggle={(id) =>
                setAdding((s) => {
                  const n = new Set(s);
                  if (!n.delete(id) && n.size < room) n.add(id);
                  return n;
                })
              }
              onRetry={() => void people.refetch()}
              disabledIds={detail.members.map((m) => m.user_id)}
            />
            <button
              type="button"
              className="btn btn-primary justify-self-end"
              disabled={adding.size === 0 || act.add.isPending}
              onClick={add}
            >
              {t("contracts.messages.addDo")}
            </button>
          </section>
        )}
        {owner && room <= 0 && (
          <p role="status" className="m-0 text-label text-dim">
            {t("contracts.messages.groupFull", { n: MSG_GROUP_MAX })}
          </p>
        )}
        {canLeave(detail) && (
          <button
            type="button"
            className="btn justify-self-start text-late"
            onClick={() => void leave()}
          >
            {t("contracts.messages.leave")}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
