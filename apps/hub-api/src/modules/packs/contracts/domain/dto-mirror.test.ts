// ADR-0023 · bản sao kiểu/hằng số ở domain (`*.types.ts`) phải khớp `@ai/contracts`: hằng số bằng nhau (chạy), kiểu gán được hai chiều
// (kiểm lúc typecheck — lệch là `tsc` đỏ ở file này).
import { describe, expect, it } from "bun:test";
import type * as C from "@ai/contracts";
import {
  MYWORK_AHEAD_DAYS as C_AHEAD,
  SOURCING_CANDIDATES_MAX as C_CANDS,
  MANUAL_EVENT_TYPES as C_MANUAL,
  MYWORK_MAX as C_MW_MAX,
  MYWORK_SOURCE_MAX as C_MW_SRC,
  NEW_PARTNER_LABEL as C_NEW_PARTNER,
  OVERVIEW_GROUPS as C_OV_GROUPS,
  OVERVIEW_PERIODS as C_OV_PERIODS,
  SOURCING_PAGE_SIZE as C_PAGE,
  TODO_ACTIONS as C_TODO_ACTIONS,
  TODO_KINDS as C_TODO_KINDS,
  TODO_MAX as C_TODO_MAX,
  TODO_SOURCE_MAX as C_TODO_SRC,
} from "@ai/contracts";
import type * as BZ from "./business.types";
import type * as CO from "./companies.types";
import type * as DL from "./delivery.types";
import type * as EX from "./extraction.types";
import type * as F from "./followups.types";
import type * as L from "./ledger.types";
import { MANUAL_EVENT_TYPES } from "./ledger.types";
import type * as M from "./mywork.types";
import { MYWORK_AHEAD_DAYS, MYWORK_MAX, MYWORK_SOURCE_MAX } from "./mywork.types";
import type * as O from "./overview.rules";
import { OVERVIEW_GROUPS, OVERVIEW_PERIODS } from "./overview.rules";
import type * as PR from "./partner-roles.types";
import { NEW_PARTNER_LABEL } from "./partner-roles.types";
import type * as PD from "./products.types";
import type * as RP from "./reputation.types";
import type * as S from "./sourcing.types";
import { SOURCING_CANDIDATES_MAX, SOURCING_PAGE_SIZE } from "./sourcing.types";
import type * as SP from "./supplier-prices.types";
import type * as TD from "./todo.rules";
import { TODO_ACTIONS, TODO_KINDS, TODO_MAX, TODO_SOURCE_MAX } from "./todo.rules";

