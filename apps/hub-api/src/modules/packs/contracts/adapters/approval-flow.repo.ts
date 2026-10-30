// CR-105 L4 · cổng đọc cài đặt duyệt cho use case luồng (mẫu luồng theo tenant `contracts.approval_flows` không còn đọc/ghi; dữ liệu giữ để quay lui).
import type { Tx } from "@ai/db";
import { settingsRepo } from "./approval-settings.repo";

export function approvalFlowRepo(tx: Tx, tid: string) {
  return {
    settings: () => settingsRepo(tx, tid).settings(),
  };
}
