// M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · Cài đặt › Thành viên & phòng ban (theo màn "Thành viên" của mgmt-app): chế độ thấy, cấp quản
// lý mỗi người, phòng ban (chỉnh ở admin qua «Chỉnh sơ đồ»). Ghi qua admin-api (tenant_admin) + hub-api (owner gói); 403 ⇒ chỉ đọc lời nhắc.
import { Input } from "@ai/web-kit/ui/kit/input";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditChartButton } from "~/features/org-chart/components/EditChartButton";
import { Pager } from "~/features/table";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { PersonPick } from "~/shared/ui/PersonPick";
import { useIsMobile } from "~/shared/ui/use-is-mobile";
import {
  fetchOrg,
  fetchOrgMembers,
  fetchVisibility,
  orgFullKey,
  orgKeys,
  putVisibility,
  setManager,
} from "../api";
import { OrgTabs } from "../components/OrgTabs";
import { headCandidates, managerNotHead, suggestedHeadOf } from "../lib/org";

export function OrgPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [qRaw, setQRaw] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
  // CR-189: trưởng phòng + phòng của từng người (một lần, không phân trang) cho ô chọn cấp quản lý.
  const full = useQuery({
    queryKey: orgFullKey,
    queryFn: ({ signal }) => fetchOrg(signal),
    retry: false,
    staleTime: 30_000,
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
    onError: (e: unknown) => {
      const x = e as { code?: string; details?: { reason?: string } };
      setErr(
        x.code !== "VALIDATION_ERROR"
          ? String(e)
          : x.details?.reason === "manager_not_head"
            ? t("contracts.org.notHeadError")
            : t("contracts.org.cycle"),
      );
    },
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

  const managerCell = (m: (typeof rows)[number]) => {
    const org = full.data;
    const sug = org ? suggestedHeadOf(org.departments, m.user_id) : null;
    const sugName = sug ? org?.members.find((x) => x.user_id === sug)?.display_name : undefined;
    return (
      <div className="flex flex-col items-start gap-1">
        <PersonPick
          source={`org-heads:${m.user_id}`}
          fetchPage={async (q) => ({
            items: org ? headCandidates(org, m.user_id, q) : [],
            next: null,
          })}
          value={m.manager_id ?? ""}
          valueName={m.manager_name ?? undefined}
          clearable
          placeholder={t("contracts.org.managerPlaceholder")}
          ariaLabel={`${t("contracts.org.manager")} · ${m.display_name}`}
          onChange={(id) => act(() => setManager(m.user_id, id || null))}
        />
        {org && m.manager_id && managerNotHead(org, m.manager_id) && (
          <span
            data-testid="manager-not-head"
            className="rounded-md bg-warning-bg px-2 py-0.5 text-caption font-semibold text-warning"
          >
            {t("contracts.org.notHead")}
          </span>
        )}
        {sug && sugName && !m.manager_id && (
          <button
            type="button"
            data-testid="manager-suggest"
            disabled={run.isPending}
            className="text-caption text-act underline"
            onClick={() => act(() => setManager(m.user_id, sug))}
          >
            {t("contracts.org.suggest", { name: sugName })}
          </button>
        )}
      </div>
    );
  };

  const nameCell = (m: (typeof rows)[number]) => (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={m.display_name} id={m.user_id} size={32} interactive={false} />
      <span className="min-w-0">
        <TruncText text={m.display_name} className="block font-medium" />
        <TruncText text={m.job_title || m.username} className="block text-sm text-dim" />
      </span>
    </span>
  );

  return (
    <section className="flex flex-col gap-5 max-sm:pb-24">
      <OrgTabs active="members" />
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
                {nameCell(m)}
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
                  <td className="px-3 py-2">{nameCell(m)}</td>
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
