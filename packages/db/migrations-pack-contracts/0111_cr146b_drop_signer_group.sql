-- CR-146b · bỏ nhóm «Người ký HĐ» cấp công ty (CR-127 P2, MIGC 0098) và ngưỡng/người phụ trách HĐ nhận ở cài đặt công ty (CR-124 q4, 0087):
-- người ký bên nhận = «Người ký phía công ty» của bước Ký trong quy trình «Nhận HĐ từ đối tác»; ngưỡng + người phụ trách = `trigger.params`
-- của quy trình đó (hub 0143). Không backfill (chưa có khách). Gỡ bảng `partner_settings` (G1: một nguồn).
DROP TABLE IF EXISTS contracts.partner_settings;
