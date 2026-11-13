// CR-130 · duyệt yêu cầu tham gia: «Tạo đối tác mới» (mặc định) hoặc «Gắn với đối tác có sẵn» (tìm trong đối tác SHT); câu tóm tắt nói rõ
// sẽ gắn vào đối tác nào trước khi bấm Duyệt. Danh sách đối tác nạp khi mở ô chọn (lỗi/gói tắt ⇒ chỉ còn tạo mới).
import type { JoinRequest } from "@ai/contracts/community";
import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { useApp } from "../../application/ctx";
import { filterParties, PARTY_LIMIT, type Party } from "../../domain/join-approve";
import { t } from "../../i18n";

export function JoinApprove({
  j,
  onApprove,
  onReject,
}: {
  j: JoinRequest;
  onApprove: (partyKey: string | undefined) => void;
  onReject: () => void;
}) {
  const { api } = useApp();
  const [link, setLink] = useState(false);
  const [parties, setParties] = useState<Party[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Party | null>(null);
  const toggle = (on: boolean) => {
    setLink(on);
    setPicked(null);
    if (on && !parties) api.flows.listParties().then(setParties, () => setParties([]));
  };
  // Danh sách đầy (= trần máy chủ) ⇒ gõ từ khoá thì hỏi máy chủ; chưa đầy ⇒ lọc tại máy.
  const truncated = (parties?.length ?? 0) >= PARTY_LIMIT;
  const onSearch = (v: string) => {
    setQ(v);
    if (truncated) api.flows.listParties(v).then(setParties, () => undefined);
  };
  const shown = filterParties(parties ?? [], truncated ? "" : q);
  return (
    <div
      data-testid="join-approve-panel"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 16px 16px" }}
    >
      <fieldset className="chips">
        <button
          type="button"
          className={link ? "chip" : "chip on"}
          aria-pressed={!link}
          data-testid="join-mode-new"
          onClick={() => toggle(false)}
        >
          {t("community.flows.join.modeNew")}
        </button>
        <button
          type="button"
          className={link ? "chip on" : "chip"}
          aria-pressed={link}
          data-testid="join-mode-link"
          onClick={() => toggle(true)}
        >
          {t("community.flows.join.modeLink")}
        </button>
      </fieldset>
      {link && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="field"
            aria-label={t("community.flows.join.searchParty")}
            placeholder={t("community.flows.join.searchParty")}
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
          <select
            className="field"
            aria-label={t("community.flows.join.pickParty")}
            value={picked?.party ?? ""}
            onChange={(e) => setPicked(shown.find((p) => p.party === e.target.value) ?? null)}
          >
            <option value="">{t("community.flows.join.pickParty")}</option>
            {shown.map((p) => (
              <option key={p.party} value={p.party}>
                {p.name}
              </option>
            ))}
          </select>
          {parties?.length === 0 && (
            <span className="muted">{t("community.flows.join.noParties")}</span>
          )}
        </div>
      )}
      <span className="muted" data-testid="join-approve-summary">
        {link && !picked
          ? t("community.flows.join.summaryPick")
          : picked
            ? t("community.flows.join.summaryLink", { company: j.company, party: picked.name })
            : t("community.flows.join.summaryNew", { company: j.company })}
      </span>
      <div className="cbar" style={{ padding: 0 }}>
        <div className="sp" />
        <Btn variant="outline" size="sm" data-testid="join-reject" onClick={onReject}>
          {t("community.flows.join.reject")}
        </Btn>
        <Btn
          variant="primary"
          size="sm"
          data-testid="join-approve"
          disabled={link && !picked}
          onClick={() => onApprove(picked?.party)}
        >
          {t("community.flows.join.approve")}
        </Btn>
      </div>
    </div>
  );
}
