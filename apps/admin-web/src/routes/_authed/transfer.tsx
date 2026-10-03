import { createFileRoute } from "@tanstack/react-router";
import { TransferPage } from "@/features/transfer/pages/TransferPage";

export const Route = createFileRoute("/_authed/transfer")({ component: TransferPage });
