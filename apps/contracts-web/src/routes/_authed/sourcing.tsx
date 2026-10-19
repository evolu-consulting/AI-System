// W1: /sourcing — "Mua hàng" (nguồn hàng, lãi, rủi ro nhà cung cấp).
import { createFileRoute } from "@tanstack/react-router";
import { SourcingPage } from "~/features/sourcing/pages/SourcingPage";

export const Route = createFileRoute("/_authed/sourcing")({ component: SourcingPage });
