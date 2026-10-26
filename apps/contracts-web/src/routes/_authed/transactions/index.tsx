// CR-097 G2 · GD-FR-01: /transactions — danh sách giao dịch (`?contract=` lọc theo HĐ).
import { createFileRoute } from "@tanstack/react-router";
import { TransactionsPage } from "~/features/transactions/pages/TransactionsPage";

export const Route = createFileRoute("/_authed/transactions/")({
  validateSearch: (s: Record<string, unknown>): { contract?: string } =>
    typeof s.contract === "string" && s.contract ? { contract: s.contract } : {},
  component: TransactionsPage,
});
