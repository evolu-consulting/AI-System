// M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · Cài đặt › Thành viên & phòng ban (theo màn "Thành viên" của mgmt-app): chế độ thấy, cấp quản
// lý mỗi người, phòng ban (trưởng phòng + thành viên). Ghi qua admin-api (tenant_admin) + hub-api (owner gói); 403 ⇒ chỉ đọc lời nhắc.
import type { OrgResponse } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchOrg, fetchVisibility, orgKeys, putVisibility, setManager } from "../api";
import { managerOptions } from "../lib/org";
import { DepartmentsCard } from "./DepartmentsCard";

const field = "h-[34px] rounded-md border border-rule bg-panel px-2 text-body";

export function OrgPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const org = useQuery({
    queryKey: orgKeys.org,
    queryFn: ({ signal }) => fetchOrg(signal),
    retry: false,
  });
  const vis = useQuery({
    queryKey: orgKeys.visibility,
    queryFn: ({ signal }) => fetchVisibility(signal),
    retry: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setErr(null);
      void qc.invalidateQueries({ queryKey: orgKeys.org });
      void qc.invalidateQueries({ queryKey: orgKeys.visibility });
    },
    onError: (e: unknown) =>
      setErr(
        (e as { code?: string }).code === "VALIDATION_ERROR" ? t("contracts.org.cycle") : String(e),
      ),
  });
  const act = (fn: () => Promise<unknown>) => run.mutate(fn);

  if (org.isError)
    return (
      <p role="alert" className="text-body text-dim">
        {t("contracts.org.ownerOnly")}
      </p>
    );
  const data: OrgResponse = org.data ?? { members: [], departments: [] };
  const name = (id: string | null) =>
    data.members.find((m) => m.user_id === id)?.display_name ?? t("contracts.org.none");

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="text-page-title">{t("contracts.org.title")}</h1>
        <p className="mt-1 text-body text-dim">{t("contracts.org.lead")}</p>
      </header>
      {err && (
        <p
          role="alert"
          className="rounded-md border border-late bg-late-bg px-3 py-2 text-body text-late"
        >
          {err}
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-body font-semibold">
        {t("contracts.org.mode")}
        <select
          aria-label={t("contracts.org.mode")}
          className={`${field} w-fit`}
          value={vis.data?.mode ?? "tenant"}
          disabled={run.isPending || !vis.data}
          onChange={(e) => {
            // Đọc giá trị NGAY: `act` chạy bất đồng bộ, lúc đó select có kiểm soát đã bị React trả về giá trị cũ.
            const mode = e.target.value as "tenant" | "org";
            act(() => putVisibility(mode));
          }}
        >
          <option value="tenant">{t("contracts.org.modeTenant")}</option>
          <option value="org">{t("contracts.org.modeOrg")}</option>
        </select>
      </label>
      <div className="overflow-x-auto rounded-lg border border-rule bg-panel">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-dim">{t("contracts.org.member")}</th>
              <th className="px-3 py-2 text-left text-dim">{t("contracts.org.manager")}</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.user_id} className="border-t border-rule">
                <td className="px-3 py-2">
                  <span className="font-medium">{m.display_name}</span>
                  <span className="ml-2 text-dim">{m.username}</span>
                </td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${t("contracts.org.manager")} · ${m.display_name}`}
                    className={field}
                    value={m.manager_id ?? ""}
                    disabled={run.isPending}
                    onChange={(e) => {
                      const managerId = e.target.value || null;
                      act(() => setManager(m.user_id, managerId));
                    }}
                  >
                    <option value="">{t("contracts.org.none")}</option>
                    {managerOptions(data.members, m.user_id).map((x) => (
                      <option key={x.user_id} value={x.user_id}>
                        {x.display_name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DepartmentsCard data={data} name={name} busy={run.isPending} act={act} />
    </section>
  );
}
