// CR-187 BR-187-5 · CR-191: Sổ Hợp Tác › Đối tác: công tắc «Cho công ty khác tìm thấy công ty mình». Người quản trị Sổ Hợp Tác (Toàn quyền)
// của chính công ty đổi được; vai khác thấy công tắc khoá + lý do. Đi qua `/pack/contracts/connect/listing` (máy chủ kiểm quyền + điều kiện
// tên pháp lý + MST); API admin cũ chỉ còn cho trang quản trị nền tảng.
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { connectKeys, fetchListing, saveListing } from "../api.connect";
import { discoverableView } from "../lib/discoverable";

export function DiscoverableCard() {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gape.discover.${k}`);
  const { owner } = useMe();
  const qc = useQueryClient();
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
  // Phản hồi sai dạng (máy chủ giả/lỗi) ⇒ không vẽ thẻ với giá trị rỗng.
  if (!q.data || typeof q.data.listed !== "boolean") return null;
  const v = discoverableView(q.data, owner);
  return (
    <section
      data-testid="discoverable-card"
      className="mb-4 flex shrink-0 items-start justify-between gap-4 rounded-lg border border-rule-soft bg-card px-5 py-4"
    >
      <div className="grid gap-1">
        <label htmlFor="discoverable-switch" className="font-semibold text-ink">
          {L("title")}
        </label>
        <p data-testid="discoverable-why" className="text-[13px] text-dim">
          {v.locked
            ? t("contracts.connect.hub.lockedWhy")
            : v.needProfile
              ? L("needProfile")
              : L("why")}
        </p>
      </div>
      <Switch
        id="discoverable-switch"
        data-testid="discoverable-switch"
        checked={v.checked}
        disabled={!v.enabled || set.isPending}
        onCheckedChange={(x) => set.mutate(x)}
      />
    </section>
  );
}
