// PK-FR-10 · HD-FR-51 · S03: /contracts — danh sách hợp đồng (HD5). Gap #10: lọc ngày trên URL (`due`, `dfield`, `df`, `dt`).
import { createFileRoute } from "@tanstack/react-router";
import { parseDateSearch } from "~/features/contracts-list/lib/date-filter";
import { ContractsListPage } from "~/features/contracts-list/pages/ContractsListPage";

export const Route = createFileRoute("/_authed/contracts/")({
  validateSearch: parseDateSearch,
  component: ContractsListPage,
});
