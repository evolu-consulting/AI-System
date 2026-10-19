// M1D-FR-03 · phòng ban: tạo (Group + đánh dấu), trưởng phòng, thêm/gỡ thành viên, bỏ phòng ban (Group giữ nguyên).
import type { OrgResponse } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addDeptMember,
  createDepartment,
  removeDepartment,
  removeDeptMember,
  setHead,
} from "../api";

const field = "h-[34px] rounded-md border border-rule bg-panel px-2 text-body";
const btn =
  "rounded-md border border-rule px-3 py-1.5 text-body hover:bg-act-soft disabled:opacity-50";

type Props = {
  data: OrgResponse;
  name: (id: string | null) => string;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
};

export function DepartmentsCard({ data, name, busy, act }: Props) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("contracts.org.departments")}</h2>
      {data.departments.length === 0 && (
        <p className="text-body text-dim">{t("contracts.org.empty")}</p>
      )}
      {data.departments.map((d) => (
        <article
          key={d.group_id}
          className="flex flex-col gap-2 rounded-lg border border-rule bg-panel p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-semibold">{d.name}</h3>
            <label className="flex items-center gap-2 text-body">
              {t("contracts.org.head")}
              <select
                aria-label={`${t("contracts.org.head")} · ${d.name}`}
                className={field}
                value={d.head_user_id ?? ""}
                disabled={busy}
                onChange={(e) => act(() => setHead(d.group_id, e.target.value || null))}
              >
                <option value="">{t("contracts.org.none")}</option>
                {data.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`${btn} ml-auto`}
              disabled={busy}
              onClick={() => act(() => removeDepartment(d.group_id))}
            >
              {t("contracts.org.removeDept")}
            </button>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label={t("contracts.org.deptMembers")}>
            {d.member_ids.map((id) => (
              <li
                key={id}
                className="flex items-center gap-1 rounded-full bg-act-soft px-3 py-1 text-body"
              >
                {name(id)}
                <button
                  type="button"
                  aria-label={`${t("contracts.org.removeMember")} · ${name(id)}`}
                  disabled={busy}
                  className="text-dim hover:text-late"
                  onClick={() => act(() => removeDeptMember(d.group_id, id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <select
            aria-label={`${t("contracts.org.addMember")} · ${d.name}`}
            className={`${field} w-fit`}
            value=""
            disabled={busy}
            onChange={(e) => {
              const u = data.members.find((m) => m.user_id === e.target.value);
              if (u) act(() => addDeptMember(d.group_id, u.username));
            }}
          >
            <option value="">{t("contracts.org.addMember")}</option>
            {data.members
              .filter((m) => !d.member_ids.includes(m.user_id))
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
          </select>
        </article>
      ))}
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await createDepartment(key, title);
            setKey("");
            setTitle("");
          });
        }}
      >
        <h3 className="w-full font-semibold">{t("contracts.org.newDept")}</h3>
        <label className="flex flex-col gap-1 text-body">
          {t("contracts.org.deptName")}
          <input
            required
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-body">
          {t("contracts.org.deptKey")}
          <input
            required
            pattern="[a-z0-9-]{2,32}"
            className={field}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <button type="submit" className={btn} disabled={busy || !key || !title}>
          {t("contracts.org.create")}
        </button>
      </form>
    </section>
  );
}
