// HUB-FR-68 · màn Secrets nạp lười. `?kind=` chọn tab, `?drawer=new|<id>` mở Sheet.
import { HUB_SECRET_KINDS, type HubSecretKind } from "@ai/contracts/hub-admin";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/secrets")({
  validateSearch: (raw: Record<string, unknown>): { kind?: HubSecretKind; drawer?: string } => ({
    kind: HUB_SECRET_KINDS.find((k) => k === raw.kind),
    drawer: typeof raw.drawer === "string" && raw.drawer !== "" ? raw.drawer : undefined,
  }),
  component: lazyRouteComponent(
    () => import("#/features/secrets/pages/SecretsPage"),
    "SecretsPage",
  ),
});
