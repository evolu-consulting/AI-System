// M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · route /settings/members: thành viên, cấp quản lý, phòng ban, chế độ thấy.
import { createFileRoute } from "@tanstack/react-router";
import { OrgPage } from "~/features/org/pages/OrgPage";

export const Route = createFileRoute("/_authed/settings/members")({
  component: OrgPage,
});