/** `true` khi A và B gán được cho nhau. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <A, B>(ok: Same<A, B>): Same<A, B> => ok;

describe("ADR-0023 · bản sao DTO ở domain khớp @ai/contracts", () => {
  it("hằng số", () => {
    expect([SOURCING_CANDIDATES_MAX, SOURCING_PAGE_SIZE]).toEqual([C_CANDS, C_PAGE]);
    expect([MYWORK_AHEAD_DAYS, MYWORK_SOURCE_MAX, MYWORK_MAX]).toEqual([
      C_AHEAD,
      C_MW_SRC,
      C_MW_MAX,
    ]);
    expect([...MANUAL_EVENT_TYPES]).toEqual([...C_MANUAL]);
    expect([OVERVIEW_PERIODS, OVERVIEW_GROUPS, TODO_KINDS, TODO_ACTIONS]).toEqual([
      C_OV_PERIODS,
      C_OV_GROUPS,
      C_TODO_KINDS,
      C_TODO_ACTIONS,
    ]);
    expect([TODO_SOURCE_MAX, TODO_MAX]).toEqual([C_TODO_SRC, C_TODO_MAX]);
  });
  it("kiểu (typecheck)", () => {
    const checks = [
      same<S.SourcingOut, C.SourcingOut>(true),
      same<S.SaleLine, C.SaleLine>(true),
      same<S.SourceRef, C.SourceRef>(true),
      same<S.SupplierExposure, C.SupplierExposure>(true),
      same<S.SourcingQuery, C.SourcingQuery>(true),
      same<S.SourceChoice, C.SourceChoice>(true),
      same<M.MyWorkOut, C.MyWorkOut>(true),
      same<M.MyWorkItem, C.MyWorkItem>(true),
      same<F.Followup, C.Followup>(true),
      same<F.FollowupCreate, C.FollowupCreate>(true),
      same<L.Obligation, C.Obligation>(true),
      same<L.PaymentsOut, C.PaymentsOut>(true),
      same<L.PartnerEvent, C.PartnerEvent>(true),
      same<L.PartnerEventCreate, C.PartnerEventCreate>(true),
      same<L.ScheduleRequest, C.ScheduleRequest>(true),
      same<L.ContractPartner, C.ContractPartner>(true),
      same<O.OverviewOut, C.OverviewOut>(true),
      same<TD.TodoOut, C.TodoOut>(true),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});

describe("ADR-0023 · bản sao DTO cho lớp 1–2 (sản phẩm, KD, đối tác, uy tín, NCC, giao hàng, trích)", () => {
  it("hằng số", () => {
    expect(NEW_PARTNER_LABEL).toBe(C_NEW_PARTNER);
  });
  it("kiểu (typecheck)", () => {
    const checks = [
      same<PD.ProductCreate, C.ProductCreate>(true),
      same<PD.ProductDetailOut, C.ProductDetailOut>(true),
      same<PD.ProductMatchOut, C.ProductMatchOut>(true),
      same<PD.ProductMatch, C.ProductMatch>(true),
      same<PD.ProductRuleCreate, C.ProductRuleCreate>(true),
      same<PD.ProductsQuery, C.ProductsQuery>(true),
      same<BZ.BizDetailOut, C.BizDetailOut>(true),
      same<BZ.BizListOut, C.BizListOut>(true),
      same<BZ.BizListQuery, C.BizListQuery>(true),
      same<BZ.BizConfigOut, C.BizConfigOut>(true),
      same<BZ.BizContractOut, C.BizContractOut>(true),
      same<BZ.BizPreviewIn, C.BizPreviewIn>(true),
      same<CO.CompanyRow, C.CompanyRow>(true),
      same<CO.CompanyOut, C.CompanyOut>(true),
      same<EX.AiRead, C.AiRead>(true),
      same<PR.PartnerLookup, C.PartnerLookup>(true),
      same<PR.PartnerContractRow, C.PartnerContractRow>(true),
      same<PR.PartnerContractCount, C.PartnerContractCount>(true),
      same<PR.PartnerNote, C.PartnerNote>(true),
      same<PR.PartnerProfile, C.PartnerProfile>(true),
      same<PR.PartnerRoleRow, C.PartnerRoleRow>(true),
      same<PR.PartnerWebLine, C.PartnerWebLine>(true),
      same<SP.SupplierOverviewOut, C.SupplierOverviewOut>(true),
      same<SP.SupplierPriceInput, C.SupplierPriceInput>(true),
      same<SP.SupplierSearchOut, C.SupplierSearchOut>(true),
      same<DL.DeliveryOutcome, C.DeliveryOutcome>(true),
      same<DL.DeliveryView, C.DeliveryView>(true),
      same<DL.StockCheckOut, C.StockCheckOut>(true),
      same<DL.StockCheckRequest, C.StockCheckRequest>(true),
      same<DL.DeleteImpact, C.DeleteImpact>(true),
      same<DL.DeleteResult, C.DeleteResult>(true),
      same<RP.QuoteCreate, C.QuoteCreate>(true),
      same<RP.RatingRequest, C.RatingRequest>(true),
      same<RP.ScoringDraft, C.ScoringDraft>(true),
      same<RP.RepJobIn, C.RepJobIn>(true),
      same<RP.RepRatingIn, C.RepRatingIn>(true),
      same<RP.RepPreviewIn, C.RepPreviewIn>(true),
      same<RP.RepJobTypesIn, C.RepJobTypesIn>(true),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});
