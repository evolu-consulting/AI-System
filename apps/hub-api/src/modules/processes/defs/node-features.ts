// CR-122 · N1 · FLOW2-FR-25 · node của module tính năng: bảng node của công ty (lõi + node app có tính năng đang bật) và kiểm khi
// lưu/chạy — stage mang `node` mà tính năng của node đã tắt cho công ty ⇒ lỗi `FLOW_NODE_FEATURE_OFF` nói rõ tính năng nào.
// Đọc tính năng từ cache cấu hình (`tenantFeatureOn`, 0 SQL khi nóng).
import { APP_MANIFESTS, type AppNodeDecl, nodeByKey, nodesFor } from "@ai/contracts/app-manifest";
import { AppError } from "../../../lib/errors";
import { type PackAccessView, tenantFeatureOn } from "../../packs/kit/public";

const MANIFESTS = Object.values(APP_MANIFESTS);

export type NodeFeatureMiss = { node: string; label: string; feature: string };

/** Node có dùng được ở công ty không (node lõi / không khoá ⇒ luôn được). */
async function usable(view: PackAccessView, n: AppNodeDecl, tenantId: string): Promise<boolean> {
  return n.feature === undefined || tenantFeatureOn(view, n.feature, tenantId);
}

/** Bảng node: lõi + node của `app` (vắng = mọi app). `tenantId` null (platform sửa Thư viện) ⇒ mọi node. */
export async function paletteOf(
  view: PackAccessView,
  tenantId: string | null,
  app?: string,
): Promise<AppNodeDecl[]> {
  const all = nodesFor(MANIFESTS, app);
  if (tenantId === null) return [...all];
  const ok = await Promise.all(all.map((n) => usable(view, n, tenantId)));
  return all.filter((_, i) => ok[i]);
}

/** Node đầu tiên (theo thứ tự stage) mà tính năng đã tắt cho công ty; null ⇒ mọi node dùng được. Khoá node lạ ⇒ bỏ qua. */
export async function nodeFeatureMiss(
  view: PackAccessView,
  tenantId: string,
  nodeKeys: readonly (string | undefined)[],
): Promise<NodeFeatureMiss | null> {
  for (const key of new Set(nodeKeys.filter((k): k is string => !!k))) {
    const n = nodeByKey(MANIFESTS, key);
    if (n?.feature && !(await usable(view, n, tenantId)))
      return { node: n.key, label: n.label.vi, feature: n.feature };
  }
  return null;
}

export const nodeFeatureError = (m: NodeFeatureMiss): AppError =>
  new AppError(
    "FLOW_NODE_FEATURE_OFF",
    422,
    `Tính năng "${m.feature}" của bước "${m.label}" đã tắt cho công ty. Bật lại tính năng hoặc bỏ bước này khỏi quy trình.`,
    m,
  );
