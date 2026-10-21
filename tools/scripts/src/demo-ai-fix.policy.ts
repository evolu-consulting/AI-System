// Demo · ai-tiers-rag: tài liệu nội bộ GIẢ cho RAG trong chat (tenant demo) — hạn mức duyệt theo giá trị hợp đồng (khớp tài liệu
// quy trình cũ: 50 triệu / 500 triệu), điều khoản thanh toán chuẩn, chính sách đối tác "Bao bì Minh Phát". Thuần dữ liệu.
import { createHash } from "node:crypto";

export const POLICY_TITLE =
  "Quy chế tài chính – hợp đồng nội bộ QC-TC-01 (Công ty Demo, dữ liệu giả)";
export const POLICY_CHUNKS: readonly { heading: string; body: string }[] = [
  {
    heading: "Điều 1. Hạn mức duyệt hợp đồng theo giá trị",
    body: "Hợp đồng có giá trị dưới 50 triệu đồng do Trưởng phòng Kinh doanh duyệt. Từ 50 triệu đến 500 triệu đồng cần thêm Kế toán trưởng duyệt. Trên 500 triệu đồng phải có chữ ký của Giám đốc Công ty Demo. Trên 2 tỷ đồng phải có thêm ý kiến bằng văn bản của Phòng Pháp chế trước khi ký.",
  },
  {
    heading: "Điều 2. Điều khoản thanh toán chuẩn",
    body: "Thời hạn thanh toán chuẩn cho nhà cung cấp là 30 ngày kể từ ngày nhận hoá đơn hợp lệ. Tạm ứng tối đa 30% giá trị hợp đồng và chỉ khi có bảo lãnh tạm ứng. Lãi phạt chậm thanh toán không vượt quá 0,05% mỗi ngày trên số tiền chậm trả.",
  },
  {
    heading: "Điều 3. Chính sách với đối tác Bao bì Minh Phát",
    body: "Công ty TNHH Bao Bì Minh Phát là nhà cung cấp ưu tiên hạng A. Minh Phát được thanh toán trong 15 ngày kể từ ngày nhận hoá đơn, hạn mức công nợ tối đa 300 triệu đồng. Đơn hàng bao bì trên 200 triệu đồng phải kiểm tra mẫu trước khi nhận hàng. Đầu mối làm việc với Minh Phát là Phòng Kinh doanh.",
  },
];

export const policyHash = (): string =>
  createHash("sha256")
    .update(POLICY_TITLE + POLICY_CHUNKS.map((c) => c.heading + c.body).join("\n"))
    .digest("hex");
