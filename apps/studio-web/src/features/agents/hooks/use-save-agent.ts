// HUB-FR-60 · H4a-R09 · lưu agent: POST (tạo) / PUT (sửa); sau lưu invalidate danh sách + `me` (badge hub config vN) + toast.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { meQuery } from "#/features/shell/api";
import { AGENTS_KEY, createAgent, updateAgent } from "../api";

export type SaveVars = { id?: string; payload: Record<string, unknown> };

export function useSaveAgent() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (v: SaveVars) => (v.id ? updateAgent(v.id, v.payload) : createAgent(v.payload)),
    onSuccess: (res, v) => {
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
      void qc.invalidateQueries({ queryKey: meQuery.queryKey });
      toast.success(t("editor.toast.saved", { n: res.hub_config_version }));
      if (!v.id) toast(t("editor.toast.notGranted"));
    },
  });
}
