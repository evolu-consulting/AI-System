// CR-122 · P7 → CR-125 · c2: khối "quy trình mới" của công ty. KHÔNG còn công tắc BẬT bắt buộc: "Lưu và áp dụng" / gán quy trình là đủ (Hub tự
// đặt cờ cùng giao dịch). Chỉ còn nút cứu hộ "Tạm dừng quy trình mới" khi đang dùng; chưa dùng ⇒ lời chỉ dẫn nói bước kế (Luật gốc 3).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { RecordWords } from "@/features/processes/lib/record-words";
import { useFlowSettings, useSetFlowTriggers } from "../flow-settings-api";
import { switchStateOf } from "../lib/flow-switch-access";

/** `words` = tên bản ghi của các flow công ty đang có (hợp đồng / bài đăng…), đọc từ `record.label` của sự kiện (CR-125 · c6 · B4). */
export function FlowSwitch({ tenantId, words }: { tenantId: string; words: RecordWords }) {
  const { t } = useTranslation();
  const q = useFlowSettings(tenantId);
  const set = useSetFlowTriggers(tenantId);
  const [ask, setAsk] = useState(false);
  if (!q.data) return null;
  const state = switchStateOf(q.data);
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      data-testid="flow-switch"
    >
      <p className="m-0 min-w-0 text-label" data-testid="flow-switch-status">
        {t(`tenants.companyFlows.newFlow.${state}`, words)}
      </p>
      {state === "on" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={set.isPending}
          data-testid="flow-pause"
          onClick={() => setAsk(true)}
        >
          {t("tenants.companyFlows.newFlow.pause")}
        </Button>
      ) : null}
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent data-testid="flow-pause-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tenants.companyFlows.newFlow.pause")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tenants.companyFlows.newFlow.confirm", words)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tenants.companyFlows.newFlow.cancel")}</AlertDialogCancel>
            <Button
              data-testid="flow-pause-confirm-ok"
              onClick={() => {
                set.mutate(false);
                setAsk(false);
              }}
            >
              {t("tenants.companyFlows.newFlow.ok")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
