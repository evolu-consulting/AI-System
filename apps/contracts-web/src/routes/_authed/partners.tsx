// PK-FR-10 · HD8-FR-01 · route /partners — danh sách đối tác + điểm uy tín (port mgmt `PartnersPage.tsx`).
import { createFileRoute } from "@tanstack/react-router";
import { PartnersPage } from "~/features/partners/pages/PartnersPage";

export const Route = createFileRoute("/_authed/partners")({ component: PartnersPage });
