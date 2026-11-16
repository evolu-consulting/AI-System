// V2-I · DT-01 · DT-07 · đầu trang chi tiết đối tác (mockup NITI): tên, vai, MST · điện thoại · liên hệ, điểm từng vai và nút
// "Tìm trên internet" (chỉ chạy khi bấm; kết quả hiện ngay dưới đầu trang, mỗi dòng lưu được vào ghi chú).

import type { PartnerProfile, RepRole } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { MetaList } from "@ai/web-kit/ui/kit/meta-list";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loading } from "~/components/shared/states";
import { searchErrorKey, useContacts, useInternetSearch } from "../hooks/use-partner-rep";
import { flagsOf, type ScoreRow } from "../lib/partner-score";
import { ContactEditor } from "./ContactEditor";
import { InternetResult } from "./InternetSearch";
import { RedFlagTag } from "./RedFlagTag";
import { ScorePill } from "./RepBadge";

const DASH = "—";

export function PartnerHeader({
  party,
  name,
  roles,
  rows,
  profile,
  write,
}: {
  party: string;
  name: string;
  roles: readonly RepRole[];
  rows: readonly ScoreRow[];
  profile: PartnerProfile | undefined;
  write: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const search = useInternetSearch(party);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const contacts = useContacts(party);
  return (
    <>
      <nav aria-label={t("contracts.common.breadcrumb")} className="mb-1 text-label text-dim">
        <Link to="/contracts/partners" className="tap-target font-medium text-act hover:underline">
          ← {L("title")}
        </Link>
      </nav>
      <PageHeader
        className="mb-3"
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {roles.map((r) => {
              const x = rows.find((y) => y.role === r);
              return (
                <ScorePill
                  key={r}
                  row={
                    x ?? { score: null, band: null, provisional: false, provisional_score: null }
                  }
                  role={r}
                />
              );
            })}
            <RedFlagTag flags={flagsOf(rows)} />
          </span>
        }
        primary={
          write && (
            <Button
              variant="primary"
              disabled={search.isPending}
              onClick={() => {
                setShow(true);
                search.mutate();
              }}
            >
              {search.isPending ? L("web.searching") : L("web.button")}
            </Button>
          )
        }
      />
      <MetaList
        className="mb-4"
        items={[
          { label: L("mst"), value: profile?.tax_id },
          { label: L("phoneLabel"), value: profile?.phone },
          { label: L("contactLabel"), value: profile?.contact },
        ]}
      />
      {editing && contacts.data && (
        <ContactEditor party={party} contacts={contacts.data} onClose={() => setEditing(false)} />
      )}
      {!editing && write && contacts.data && (
        <Button
          variant="quiet"
          size="sm"
          className="mb-2"
          data-testid="act-editContact"
          onClick={() => setEditing(true)}
        >
          {t("contracts.vgaps.contact.edit")}
        </Button>
      )}
      {!editing && !!contacts.data?.length && (
        <ul
          aria-label={t("contracts.vgaps.contact.title")}
          className="mb-4 flex flex-wrap gap-2 text-[13px]"
        >
          {contacts.data.map((c) => (
            <li key={c.id} className="rounded-lg border border-rule bg-panel px-3 py-2">
              <b className="font-semibold">{c.name}</b>
              {c.role && <span className="text-dim"> · {c.role}</span>}
              <span className="block text-dim">
                {[c.phone, c.email].filter(Boolean).join(" · ") || DASH}
              </span>
              {c.our_owner && (
                <span className="block text-dim">
                  {t("contracts.vgaps.contact.ownerIs", { name: c.our_owner })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {show && (
        <div className="mb-4">
          {search.isPending && <Loading />}
          {search.isError && (
            <p role="alert" className="text-[13px] text-late">
              {L(`web.error.${searchErrorKey(search.error)}`)}
            </p>
          )}
          {search.data && (
            <InternetResult
              party={party}
              lines={search.data.lines}
              write={write}
              onClose={() => setShow(false)}
            />
          )}
        </div>
      )}
    </>
  );
}
