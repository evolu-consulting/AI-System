-- CR-130 pha 2 · L2 (soát) · ADR-0043: role community EXECUTE bản 4 tham số của `contracts.community_link_partner` (contracts 0105; DB mới: role
-- này tạo sau contracts ⇒ cấp lại ở đây, idempotent). Chỉ EXECUTE hàm, KHÔNG quyền bảng.
GRANT EXECUTE ON FUNCTION contracts.community_link_partner(uuid, text, text[], text) TO community_rw;
