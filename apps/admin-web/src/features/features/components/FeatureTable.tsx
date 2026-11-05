// ADM-FR-30 · CR-111 · danh mục Feature nhóm theo app: mỗi nhóm một khung (tên dễ hiểu + mô tả, key mono mờ bên phải), badge "Mặc định" / "Tính năng thêm".
import type { FeatureListItem } from "@ai/contracts/features";
import { type ReactNode, useMemo } from "react";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import type { FeatureStatusFilter } from "../hooks/use-feature-queries";
import { groupByApp } from "../lib/feature-meta";
import { FeatureGroupSection } from "./FeatureGroupSection";

type Props = {
  features: FeatureListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onStatus: (f: FeatureListItem, status: FeatureStatusFilter) => void;
  onDelete: (f: FeatureListItem) => void;
  onOpen?: (f: FeatureListItem) => void;
  activeId?: string | null;
};

export function FeatureTable({
  features,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onStatus,
  onDelete,
  onOpen,
  activeId,
}: Props) {
  const groups = useMemo(() => groupByApp(features ?? []), [features]);
  if (error) return <ErrorState message={error.message} code={error.code} onRetry={onRetry} />;
  if (isLoading || !features) return <LoadingState onRetry={onRetry}>{null}</LoadingState>;
  if (features.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-4" aria-busy={isFetching || undefined}>
      {groups.map((g) => (
        <FeatureGroupSection
          key={g.app}
          group={g}
          isFetching={isFetching}
          onStatus={onStatus}
          onDelete={onDelete}
          onOpen={onOpen}
          activeId={activeId}
        />
      ))}
    </div>
  );
}
