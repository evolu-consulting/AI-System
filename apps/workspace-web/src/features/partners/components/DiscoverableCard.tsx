// CR-187 BR-187-5 · CR-191 · CR-193 BR-193-10: Sổ Hợp Tác › Đối tác: MỘT thẻ một dòng — công tắc «Cho công ty khác tìm thấy công ty mình» +
// nút «Đang kết nối N công ty» mở/đóng danh sách đã kết nối (và cài đặt «Ai được tìm và mời») ngay trong thẻ.
// Người quản trị Sổ Hợp Tác (Toàn quyền) đổi được công tắc; vai khác thấy công tắc khoá + lý do. Đi qua `/pack/contracts/connect/listing`.
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { connectKeys, fetchListing, saveListing } from "../api.connect";
import { useLinks } from "../hooks/use-connect";
import { discoverableView } from "../lib/discoverable";
import { ConnectedPanel } from "./ConnectedPanel";
import { InviteSetting } from "./InviteSetting";

export function DiscoverableCard() {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gape.discover.${k}`);
  const { owner } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const links = useLinks("connected");
  const items = links.data?.items ?? [];
  const q = useQuery({
    queryKey: connectKeys.listing,
    queryFn: ({ signal }) => fetchListing(signal),
    retry: false,
  });
  const set = useMutation({
    mutationFn: saveListing,
    onSuccess: (res) => {
      qc.setQueryData(connectKeys.listing, res);
      notifySuccess(L("saved"));
    },
    onError: () => notifyError(L("fail")),
  });
  // Phản hồi sai dạng (máy chủ giả/lỗi) ⇒ không vẽ công tắc với giá trị rỗng; phần «Đang kết nối» vẫn có.
  const v = q.data && typeof q.data.listed === "boolean" ? discoverableView(q.data, owner) : null;
  return (
    <section
      data-testid="discoverable-card"
      className="mb-4 shrink-0 rounded-lg border border-rule-soft bg-card px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {v && (
          <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
            <Switch
              id="discoverable-switch"
              data-testid="discoverable-switch"
              checked={v.checked}
              disabled={!v.enabled || set.isPending}
              onCheckedChange={(x) => set.mutate(x)}
            />
            <div className="grid min-w-0 gap-0.5">
              <label htmlFor="discoverable-switch" className="font-semibold text-ink">
                {L("title")}
              </label>
              <p data-testid="discoverable-why" className="text-xs text-dim">
                {v.locked
                  ? t("contracts.connect.hub.lockedWhy")
                  : v.needProfile
                    ? L("needProfile")
                    : L("why")}
              </p>
            </div>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls="connected-area"
          data-testid="connected-toggle"
          onClick={() => setOpen((x) => !x)}
        >
          <ICONS.partner className="size-4" aria-hidden="true" />
          {t("contracts.connect.hub.connectedBtn", { n: items.length })}
        </Button>
      </div>
      <div id="connected-area">
        {links.error && (
          <p role="alert" className="mt-2 text-xs text-late" hidden={!open}>
            {t("contracts.connect.err.failed")}
          </p>
        )}
        <ConnectedPanel items={items} open={open} />
        <div hidden={!open}>
          <InviteSetting locked={!owner} />
        </div>
      </div>
    </section>
  );
}
