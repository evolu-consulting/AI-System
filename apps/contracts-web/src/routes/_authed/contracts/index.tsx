// PK-FR-10 · HD-FR-51 · S03: /contracts — danh sách hợp đồng (HD5).
import { createFileRoute } from "@tanstack/react-router";
import { ContractsListPage } from "~/features/contracts-list/pages/ContractsListPage";

export const Route = createFileRoute("/_authed/contracts/")({ component: ContractsListPage });
