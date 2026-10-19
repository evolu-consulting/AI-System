// PK-FR-10 · HD-FR-26 · S04: /contracts/new — thêm hợp đồng nhập tay (HD2).
import { createFileRoute } from "@tanstack/react-router";
import { NewContractPage } from "~/features/contract-new/pages/NewContractPage";

export const Route = createFileRoute("/_authed/contracts/new")({ component: NewContractPage });
