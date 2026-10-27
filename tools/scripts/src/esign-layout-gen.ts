// Sinh HTML trang ký + offset từ code hiện tại (F:\workspace\evolu-platform) để kiểm bố cục trên DocuSign.
import { writeFileSync } from "node:fs";
import {
  SIGN_TAB_OFFSET,
  signaturePageHtml,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/esign.rules";

const dir = process.argv[2] as string;
writeFileSync(
  `${dir}/sign.html`,
  signaturePageHtml({
    title: "HĐ mua chữ ký số NCCA · Lô Q3",
    number: "12/2026/HĐMB",
    signers: [
      { role: "company", name: "Nguyễn Văn Chủ", email: "owner@demo.vn" },
      { role: "partner", name: "Trần Thị Đối Tác", email: "partner@example.vn" },
    ],
  }),
);
writeFileSync(`${dir}/offset.json`, JSON.stringify(SIGN_TAB_OFFSET));
console.log("ok");
