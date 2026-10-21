-- friendly-groups · đổi tên hiển thị Group vai của gói (contracts/knowledge) sang tên dễ hiểu. CHỈ đổi khi tên còn đúng mặc định cũ
-- (`contracts · Chủ sở hữu`…) ⇒ tên admin đã tự đổi được giữ nguyên. Khoá Group không đổi. Áp cho mọi tenant (demo, nitigroup…).
WITH m(key, old_vi, new_vi, new_en, descr) AS (VALUES
  ('contracts-owner',  'contracts · Chủ sở hữu', 'Sổ Hợp Tác – Toàn quyền',  'Contract Book – Full access', 'Xem, sửa và quản trị mọi thứ trong Sổ Hợp Tác'),
  ('contracts-editor', 'contracts · Biên tập',   'Sổ Hợp Tác – Nhân viên',   'Contract Book – Staff',       'Xem và nhập, chỉnh sửa dữ liệu trong Sổ Hợp Tác'),
  ('contracts-viewer', 'contracts · Xem',        'Sổ Hợp Tác – Chỉ xem',     'Contract Book – View only',   'Chỉ xem, không sửa dữ liệu trong Sổ Hợp Tác'),
  ('knowledge-owner',  'knowledge · Chủ sở hữu', 'Tài liệu nội bộ – Toàn quyền', 'Internal Documents – Full access', 'Xem, sửa và quản trị mọi thứ trong Tài liệu nội bộ'),
  ('knowledge-editor', 'knowledge · Biên tập',   'Tài liệu nội bộ – Nhân viên',  'Internal Documents – Staff',       'Xem và nhập, chỉnh sửa dữ liệu trong Tài liệu nội bộ'),
  ('knowledge-viewer', 'knowledge · Xem',        'Tài liệu nội bộ – Chỉ xem',    'Internal Documents – View only',   'Chỉ xem, không sửa dữ liệu trong Tài liệu nội bộ'))
UPDATE admin.groups g
   SET name = jsonb_build_object('vi', m.new_vi, 'en', m.new_en),
       description = COALESCE(g.description, m.descr),
       updated_at = now(), version = g.version + 1
  FROM m
 WHERE g.key = m.key AND g.name ->> 'vi' = m.old_vi;