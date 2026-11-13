// CR-142 · bấm thẻ phòng trên sơ đồ ⇒ danh sách thành viên (trưởng phòng đứng đầu). Chỉ xem.
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { headcount, type OrgNode } from "../lib/org-tree";

export function DeptMembersDialog({
  dept,
  onClose,
}: {
  dept: OrgNode | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const others = dept ? dept.members.filter((m) => m.id !== dept.head?.id) : [];
  return (
    <Dialog open={dept !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={dept?.name} data-testid="org-members-dialog">
        <DialogHeader>
          <DialogTitle>{dept?.name}</DialogTitle>
          <DialogDescription>
            {dept ? t("contracts.orgChart.people", { count: headcount(dept) }) : null}
          </DialogDescription>
        </DialogHeader>
        {dept ? (
          <div className="space-y-2 text-sm">
            <p data-testid="org-head">
              <span className="text-dim">{t("contracts.orgChart.head")}: </span>
              {dept.head ? (
                <b>{dept.head.name}</b>
              ) : (
                <span className="text-dim">{t("contracts.orgChart.noHead")}</span>
              )}
            </p>
            {others.length > 0 ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto" data-testid="org-members">
                {others.map((m) => (
                  <li key={m.id}>{m.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-dim">{t("contracts.orgChart.noMembers")}</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
