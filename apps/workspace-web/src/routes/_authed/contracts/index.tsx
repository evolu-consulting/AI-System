// PK-FR-10 · HD-FR-51 · S03: /contracts — danh sách hợp đồng (HD5). Gap #10: lọc ngày trên URL (`due`, `dfield`, `df`, `dt`).
import { createFileRoute } from "@tanstack/react-router";
import { parseDateSearch } from "~/features/contracts-list/lib/date-filter";
import { parseDocFilter } from "~/features/contracts-list/lib/doc-list";
import { ContractsListPage } from "~/features/contracts-list/pages/ContractsListPage";

/** `?type=` (DOC-ui-list): bộ lọc loại chứng từ; Tất cả ⇒ không ghi lên URL. */
const parseSearch = (raw: Record<string, unknown>) => {
  const type = parseDocFilter(raw.type);
  return { ...parseDateSearch(raw), ...(type === "all" ? {} : { type }) };
};

export const Route = createFileRoute("/_authed/contracts/")({
  validateSearch: parseSearch,
  component: ContractsListPage,
});
