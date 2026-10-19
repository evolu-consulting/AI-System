// PK-FR-10 · HD-FR-97 · S11: /cks/$id — khách chữ ký số (HD9).
import { createFileRoute } from "@tanstack/react-router";
import { CksCustomerPage } from "~/features/cks/pages/CksCustomerPage";

export const Route = createFileRoute("/_authed/cks/$id")({ component: CksCustomerPage });
