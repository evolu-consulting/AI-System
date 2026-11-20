// PK-FR-10 · TF1 · router file-based; cây route do @tanstack/router-plugin sinh vào routeTree.gen.ts.

import { routerScrollOptions } from "@ai/web-kit/scroll-policy";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "~/routeTree.gen";

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  ...routerScrollOptions(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
