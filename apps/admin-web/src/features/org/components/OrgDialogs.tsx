// CR-189 · BR-189-6 · hộp thoại của menu «⋯» trên sơ đồ sửa: Đổi trưởng phòng (ô chọn avatar), Thêm/bớt thành viên (hộp chọn),
// Chuyển phòng cha (cây, chặn con cháu), Xoá (xác nhận; còn người/phòng con ⇒ câu nghiệp vụ, không xoá).
import type { OrgDepartment, OrgMember } from "@ai/contracts/org";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { Input } from "@ai/web-kit/ui/kit/input";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { notifyError } from "@ai/web-kit/ui/toast";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { deptLoad, parentChoices } from "../lib/org-edit";
import type { useOrgOps } from "../lib/use-org-ops";

export type OrgDialogKind = "head" | "members" | "move" | "delete";
type Ops = ReturnType<typeof useOrgOps>;
type Common = {
  dept: OrgDepartment;
  depts: readonly OrgDepartment[];
  members: readonly OrgMember[];
  ops: Ops;
  onClose: () => void;
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();

function Person({ m, sub }: { m: OrgMember; sub?: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <PersonAvatar id={m.user_id} name={m.display_name} size={32} interactive={false} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{m.display_name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {sub ?? m.job_title ?? ""}
        </span>
      </span>
    </span>
  );
}

/** Tên phòng mà người đang là trưởng phòng (khác `except`), nếu có. */
function headOf(
  depts: readonly OrgDepartment[],
  uid: string,
  except: string,
): OrgDepartment | undefined {
  return depts.find((d) => d.head_user_id === uid && d.group_id !== except);
}

function Shell({
  title,
  desc,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  desc?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  testId: string;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={desc ? "" : "sr-only"}>{desc ?? title}</DialogDescription>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HeadDialog({ dept, depts, members, ops, onClose }: Common) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<string | null>(dept.head_user_id);
  const save = async () => {
    const m = members.find((x) => x.user_id === sel);
    const err = await ops.setHead(dept.group_id, sel, m?.display_name ?? "");
    if (err) return notifyError(err);
    onClose();
  };
  return (
    <Shell
      testId="org-head-dialog"
      title={t("orgEdit.headTitle", { name: dept.name })}
      desc={t("orgEdit.headHint")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="org-head-save" disabled={sel === dept.head_user_id} onClick={save}>
            {t("orgEdit.save")}
          </Button>
        </>
      }
    >
      <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label={t("orgEdit.head")}>
        <li>
          <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
            <input
              type="radio"
              name="org-head"
              checked={sel === null}
              onChange={() => setSel(null)}
            />
            <span className="text-sm text-muted-foreground">{t("orgEdit.noHead")}</span>
          </label>
        </li>
        {members.map((m) => {
          const other = headOf(depts, m.user_id, dept.group_id);
          return (
            <li key={m.user_id}>
              <label
                className={`flex items-center gap-3 rounded-md p-2 ${other ? "opacity-60" : "cursor-pointer hover:bg-accent"}`}
              >
                <input
                  type="radio"
                  name="org-head"
                  data-testid={`org-head-opt-${m.user_id}`}
                  disabled={!!other}
                  checked={sel === m.user_id}
                  onChange={() => setSel(m.user_id)}
                />
                <Person m={m} sub={other ? t("orgEdit.headOf", { name: other.name }) : null} />
              </label>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

export function MembersDialog({ dept, depts, members, ops, onClose }: Common) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const initial = useMemo(() => new Set(dept.member_ids), [dept]);
  const [chosen, setChosen] = useState<Set<string>>(initial);
  const deptOf = (uid: string) => depts.find((d) => d.member_ids.includes(uid));
  const shown = members.filter((m) => !q || norm(m.display_name).includes(norm(q)));
  const add = [...chosen].filter((u) => !initial.has(u));
  const remove = [...initial].filter((u) => !chosen.has(u));
  const save = async () => {
    const err = await ops.members(dept.group_id, add, remove);
    if (err) return notifyError(err);
    onClose();
  };
  const toggle = (u: string, on: boolean) =>
    setChosen((s) => {
      const n = new Set(s);
      if (on) n.add(u);
      else n.delete(u);
      return n;
    });
  return (
    <Shell
      testId="org-members-edit-dialog"
      title={t("orgEdit.membersTitle", { name: dept.name })}
      desc={t("orgEdit.membersHint")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="org-members-save"
            disabled={add.length === 0 && remove.length === 0}
            onClick={save}
          >
            {t("orgEdit.save")}
          </Button>
        </>
      }
    >
      <Input
        type="search"
        aria-label={t("orgEdit.searchPerson")}
        placeholder={t("orgEdit.searchPerson")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
        {shown.map((m) => {
          const other = headOf(depts, m.user_id, dept.group_id);
          const cur = deptOf(m.user_id);
          const sub = other
            ? t("orgEdit.headOf", { name: other.name })
            : cur && cur.group_id !== dept.group_id
              ? t("orgEdit.willMove", { name: cur.name })
              : null;
          return (
            <li key={m.user_id}>
              <label
                htmlFor={`org-mem-${m.user_id}`}
                className={`flex items-center gap-3 rounded-md p-2 ${other ? "opacity-60" : "cursor-pointer hover:bg-accent"}`}
              >
                <Checkbox
                  id={`org-mem-${m.user_id}`}
                  data-testid={`org-member-opt-${m.user_id}`}
                  disabled={!!other}
                  checked={chosen.has(m.user_id)}
                  onCheckedChange={(v) => toggle(m.user_id, v === true)}
                  aria-label={m.display_name}
                />
                <Person m={m} sub={sub} />
              </label>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

export function MoveDialog({ dept, depts, ops, onClose }: Common) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<string | null>(dept.parent_group_id);
  const rows = useMemo(() => parentChoices(depts, dept.group_id), [depts, dept]);
  const save = async () => {
    const err = await ops.move(dept.group_id, sel);
    if (err) return notifyError(err);
    onClose();
  };
  const opt = (value: string | null, label: string, depth: number) => (
    <li key={value ?? "root"} style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <label className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-accent">
        <input
          type="radio"
          name="org-parent"
          data-testid={`org-parent-opt-${value ?? "root"}`}
          checked={sel === value}
          onChange={() => setSel(value)}
        />
        <span className="text-sm">{label}</span>
      </label>
    </li>
  );
  return (
    <Shell
      testId="org-move-dialog"
      title={t("orgEdit.moveTitle", { name: dept.name })}
      desc={t("orgEdit.moveHint")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="org-move-save"
            disabled={sel === dept.parent_group_id}
            onClick={save}
          >
            {t("orgEdit.moveSave")}
          </Button>
        </>
      }
    >
      <ul className="max-h-72 overflow-y-auto" aria-label={t("orgEdit.parent")}>
        {opt(null, t("orgEdit.rootCompany"), 0)}
        {rows.map((r) => opt(r.dept.group_id, r.dept.name, r.depth + 1))}
      </ul>
    </Shell>
  );
}

export function DeleteDialog({ dept, depts, ops, onClose }: Common) {
  const { t } = useTranslation();
  const load = deptLoad(depts, dept.group_id);
  if (load.members > 0 || load.children > 0) {
    const what =
      load.members > 0 && load.children > 0 ? "both" : load.members > 0 ? "members" : "children";
    return (
      <BlockedDialog open onClose={onClose} title={t("orgEdit.blockedTitle", { name: dept.name })}>
        <p data-testid="org-delete-blocked" className="text-sm">
          {t(`orgEdit.err.notEmpty.${what}`, load)}
        </p>
      </BlockedDialog>
    );
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("orgEdit.deleteTitle", { name: dept.name })}
      description={t("orgEdit.deleteConfirm")}
      confirmLabel={t("orgEdit.remove")}
      destructive
      onConfirm={async () => {
        const err = await ops.remove(dept.group_id);
        if (err) {
          notifyError(err);
          throw new Error(err);
        }
        onClose();
      }}
    />
  );
}
