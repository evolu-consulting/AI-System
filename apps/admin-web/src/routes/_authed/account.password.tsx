import { createFileRoute } from "@tanstack/react-router";
import { SelfPasswordPage } from "@/features/auth/pages/SelfPasswordPage";

export const Route = createFileRoute("/_authed/account/password")({ component: SelfPasswordPage });
