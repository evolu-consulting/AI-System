---
id: pl-sht-wavefix
lát: pl-sht-wavefix
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: pl-sht-settings (L4)
---
## Plan (ngắn)
Sửa 4 đỏ của test:all cuối đợt CR-105 trong vùng L4 (bỏ PUT /approval-flow + FlowPane).

## Làm
- UI (hồi quy thật): `FlowCurrentPane` che luôn ô ký số (nhà cung cấp mặc định, cụm Bên A/B) khi `GET /approval-flow` lỗi/404; nay khối
  quy trình báo lỗi tại chỗ còn `EsignSetting` luôn hiện. Đỏ 1–2 (esign-multi, esign-anchor).
- e2e `esign-multi`/`esign-anchor` (viết như qc): mock GET approval-flow có 1 bước (schema `steps.min(1)`; `[]` bị mapper từ chối).
- Đỏ 3 `CF/approval-dify`: test PUT-kiểm-khoá-Dify = lỗi thời (PUT đã xoá; kiểm khoá Dify ở xuất bản thư viện/L2a) ⇒ xoá; test "chạy"
  seed quy trình thư viện [duyệt → Dify → duyệt] + gán cho tenant (thay PUT cũ).
- Đỏ 4 `esign-flow » lưu mẫu`: lỗi thời (PUT đã xoá) ⇒ xoá describe. Lưu ý: luật `USER_NOT_MEMBER` (người cụ thể thuộc tenant + quyền
  gói) chưa còn chỗ chặn nào khi xuất bản thư viện — cần B2/L2a nếu muốn giữ.
- `bun run test:lock:write` (qc) sau khi đổi test khoá.

## Test
int `approval-dify` + `esign-flow` xanh (6/6). e2e 2 spec CHƯA chạy được: hết làn e2e (14/14) và `e2e:lanes --prune` cũng đòi làn.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: Delta ở docs/specs/pl-sht-settings/tasks.md; đây chỉ vá hồi quy hiển thị + test lỗi thời của L4)
