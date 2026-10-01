import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/features/users/pages/UsersPage";

export const Route = createFileRoute("/_authed/users")({ component: UsersPage });
