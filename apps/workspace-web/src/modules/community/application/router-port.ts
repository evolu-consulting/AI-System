// CR-118 · COM-FR-31 · RouterPort dựng trên router mức thấp của host (TanStack): module đọc/ghi URL `/community/*` mà không biết router.
import { parsePath, type Route, routeToHref } from "../domain/route";
import type { RouterPort } from "./ports";

export type LowRouter = {
  location(): { pathname: string; search: string };
  navigate(url: string, opts: { replace: boolean }): void;
  subscribe(cb: () => void): () => void;
};

export function createRouterPort(low: LowRouter): RouterPort {
  return {
    read() {
      const l = low.location();
      return parsePath(l.pathname);
    },
    go: (r: Route) => low.navigate(routeToHref(r), { replace: false }),
    replace: (r: Route) => low.navigate(routeToHref(r), { replace: true }),
    href: (r: Route) => routeToHref(r),
    subscribe: (cb) => low.subscribe(cb),
  };
}
