// CR-121 c14 · R2 · tab Thành viên: Người dùng là mặc định; Nhóm · Đối tác · Phân quyền · Agents là MỤC CON (bộ chọn trên cùng, `?view=`),
// không còn tab riêng. Mỗi mục nhúng màn có sẵn trong workspace công ty (cả platform_admin và tenant_admin; quyền ghi theo vai ở từng màn).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmbeddedTab } from "../components/EmbeddedTab";
import { MEMBER_VIEWS, type MemberView } from "../lib/workspace-tabs";

export function MembersTab({
  view,
  onView,
}: {
  view: MemberView;
  onView: (v: MemberView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" data-testid="members-tab">
      <div
        role="toolbar"
        aria-label={t("tenants.members.sections")}
        className="flex flex-wrap items-center gap-1"
      >
        {MEMBER_VIEWS.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "secondary" : "ghost"}
            aria-pressed={view === v}
            data-testid={`members-view-${v}`}
            onClick={() => onView(v)}
          >
            {t(`tenants.members.view.${v}`)}
          </Button>
        ))}
      </div>
      <EmbeddedTab key={view} tab={view} />
    </div>
  );
}
