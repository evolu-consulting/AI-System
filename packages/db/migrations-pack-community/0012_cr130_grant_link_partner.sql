-- CR-130 pha 2 · L2 · ADR-0043: role community EXECUTE cổng ghi liên kết đối tác `contracts.community_link_partner` (contracts 0104; DB mới: role
-- này tạo sau contracts ⇒ cấp lại ở đây, idempotent). Chỉ EXECUTE hàm (USAGE schema đã cấp ở 0011), KHÔNG quyền bảng.
GRANT EXECUTE ON FUNCTION contracts.community_link_partner(uuid, text, text[]) TO community_rw;
