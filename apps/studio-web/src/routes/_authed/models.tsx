// HUB-FR-66 · màn Models nạp lười. `?tab=providers|profiles`, `?drawer=new|<id>`, `?guide=<id>` (Runbook, T5b).
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

type Tab = "providers" | "profiles";
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/_authed/models")({
  validateSearch: (
    raw: Record<string, unknown>,
  ): { tab?: Tab; drawer?: string; guide?: string } => ({
    tab: raw.tab === "providers" || raw.tab === "profiles" ? raw.tab : undefined,
    drawer: str(raw.drawer),
    guide: str(raw.guide),
  }),
  component: lazyRouteComponent(() => import("#/features/models/pages/ModelsPage"), "ModelsPage"),
});
