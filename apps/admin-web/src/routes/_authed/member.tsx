import { createFileRoute } from "@tanstack/react-router";
import { MemberPage } from "@/features/auth/pages/MemberPage";

export const Route = createFileRoute("/_authed/member")({ component: MemberPage });
