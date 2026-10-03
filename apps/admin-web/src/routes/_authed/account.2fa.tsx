import { createFileRoute } from "@tanstack/react-router";
import { TwoFactorPage } from "@/features/auth/pages/TwoFactorPage";

export const Route = createFileRoute("/_authed/account/2fa")({ component: TwoFactorPage });
