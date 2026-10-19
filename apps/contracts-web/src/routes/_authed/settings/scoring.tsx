// PK-FR-10 · HD8-FR-03 · route /settings/scoring — cách tính điểm uy tín (port mgmt `ScoringPage.tsx`).
import { createFileRoute } from "@tanstack/react-router";
import { ScoringPage } from "~/features/scoring/pages/ScoringPage";

export const Route = createFileRoute("/_authed/settings/scoring")({ component: ScoringPage });
