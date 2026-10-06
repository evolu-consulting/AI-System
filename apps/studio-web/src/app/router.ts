// HUB-FR-72 · router file-based, basepath `/studio` (D2); cây route do @tanstack/router-plugin sinh vào routeTree.gen.ts.
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "#/routeTree.gen";

export const router = createRouter({ routeTree, basepath: "/studio", defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
