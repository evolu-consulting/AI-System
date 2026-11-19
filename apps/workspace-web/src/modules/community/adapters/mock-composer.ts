// CR-191 · dữ liệu giả cho hộp soạn bài: công ty ĐÃ KẾT NỐI + người của họ («@»), «n/N», gợi ý hàng hoá.
import type {
  AudienceMode,
  ConnectedAudienceCompany,
  GoodsSuggestion,
} from "@ai/contracts/community";
import type { PeopleScope } from "../application/ports";

const MOCK_AUD_COMPANIES = [
  { tenantId: "t-xanh", name: "Công ty Cổ phần Xanh", sees: { all: true } },
  { tenantId: "t-nam", name: "Công ty TNHH Nam Việt", sees: { all: true } },
] as const;
const MOCK_CONN_PEOPLE = [
  {
    userId: "u-xanh",
    name: "Phạm Thu Hà",
    orgName: "Công ty Cổ phần Xanh",
    title: "Trưởng phòng mua hàng",
    tenantId: "t-xanh",
  },
  {
    userId: "u-nam",
    name: "Lê Văn Nam",
    orgName: "Công ty TNHH Nam Việt",
    title: "Giám đốc",
    tenantId: "t-nam",
  },
] as const;
const MOCK_GOODS = [
  { name: "Băng keo 5cm", unit: "cuộn", price: "12.000", source: "catalog" },
  { name: "Thùng phi 200L", unit: "thùng", price: "450.000", source: "catalog" },
  { name: "Chữ ký số DN – USB Token", unit: "bộ", source: "posted" },
] as const;

export const mockConnectedPeople = (scope?: PeopleScope) => {
  const sees = (t: string) =>
    scope?.mode === "internal"
      ? false
      : scope?.mode === "companies"
        ? (scope.tenants ?? []).includes(t)
        : true;
  return MOCK_CONN_PEOPLE.filter((x) => sees(x.tenantId) || scope?.outside).map((x) => ({
    ...x,
    connected: true,
    ...(sees(x.tenantId) ? {} : { outside: true }),
  }));
};

export const mockAudienceConnected = (
  mode: AudienceMode,
  tenants?: string[],
): ConnectedAudienceCompany[] =>
  MOCK_AUD_COMPANIES.map((c) => ({
    tenantId: c.tenantId,
    name: c.name,
    sees: mode === "all" || (mode === "companies" && (tenants ?? []).includes(c.tenantId)),
  }));

export const mockGoods = (q: string): GoodsSuggestion[] =>
  MOCK_GOODS.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase())).map((g) => ({
    ...g,
  }));
