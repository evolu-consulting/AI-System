// CR-123 · u13 · engine ELK tải LƯỜI chỉ trong trình soạn flow: `elkjs/lib/elk-api` (nhỏ) + worker riêng (`elk-worker.min.js`, ~1,5 MB) do host phát NGUYÊN VĂN
// như tệp tĩnh `ELK_WORKER_URL` (apps/admin-web/rsbuild.config.ts `output.copy`) — không đóng gói vào chunk nào ⇒ trang khác không tải thêm byte;
// tính toán nằm ngoài luồng giao diện. Một engine dùng chung cả phiên.
import type { ElkEngine } from "./elk";

export const ELK_WORKER_URL = "/static/elk/elk-worker.min.js";

let shared: Promise<ElkEngine> | null = null;

export function elkEngine(): Promise<ElkEngine> {
  shared ??= import("elkjs/lib/elk-api").then(
    ({ default: ELK }) =>
      new ELK({ workerFactory: () => new Worker(ELK_WORKER_URL) }) as unknown as ElkEngine,
  );
  return shared;
}
