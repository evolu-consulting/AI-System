// Sinh tài liệu + offset từ code hiện tại (F:\workspace\evolu-platform) để kiểm bố cục trên DocuSign (deploy/prod-sohoptac2/esign-layout).
//   bun tools/scripts/src/esign-layout-gen.ts <ra>          trang ký cuối (sign.html = signaturePageHtml, anchor ẩn \sN\ \dN\)
//   bun tools/scripts/src/esign-layout-gen.ts <ra> text     esign-anchor: HĐ mẫu (HTML làm document 1 — repo không có thư viện tạo PDF)
//                                                           có khối "ĐẠI DIỆN BÊN A / ĐẠI DIỆN BÊN B"; anchors = pickAnchors trên chữ của mẫu.
import { writeFileSync } from "node:fs";
import {
  DEFAULT_ANCHORS,
  pickAnchors,
  TEXT_TAB_OFFSET,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/esign.anchor";
import {
  SIGN_TAB_OFFSET,
  signaturePageHtml,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/esign.rules";

const dir = process.argv[2] as string;
const mode = process.argv[3] === "text" ? "text" : "page";

const CLAUSES = [
  "Điều 1. Hàng hoá: chữ ký số NCCA, số lượng 20 bộ, đơn giá theo phụ lục.",
  "Điều 2. Giao hàng trong 10 ngày kể từ ngày ký; địa điểm tại trụ sở Bên A.",
  "Điều 3. Thanh toán chuyển khoản 100% trong 15 ngày sau khi nghiệm thu.",
  "Điều 4. Hai bên cam kết thực hiện đúng các điều khoản đã thoả thuận.",
];

/** HĐ mẫu: đầu (Bên A/Bên B), điều khoản, khối chữ ký 2 cột như HĐ Việt Nam thường gặp. Trả HTML + chữ thuần (cho luật chọn). */
export function sampleContract(): { html: string; text: string } {
  const head = "HỢP ĐỒNG MUA BÁN Số 12/2026/HĐMB";
  const parties = ["Bên A (Bên mua): Công ty TNHH Demo", "Bên B (Bên bán): Công ty CP Đối Tác"];
  const block = [
    ["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"],
    ["(Ký, ghi rõ họ tên, đóng dấu)", "(Ký, ghi rõ họ tên, đóng dấu)"],
    ["Nguyễn Văn Chủ", "Trần Thị Đối Tác"],
  ];
  const text = [head, ...parties, ...CLAUSES, ...block.map((r) => r.join("    "))].join("\n");
  const cell = (s: string, i: number) =>
    `<td style="width:50%;text-align:center;vertical-align:top;${i === 1 ? "height:120px;vertical-align:bottom;" : ""}">${s}</td>`;
  const rows = [block[0], block[1], ["", ""], block[2]]
    .map((r, i) => `<tr>${(r as string[]).map((s) => cell(s, i === 2 ? 1 : 0)).join("")}</tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12pt;margin:40px}h1{font-size:16pt;text-align:center}table{width:100%;border-collapse:collapse;margin-top:32px}td{padding:4px}</style></head><body><h1>${head}</h1>${parties.map((p) => `<p>${p}</p>`).join("")}${CLAUSES.map((c) => `<p>${c}</p>`).join("")}<table>${rows}</table></body></html>`;
  return { html, text };
}

if (import.meta.main) {
  if (mode === "text") {
    const s = sampleContract();
    const pick = pickAnchors({
      text: s.text,
      side: "buyer",
      roles: ["company", "partner"],
      lists: DEFAULT_ANCHORS,
    });
    if (pick.mode !== "text") throw new Error(`mẫu không chọn được anchor: ${pick.reason}`);
    writeFileSync(`${dir}/sign.html`, s.html);
    writeFileSync(
      `${dir}/offset.json`,
      JSON.stringify({ mode: "text", ...TEXT_TAB_OFFSET, anchors: pick.anchors }),
    );
  } else {
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
    writeFileSync(`${dir}/offset.json`, JSON.stringify({ mode: "page", ...SIGN_TAB_OFFSET }));
  }
  console.log(`ok ${mode}`);
}
