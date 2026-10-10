// ADM-FR-65 · CR-056 · P-a FD2: bọc mọi trang `/processes*` — cờ off ⇒ `NotFoundState`; đang dò ⇒ `LoadingState`.
import type { ReactNode } from "react";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { useEngineRoute } from "../engine";

export function ProcessRouteGate({ children }: { children: ReactNode }) {
  const state = useEngineRoute();
  if (state === "off") return <NotFoundState backTo="/" />;
  if (state === "pending") return <LoadingState />;
  return <>{children}</>;
}
