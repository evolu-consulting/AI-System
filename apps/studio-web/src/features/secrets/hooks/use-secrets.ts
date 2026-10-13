// HUB-FR-68 · danh sách secret theo `kind` (cursor); gộp các trang đã tải.
import type { HubSecretKind } from "@ai/contracts/hub-admin";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { secretsQuery } from "../api";

export function useSecrets(kind: HubSecretKind) {
  const q = useInfiniteQuery(secretsQuery(kind));
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { ...q, items };
}
