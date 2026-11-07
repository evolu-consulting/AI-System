-- CR-124 · q4 · spec §3 · tính năng thêm `contracts-partner-confirm` (khoá node «Gửi đối tác xác nhận» + hộp «Hợp đồng đối tác gửi»).
-- Chỉ tạo mục danh mục; KHÔNG tự cấp cho công ty nào (bật theo từng công ty ở Công ty › Tính năng). `app` do trigger/hàm `feature_app_of`
-- điền ('contracts'). Chạy lại vô hại.
INSERT INTO admin.features (key, name, description, icon, status)
VALUES ('contracts-partner-confirm',
        '{"vi": "Gửi hợp đồng cho đối tác xác nhận", "en": "Send contracts to partners for confirmation"}'::jsonb,
        '{"vi": "Gửi hợp đồng cho công ty đối tác xác nhận trong quy trình và nhận hợp đồng đối tác gửi tới", "en": "Send contracts to partner companies for confirmation in a workflow and receive their contracts"}'::jsonb,
        'handshake', 'on')
ON CONFLICT (key) DO NOTHING;