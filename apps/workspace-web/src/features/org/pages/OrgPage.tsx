// M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · Cài đặt › Thành viên & phòng ban (theo màn "Thành viên" của mgmt-app): chế độ thấy, cấp quản
// lý mỗi người, phòng ban (chỉnh ở admin qua «Chỉnh sơ đồ»). Ghi qua admin-api (tenant_admin) + hub-api (owner gói); 403 ⇒ chỉ đọc lời nhắc.
import { Input } from "@ai/web-kit/ui/kit/input";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditChartButton } from "~/features/org-chart/components/EditChartButton";
import { Pager } from "~/features/table";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { PersonSearchSelect } from "~/shared/ui/PersonSearchSelect";
import { useIsMobile } from "~/shared/ui/use-is-mobile";
import {
  fetchOrgMembers,
  fetchOrgPeoplePage,
  fetchVisibility,
  orgKeys,
  putVisibility,
  setManager,
} from "../api";

const field =
  "h-[34px] rounded-md border border-rule bg-panel px-2 text-body max-sm:min-h-11 max-sm:w-full";

export function OrgPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [qRaw, setQRaw] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qRaw.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(h);
  }, [qRaw]);
  // CR-151: trang thành viên tìm + phân trang ở máy chủ (không nạp cả công ty).
  const org = useQuery({
    queryKey: [...orgKeys.org, "members", q, page, pageSize],
    queryFn: ({ signal }) => fetchOrgMembers(q, (page - 1) * pageSize, pageSize, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const vis = useQuery({
    queryKey: orgKeys.visibility,
    queryFn: ({ signal }) => fetchVisibility(signal),
    retry: false,
  });
  const mobile = useIsMobile();
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
  const rows = org.data?.items ?? [];
  const total = org.data?.total ?? 0;

  const managerCell = (m: (typeof rows)[number]) =>
    editing === m.user_id ? (
      <PersonSearchSelect
        source="org-members"
        fetchPage={fetchOrgPeoplePage}
        value={m.manager_id ?? ""}
        valueName={m.manager_name ?? undefined}
        excludeId={m.user_id}
        noneLabel={t("contracts.org.none")}
        disabled={run.isPending}
        onChange={(id) => {
          setEditing(null);
          act(() => setManager(m.user_id, id || null));
        }}
      />
    ) : (
      <button
        type="button"
        aria-label={`${t("contracts.org.manager")} · ${m.display_name}`}
        className={`${field} text-left`}
        disabled={run.isPending}
        onClick={() => setEditing(m.user_id)}
      >
        {m.manager_name ?? t("contracts.org.none")}
      </button>
    );

  return (
    <section className="flex flex-col gap-5 max-sm:pb-24">
      <PageHeader title={t("contracts.org.title")} description={t("contracts.org.lead")} />
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
        <OptionSelect
          aria-label={t("contracts.org.mode")}
          className="w-fit"
          value={vis.data?.mode ?? "tenant"}
          disabled={run.isPending || !vis.data}
          onValueChange={(v) => {
            // Đọc giá trị NGAY: `act` chạy bất đồng bộ, lúc đó select có kiểm soát đã bị React trả về giá trị cũ.
            const mode = v as "tenant" | "org";
            act(() => putVisibility(mode));
          }}
        >
          <option value="tenant">{t("contracts.org.modeTenant")}</option>
          <option value="org">{t("contracts.org.modeOrg")}</option>
        </OptionSelect>
      </label>
      <Input
        type="search"
        value={qRaw}
        onChange={(e) => setQRaw(e.target.value)}
        placeholder={t("contracts.paging.search")}
        aria-label={t("contracts.paging.search")}
        className="w-full sm:max-w-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-rule bg-panel">
        {mobile ? (
          <ul data-testid="org-member-cards" className="m-0 list-none p-0">
            {rows.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-col gap-2 border-t border-rule px-4 py-3 first:border-t-0"
              >
                <span className="min-w-0">
                  <TruncText text={m.display_name} className="block font-medium" />
                  <TruncText text={m.username} className="block text-sm text-dim" />
                </span>
                <span className="flex flex-col gap-1 text-sm text-dim">
                  {t("contracts.org.manager")}
                  {managerCell(m)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <table className="w-full border-collapse text-body">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-dim">{t("contracts.org.member")}</th>
                <th className="px-3 py-2 text-left text-dim">{t("contracts.org.manager")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.user_id} className="border-t border-rule">
                  <td className="px-3 py-2">
                    <span className="font-medium">{m.display_name}</span>
                    <span className="ml-2 text-dim">{m.username}</span>
                  </td>
                  <td className="px-3 py-2">{managerCell(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {org.isSuccess && rows.length === 0 && (
          <p className="m-0 px-3 py-3 text-body text-dim">{t("contracts.paging.none")}</p>
        )}
        <Pager
          t={{
            page,
            pages: Math.max(1, Math.ceil(total / pageSize)),
            setPage,
            total,
            pageSize,
            setPageSize: (n) => {
              setPageSize(n);
              setPage(1);
            },
          }}
        />
      </div>
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-panel px-4 py-3"
        data-testid="org-depts-moved"
      >
        <p className="text-body text-dim">{t("contracts.org.deptsMoved")}</p>
        <EditChartButton />
      </div>
    </section>
  );
}
