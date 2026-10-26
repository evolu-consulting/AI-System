// CR-097 G2 · GD-FR-01: /transactions/new — tạo nháp giao dịch (`?contract=` điền sẵn HĐ liên kết).
import { createFileRoute } from "@tanstack/react-router";
import { TransactionNewPage } from "~/features/transactions/pages/TransactionNewPage";

export const Route = createFileRoute("/_authed/transactions/new")({
  validateSearch: (s: Record<string, unknown>): { contract?: string } =>
    typeof s.contract === "string" && s.contract ? { contract: s.contract } : {},
  component: TransactionNewPage,
});
