// CR-121 C-3b · Tổng quan platform_admin dạng bento: 1 ô lớn (lượt chạy 24 giờ) + 5 ô số liệu + "Cần xử lý ngay" + "Sức khoẻ hệ thống" lấp kín lưới 12 cột
// (xl) / 6 cột (md) / 1 cột (nhỏ). Một truy vấn `GET /ops/overview`; mỗi ô tự có trạng thái đang tải / lỗi (lý do + Thử lại).
import { useTranslation } from "react-i18next";
import { hubConfigured } from "@/lib/hub";
import { loadError } from "@/lib/load-error";
import { useOpsOverview } from "../../api";
import { AttentionTile, HealthTile } from "./AttentionHealthTiles";
import type { TileError } from "./BentoTile";
import { KpiTiles, RunsTile } from "./KpiTiles";

export function useOpsTiles() {
  const { t } = useTranslation();
  const q = useOpsOverview(true);
  let error: TileError | null = null;
  if (!hubConfigured()) {
    error = { message: t("overview.ops.hubNotConfigured"), code: "HUB_NOT_CONFIGURED" };
  } else if (q.isError) {
    error = {
      ...(loadError(q.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
      onRetry: () => void q.refetch(),
    };
  }
  return { q, error, loading: q.isPending && !error };
}

export function OpsBento() {
  const { q, error, loading } = useOpsTiles();
  const d = q.data;
  const c = { loading, error };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12">
      <RunsTile {...c} k={d?.kpi.runs} hourly={d?.hourly} />
      <KpiTiles {...c} k={d?.kpi} />
      <AttentionTile {...c} a={d?.attention} />
      <HealthTile {...c} h={d?.health} />
    </div>
  );
}
