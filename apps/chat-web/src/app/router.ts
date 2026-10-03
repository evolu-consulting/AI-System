// C1 FE · router file-based; cây route do @tanstack/router-plugin sinh vào routeTree.gen.ts.
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "~/routeTree.gen";

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
