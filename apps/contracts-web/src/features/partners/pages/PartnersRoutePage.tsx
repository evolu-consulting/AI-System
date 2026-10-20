// V2-I · `/partners`: không có `?party=` ⇒ danh sách, có ⇒ trang chi tiết đối tác.
import { useSearch } from "@tanstack/react-router";
import { parsePartnersSearch } from "../lib/partner-v2";
import { PartnerDetailPage } from "./PartnerDetailPage";
import { PartnersPage } from "./PartnersPage";

export function PartnersRoutePage() {
  const s = parsePartnersSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return s.party ? (
    <PartnerDetailPage key={s.party} search={{ ...s, party: s.party }} />
  ) : (
    <PartnersPage />
  );
}
