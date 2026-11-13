// CR-139d · một phòng ban trong màn «Cơ cấu tổ chức»: tên (đổi tên), «Thuộc phòng», trưởng phòng, thành viên, xoá khỏi sơ đồ.
import type { OrgDepartment, OrgMember } from "@ai/contracts/org";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type DeptRow, type OrgActions, parentChoices } from "../lib/org-edit";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

type Props = {
  row: DeptRow;
  depts: readonly OrgDepartment[];
  members: readonly OrgMember[];
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  api: OrgActions;
};

export function DeptCard({ row, depts, members, busy, act, api }: Props) {
  const { t } = useTranslation();
  const d = row.dept;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const who = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? id;
  const head = d.head_user_id;
  return (
    <li
      style={{ marginLeft: `${Math.min(row.depth, 6) * 1.25}rem` }}
      data-testid={`org-dept-${d.group_id}`}
      className="rounded-lg border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              const n = name.trim();
              if (n && n !== d.name) act(() => api.rename(d.group_id, n));
            }}
          >
            <Input
              aria-label={t("orgEdit.rename")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-56"
            />
            <Button type="submit" size="sm">
              {t("orgEdit.save")}
            </Button>
          </form>
        ) : (
          <>
            <h3 className="font-semibold">{d.name}</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setName(d.name);
                setEditing(true);
              }}
            >
              {t("orgEdit.rename")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("orgEdit.removeConfirm", { name: d.name })))
              act(() => api.removeDept(d.group_id));
          }}
        >
          {t("orgEdit.remove")}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          {t("orgEdit.parent")}
          <select
            aria-label={`${t("orgEdit.parent")} · ${d.name}`}
            className={sel}
            disabled={busy}
            value={d.parent_group_id ?? ""}
            onChange={(e) => {
              const parent = e.target.value || null; // đọc ngay: select có kiểm soát bị trả về giá trị cũ trước khi mutation chạy
              act(() => api.setDept(d.group_id, { head_user_id: head, parent_group_id: parent }));
            }}
          >
            <option value="">{t("orgEdit.rootCompany")}</option>
            {parentChoices(depts, d.group_id).map((r) => (
              <option key={r.dept.group_id} value={r.dept.group_id}>
                {`${"— ".repeat(r.depth)}${r.dept.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t("orgEdit.head")}
          <select
            aria-label={`${t("orgEdit.head")} · ${d.name}`}
            className={sel}
            disabled={busy}
            value={head ?? ""}
            onChange={(e) => {
              const h = e.target.value || null;
              act(() => api.setDept(d.group_id, { head_user_id: h }));
            }}
          >
            <option value="">{t("orgEdit.noHead")}</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("orgEdit.members")}>
        {d.member_ids.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
            {who(id)}
            <button
              type="button"
              aria-label={`${t("orgEdit.removeMember")} · ${who(id)}`}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => act(() => api.removeMember(d.group_id, id))}
            >
              ×
            </button>
          </li>
        ))}
        <li>
          <select
            aria-label={`${t("orgEdit.addMember")} · ${d.name}`}
            className={sel}
            disabled={busy}
            value=""
            onChange={(e) => {
              const u = members.find((m) => m.user_id === e.target.value);
              if (u) act(() => api.addMember(d.group_id, u.username));
            }}
          >
            <option value="">{t("orgEdit.addMember")}</option>
            {members
              .filter((m) => !d.member_ids.includes(m.user_id))
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
          </select>
        </li>
      </ul>
    </li>
  );
}
