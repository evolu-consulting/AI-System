// C1 FE · route `/` rỗng; F3/F5 chuyển hướng sang `/c/new`.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <img src="/brand/evoluconsulting-icon.svg" alt="" className="size-12" />
    </main>
  ),
});
