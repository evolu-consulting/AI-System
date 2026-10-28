// com-c12a · dữ liệu thuần của seed cộng đồng đối tác (tenant demo). Không DB. Nguồn: prototype Cộng đồng (nhãn + nhóm hàng).
import type { PKey } from "./seed-demo-v2.specs";

export type CommunityLabel = "supplier" | "buyer";
export type PartnerSeed = {
  /** Tên công ty đối tác (admin.external_orgs.name). */
  name: string;
  username: string;
  displayName: string;
  /** Nhãn cộng đồng: `both` ⇒ cả hai. */
  labels: readonly CommunityLabel[];
  categories: readonly string[];
  /** Khoá đối tác trong Sổ Hợp Tác demo (seed-demo-v2.specs) khi đã có; null = chưa có trong SHT. */
  sht: PKey | null;
};

export const PARTNER_SEEDS: readonly PartnerSeed[] = [
  {
    name: "Cơ sở Tân Phát",
    username: "doitac-tanphat",
    displayName: "Tân Phát (đối tác)",
    labels: ["supplier"],
    categories: ["Thùng phi", "Thùng carton"],
    sht: "tanphat",
  },
  {
    name: "Hãng NCCA",
    username: "doitac-ncca",
    displayName: "Hãng NCCA (đối tác)",
    labels: ["supplier"],
    categories: ["Chữ ký số", "Hoá đơn điện tử"],
    sht: "ncca",
  },
  {
    name: "Bao bì Phương Nam",
    username: "doitac-phuongnam",
    displayName: "Bao bì Phương Nam (đối tác)",
    labels: ["supplier"],
    categories: ["Băng keo", "Thùng carton"],
    sht: null,
  },
  {
    name: "Công ty TNHH ABC",
    username: "doitac-abc",
    displayName: "ABC (đối tác)",
    labels: ["buyer"],
    categories: ["Băng keo", "Thùng phi", "Thùng carton"],
    sht: "abc",
  },
  {
    name: "Hưng Thịnh Logistics",
    username: "doitac-hungthinh",
    displayName: "Hưng Thịnh Logistics (đối tác)",
    labels: ["supplier", "buyer"],
    categories: ["Thùng carton", "Chữ ký số", "Hoá đơn điện tử"],
    sht: "hungthinh",
  },
];
