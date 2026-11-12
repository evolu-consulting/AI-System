// CR-130 · tab «Bảng tin» của đối tác SHT: nhóm hàng + khu vực (sửa), tài khoản đã mời (tên, trạng thái), «Mời vào Bảng tin» chọn từ
// tài khoản công ty chưa gắn (chưa có ⇒ hướng dẫn + link tạo ở Admin), «Gỡ khỏi Bảng tin» có xác nhận. Chỉ quản trị gói ghi; người khác xem.
import type { PartnerCommunity } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { ErrorLine, Loading } from "~/components/shared/states";
import { adminUrl } from "~/features/shell/lib/account-link";
import { useCandidates, useCommunity, useCommunityWrites } from "../hooks/use-partner-community";
import { errCodeOf } from "../hooks/use-partner-rep";
import {
  AREA_MAX,
  adminPartnersNext,
  catsText,
  communityErrorKey,
  parseCats,
} from "../lib/community-block";

const FIELD =
  "h-9 w-full rounded-lg border border-field bg-panel px-3 text-label disabled:opacity-60";
const BTN = "h-9 rounded-lg border border-field px-3 text-label hover:bg-sunk disabled:opacity-50";
const PRIMARY =
  "h-9 rounded-lg bg-act px-4 text-label font-semibold text-on-act disabled:opacity-50";

type Props = { party: string; data: PartnerCommunity; canEdit: boolean };

function ProfileForm({ party, data, canEdit }: Props) {
  const { t } = useTranslation();
  const { saveProfile } = useCommunityWrites(party);
  const [cats, setCats] = useState(catsText(data.cats));
  const [area, setArea] = useState(data.area);
  const save = () =>
    saveProfile.mutate(
      { cats: parseCats(cats), area: area.trim() },
      {
        onSuccess: () => toast(t("contracts.pcm.saved")),
        onError: (e) => toast(t(communityErrorKey(errCodeOf(e))), "late"),
      },
    );
  return (
    <section className="rounded-xl border border-rule bg-panel p-5">
      <h3 className="text-card-title font-semibold">{t("contracts.pcm.profileTitle")}</h3>
      <p className="mb-3 text-caption text-dim">{t("contracts.pcm.profileHint")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-label">
          <b>{t("contracts.pcm.cats")}</b>
          <input
            className={FIELD}
            value={cats}
            disabled={!canEdit}
            onChange={(e) => setCats(e.target.value)}
            placeholder={t("contracts.pcm.catsPh")}
          />
        </label>
        <label className="block text-label">
          <b>{t("contracts.pcm.area")}</b>
          <input
            className={FIELD}
            value={area}
            maxLength={AREA_MAX}
            disabled={!canEdit}
            onChange={(e) => setArea(e.target.value)}
          />
        </label>
      </div>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <button type="button" className={PRIMARY} disabled={saveProfile.isPending} onClick={save}>
            {t("contracts.pcm.save")}
          </button>
        </div>
      )}
    </section>
  );
}

function Invite({ party, name }: { party: string; name: string }) {
  const { t } = useTranslation();
  const cands = useCandidates(true);
  const { setAccount } = useCommunityWrites(party);
  const [pick, setPick] = useState("");
  const list = cands.data ?? [];
  const openAdmin = async () => {
    const url = await adminUrl(adminPartnersNext(name));
    if (url) window.open(url, "_blank", "noopener");
    else toast(t("contracts.pcm.adminFail"), "late");
  };
  const invite = () =>
    setAccount.mutate(pick, {
      onSuccess: () => toast(t("contracts.pcm.invited")),
      onError: (e) => toast(t(communityErrorKey(errCodeOf(e))), "late"),
    });
  return (
    <div className="space-y-3">
      <p className="text-label">{t("contracts.pcm.notInvited")}</p>
      {cands.isLoading && <Loading />}
      {list.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${FIELD} max-w-sm`}
            aria-label={t("contracts.pcm.pickAccount")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">{t("contracts.pcm.pickAccount")}</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={PRIMARY}
            disabled={!pick || setAccount.isPending}
            onClick={invite}
          >
            {t("contracts.pcm.invite")}
          </button>
        </div>
      ) : (
        !cands.isLoading && (
          <p className="text-caption text-dim">{t("contracts.pcm.noCandidates")}</p>
        )
      )}
      <button type="button" className={BTN} onClick={() => void openAdmin()}>
        {t("contracts.pcm.createAccount")}
      </button>
    </div>
  );
}

function Account({ party, data, canEdit }: Props) {
  const { t } = useTranslation();
  const { setAccount } = useCommunityWrites(party);
  const acc = data.account;
  const remove = async () => {
    const ok = await confirmDialog({
      title: t("contracts.pcm.removeTitle"),
      body: t("contracts.pcm.removeBody", { name: acc?.name ?? "" }),
      confirmLabel: t("contracts.pcm.remove"),
      danger: true,
    });
    if (!ok) return;
    setAccount.mutate(null, {
      onSuccess: () => toast(t("contracts.pcm.removed")),
      onError: (e) => toast(t(communityErrorKey(errCodeOf(e))), "late"),
    });
  };
  return (
    <section className="rounded-xl border border-rule bg-panel p-5" data-testid="pcm-account">
      <h3 className="text-card-title font-semibold">{t("contracts.pcm.accountTitle")}</h3>
      <p className="mb-3 text-caption text-dim">{t("contracts.pcm.accountHint")}</p>
      {acc ? (
        <div className="flex flex-wrap items-center gap-3">
          <b>{acc.name}</b>
          <span className={`text-caption ${acc.active ? "text-ok" : "text-late"}`}>
            {t(acc.active ? "contracts.pcm.active" : "contracts.pcm.inactive")}
          </span>
          {canEdit && (
            <button
              type="button"
              className={BTN}
              disabled={setAccount.isPending}
              onClick={() => void remove()}
            >
              {t("contracts.pcm.remove")}
            </button>
          )}
        </div>
      ) : canEdit ? (
        <Invite party={party} name={data.name ?? party} />
      ) : (
        <p className="text-label text-dim">{t("contracts.pcm.notInvitedView")}</p>
      )}
    </section>
  );
}

export function CommunityTab({ party, canEdit }: { party: string; canEdit: boolean }) {
  const q = useCommunity(party, true);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  return (
    <div className="space-y-4" data-testid="partner-community">
      <Account party={party} data={q.data} canEdit={canEdit} />
      <ProfileForm key={q.dataUpdatedAt} party={party} data={q.data} canEdit={canEdit} />
    </div>
  );
}
