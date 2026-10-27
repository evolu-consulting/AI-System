-- MS-impact · Luật 4c: chấm uy tín V2-E của MỘT đối tác trên đường xác nhận mốc (tx `settle`, ngưỡng V2-D p95 ≤ 50 ms) — mốc đã xong
-- theo (tenant, đối tác, ngày xong) để câu gom `ms0` lọc một đối tác không dò cả khoảng ngày của tenant. Chỉ thêm; chạy lại vô hại.
CREATE INDEX IF NOT EXISTS obligations_party_done_idx ON contracts.obligations (tenant_id, party_key, done_at)
  WHERE status = 'done';
