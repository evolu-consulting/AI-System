// CHAT-AC-01, CHAT-AC-18 · `/c/new`: trang chào + composer (F7).
import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "~/features/thread/pages/WelcomePage";

export const Route = createFileRoute("/_authed/c/new")({ component: WelcomePage });
