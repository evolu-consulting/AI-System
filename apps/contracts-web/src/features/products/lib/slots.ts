// V2-J1 · chỗ gắn tab của chi tiết sản phẩm: V2-J1 dựng "Lịch sử mua bán" + "Hợp đồng · n"; hai tab giữa do lát sau thêm vào mảng này
// (hiện chưa có dữ liệu nguồn): "Khách đang dùng" — V2-H (dịch vụ có hạn, `key: "users"`); "NCC & giá" — V2-J2 (không phải Giới thiệu,
// `key: "suppliers"`). Thứ tự trong mảng = thứ tự tab, nằm giữa "Lịch sử mua bán" và "Hợp đồng". Slot nhận id + nhóm của SP.
import type { ProductGroup } from "@ai/contracts";
import { createElement, type ReactNode } from "react";
import { SupplierPricesTab } from "~/features/product-suppliers/components/SupplierPricesTab";
import { ServiceCustomersPanel } from "../components/ServiceCustomersPanel";

export type DetailSlot = {
  /** Khoá trong URL `?ht=`. */
  key: string;
  /** Khoá i18n của nhãn tab. */
  labelKey: string;
  /** Nhóm SP có tab này. */
  groups: readonly ProductGroup[];
  render: (p: { productId: string; group: ProductGroup }) => ReactNode;
};

export const DETAIL_SLOTS: readonly DetailSlot[] = [
  // V2-H · SP-03: khách đang dùng của SP dịch vụ có hạn.
  {
    key: "users",
    labelKey: "contracts.svc.tabCustomers",
    groups: ["service"],
    render: ({ productId }) => createElement(ServiceCustomersPanel, { productId }),
  },
  // V2-J2 · SP-04/05/06: NCC & giá (không hiện cho Giới thiệu).
  {
    key: "suppliers",
    labelKey: "contracts.psup.title",
    groups: ["service", "goods"],
    render: ({ productId }) => createElement(SupplierPricesTab, { productId }),
  },
];

export const slotsFor = (
  g: ProductGroup,
  all: readonly DetailSlot[] = DETAIL_SLOTS,
): DetailSlot[] => all.filter((s) => s.groups.includes(g));
