// CR-139d · «Cơ cấu tổ chức» (tab Thành viên › Cơ cấu): sơ đồ cây của công ty để chỉnh — thêm/đổi tên/xoá phòng, «Thuộc phòng», trưởng phòng, thành viên.
// Sổ Hợp Tác chỉ xem cây này (nút «Chỉnh sơ đồ» dẫn về đây). Ghi qua admin-api (`/admin/org*`, `/admin/groups*`), có audit.
import { notifyError } from "@ai/web-kit/ui/toast";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceView } from "@/features/tenants/lib/use-workspace-view";
import { useSession } from "@/lib/auth/use-session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useOrgApi, useOrgData } from "../api";
import { DeptCard } from "../components/DeptCard";
import { OrgPreview } from "../components/OrgPreview";
import { toChartDepts } from "../lib/org-chart-data";
import { buildDeptTree, deptKey, flattenTree } from "../lib/org-edit";

export function OrgEditor() {
  const { t } = useTranslation();
  const tr = useTr();
  const view = useWorkspaceView(useSession((s) => s.me));
  const org = useOrgData(view.tenantId);
  const api = useOrgApi(view.tenantId);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const depts = org.data?.departments ?? [];
  const rows = useMemo(() => flattenTree(buildDeptTree(depts)), [depts]);
  const chart = useMemo(() => toChartDepts(org.data), [org.data]);
  // CR-142 · bấm thẻ phòng trên sơ đồ ⇒ chọn + cuộn tới phòng đó ở form bên dưới
  const pick = (id: string) => {
    setSelected(id);
    document
      .querySelector(`[data-testid="org-dept-${id}"]`)
      ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .then(api.refresh)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
        if (err instanceof ApiError && JSON.stringify(err.details ?? "").includes("dept_cycle"))
          return notifyError(t("orgEdit.cycle"));
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      })
      .finally(() => setBusy(false));
  };

  if (org.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("orgEdit.loadError")}
      </p>
    );
  return (
    <section className="space-y-3" data-testid="org-editor">
      <p className="text-sm text-muted-foreground">{t("orgEdit.lead")}</p>
      {chart.length > 0 ? <OrgPreview depts={chart} selectedId={selected} onSelect={pick} /> : null}
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const title = name.trim();
          if (!title) return;
          act(async () => {
            await api.createDept(deptKey(title), title, parent || null);
            setName("");
            setParent("");
          });
        }}
      >
        <label htmlFor="org-new-name" className="flex flex-col gap-1 text-sm">
          {t("orgEdit.newName")}
          <Input
            id="org-new-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-64"
            maxLength={120}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("orgEdit.parent")}
          <select
            aria-label={t("orgEdit.newParent")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">{t("orgEdit.rootCompany")}</option>
            {rows.map((r) => (
              <option key={r.dept.group_id} value={r.dept.group_id}>
                {`${"— ".repeat(r.depth)}${r.dept.name}`}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          {t("orgEdit.add")}
        </Button>
      </form>
      {org.isPending ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="org-editor-empty">
          {t("orgEdit.empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="org-editor-tree">
          {rows.map((r) => (
            <DeptCard
              key={r.dept.group_id}
              row={r}
              depts={depts}
              members={org.data?.members ?? []}
              busy={busy}
              selected={r.dept.group_id === selected}
              act={act}
              api={api}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
