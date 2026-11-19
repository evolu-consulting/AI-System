// CR-139d · CR-189 · «Cơ cấu tổ chức» (Admin › Công ty › Thành viên › Cơ cấu): SỬA TRỰC TIẾP trên sơ đồ — «+» thêm phòng con gõ tên tại chỗ,
// bấm tên đổi tên, «⋯» (đổi trưởng phòng · thêm/bớt thành viên · chuyển phòng cha · xoá), kéo thả trên máy tính. Mọi thay đổi có toast «Hoàn tác»
// 6 giây. Sổ Hợp Tác chỉ xem cây này (nút «Chỉnh sơ đồ» dẫn về đây). Ghi qua admin-api (`/admin/org*`), có audit.
import type { OrgChartEdit } from "@ai/flow-canvas";
import { notifyError } from "@ai/web-kit/ui/toast";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceView } from "@/features/tenants/lib/use-workspace-view";
import { useSession } from "@/lib/auth/use-session";
import { useOrgApi, useOrgData } from "../api";
import { DeptMenu } from "../components/DeptMenu";
import { MemberTitles } from "../components/MemberTitles";
import { OrgDiagram } from "../components/OrgDiagram";
import {
  DeleteDialog,
  HeadDialog,
  MembersDialog,
  MoveDialog,
  type OrgDialogKind,
} from "../components/OrgDialogs";
import { toChartDepts } from "../lib/org-chart-data";
import { canMoveDept } from "../lib/org-edit";
import { useIsTouch } from "../lib/use-is-touch";
import { useOrgOps } from "../lib/use-org-ops";

export function OrgEditor() {
  const { t } = useTranslation();
  const view = useWorkspaceView(useSession((s) => s.me));
  const org = useOrgData(view.tenantId);
  const api = useOrgApi(view.tenantId);
  const depts = useMemo(() => org.data?.departments ?? [], [org.data]);
  const members = useMemo(() => org.data?.members ?? [], [org.data]);
  const chart = useMemo(() => toChartDepts(org.data), [org.data]);
  const ops = useOrgOps(api, depts);
  const touch = useIsTouch();
  const [dlg, setDlg] = useState<{ kind: OrgDialogKind; id: string } | null>(null);

  const edit = useMemo<OrgChartEdit>(
    () => ({
      touch,
      labels: {
        addChild: (name) => t("orgEdit.addChild", { name }),
        rename: t("orgEdit.renameHint"),
        renameInput: t("orgEdit.renameInput"),
        newName: t("orgEdit.newName"),
        newPlaceholder: t("orgEdit.newPlaceholder"),
        ok: t("orgEdit.add"),
        cancel: t("common.cancel"),
        nameRequired: t("orgEdit.nameRequired"),
        dragHint: t("orgEdit.dragHint"),
      },
      onAdd: ops.add,
      onRename: ops.rename,
      canMove: (id, to) => canMoveDept(depts, id, to),
      onMove: (id, to) => void ops.move(id, to).then((err) => err && notifyError(err)),
      renderMenu: (id) => (
        <DeptMenu
          id={id}
          name={depts.find((d) => d.group_id === id)?.name ?? ""}
          onPick={(kind) => setDlg({ kind, id })}
        />
      ),
    }),
    [t, touch, ops, depts],
  );

  if (org.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("orgEdit.loadError")}
      </p>
    );
  const target = dlg ? depts.find((d) => d.group_id === dlg.id) : undefined;
  const common = target && { dept: target, depts, members, ops, onClose: () => setDlg(null) };
  return (
    <section className="space-y-3" data-testid="org-editor">
      <p className="text-sm text-muted-foreground">{t("orgEdit.lead")}</p>
      {org.isPending ? null : <OrgDiagram depts={chart} edit={edit} />}
      {chart.length === 0 && !org.isPending ? (
        <p className="text-sm text-muted-foreground" data-testid="org-editor-empty">
          {t("orgEdit.empty")}
        </p>
      ) : null}
      {members.length > 0 ? (
        <MemberTitles
          members={members}
          busy={false}
          act={(fn) =>
            void fn()
              .then(api.refresh)
              .catch((e: unknown) => notifyError(ops.text(e)))
          }
          save={api.setTitle}
        />
      ) : null}
      {common && dlg?.kind === "head" ? <HeadDialog {...common} /> : null}
      {common && dlg?.kind === "members" ? <MembersDialog {...common} /> : null}
      {common && dlg?.kind === "move" ? <MoveDialog {...common} /> : null}
      {common && dlg?.kind === "delete" ? <DeleteDialog {...common} /> : null}
    </section>
  );
}
