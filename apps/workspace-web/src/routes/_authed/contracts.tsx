// CR-120 · `/contracts/*`: cổng gói contracts (PackGate) bọc RIÊNG vùng Sổ Hợp Tác; khung (AppShell) nằm ở `_authed` dùng chung với Community.
import { createFileRoute } from "@tanstack/react-router";
import { ContractsGate } from "~/features/pack-state/pages/ContractsGate";

export const Route = createFileRoute("/_authed/contracts")({
  component: ContractsGate,
});
