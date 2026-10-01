import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/features/shell/pages/HomePage";

export const Route = createFileRoute("/_authed/")({ component: HomePage });
