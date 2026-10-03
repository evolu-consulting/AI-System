---
spec: M4-ops
part: phụ lục E2E của test-plan.md (khối A + B)
owner: qc
---

# Test-plan M4 · A + B · E2E

Quy ước: `test-plan.md` §1–2. Lệnh: `bunx playwright test e2e/m4-`.

## E · e2e (Playwright; nhãn nguyên văn plan-frontend §6, ms §1/§4.3/§7/§12.5)

| # | File | Mã | Kịch bản → kỳ vọng |
|---|---|---|---|
| E1 | `m4-quota.spec.ts` | FR-40 | admin `?tab=quota`: `spinbutton "Số run · Cả tenant"` 1000; `+ Thêm quota theo feature` → `combobox "Chọn feature"` Kế toán → `"Số USD · Kế toán"` 300; `Lưu` (chờ PUT 200); reload còn |
| E2 | 〃 | FR-40 | nhập `0` → "Nhập số lớn hơn 0 hoặc để trống"; USD `1.234` → "Tối đa 2 chữ số thập phân"; run `1.5` → "Nhập số nguyên"; không gửi PUT |
| E3 | 〃 | M4-AC02 | không quota → hàng "Cả tenant", chữ "Không giới hạn", không `progressbar`; `button "Bỏ quota Kế toán"` → lưu → hàng biến mất |
| E4 | 〃 | Q9 | sửa run trong lúc API đổi quota (version +1) → `alertdialog "Có người vừa lưu bản mới hơn"` |
| E22 | 〃 | Q9 · tab | mở `?tab=info` và `?tab=quota` của acme; lưu tab Info (đổi tên), rồi lưu tab Quota (không reload) → **không** 409, không `alertdialog`; ngược lại Quota rồi Info cũng vậy (hai tab cập nhật `version` cho nhau) |
| E5 | `m4-usage.spec.ts` | FR-42 | admin `link "Chi phí & quota"`: `combobox "Tenant"`, `"Kỳ"`; 5 `region` KPI (cả "Chi phí thật", "Biên"); `img` "Số thu theo ngày…"; `table "Theo tenant"` có acme, globex |
| E6 | 〃 | M4-R08 · M4-AC03 | binh `/usage`: không `combobox "Tenant"`, `region "Chi phí thật"`/`"Biên"`; response không chứa `cost_usd` |
| E7 | 〃 | M4-R07, R08 | `region "Top feature theo số thu"` có "Không theo feature", "Chưa định giá", badge "Vượt quota" |
| E8 | 〃 | FR-42 | `button "Xuất CSV"` → `download` tên `usage-acme-…csv`, nội dung bắt đầu BOM, binh không cột `cost_usd` |
| E9 | 〃 | M4-R09 · M4-AC13 | usage rỗng → KPI "—", hover → `getByRole("tooltip")` chứa "Chưa có dữ liệu từ Agent Hub"; không `ErrorState` |
| E10 | `m4-overview.spec.ts` | M4-R06 · AC-A12 | 850/1000: binh `alert` "Đã dùng 85% quota tháng này" + `link "Xem chi tiết"` → `/usage`, không nút đóng, có cả ở `/users`; 1001 (hàng cuối overage) → "Đang vượt quota, phần vượt được tính phí" + badge "Vượt quota" ở `/usage` |
| E11 | 〃 | M4-R06 | admin cùng dữ liệu → không `alert` quota; không quota → binh không `alert` |
| E12 | 〃 | ui 7.2 | binh `/`: `region` "Users đang hoạt động", "Quota tháng" (`progressbar "Run"`), "Người dùng mới chưa đăng nhập", "Thay đổi gần đây"; `link "Xem nhật ký"` |
| E13 | 〃 | Q5 · M4-AC13 | admin `/`: `link "Tạo tenant"`, `"Tạo command"`; "Tenant sắp hoặc đã vượt quota" có acme; "Sẽ có khi Agent Hub sẵn sàng." ×2; rỗng → "—" |
| E14 | `m4-audit.spec.ts` | FR-51 | admin sửa `/dich` (API) → `/audit` (audit tích luỹ, không xoá): lọc `q` "/dich" **hoặc** `.first()` theo mốc ca (dòng mới nhất); `listitem` "admin đã sửa command /dich"; `Xem thay đổi` → `dialog`, `table "Thay đổi"` có "đã đổi", URL `/audit/{id}`; `Đóng` → `/audit` |
| E15 | 〃 | FR-52 · M4-AC08 | (v42→v43 như RS) `Khôi phục bản trước` → `alertdialog "Khôi phục /dich về trạng thái trước v43?"` → `Khôi phục` (chờ POST 200) → toast "Đã khôi phục /dich · v44" |
| E16 | 〃 | M4-R13 | NAME_TAKEN (RS3 dữ liệu) → toast "Không khôi phục được: /dich đã được dùng bởi command khác" |
| E17 | 〃 | BR-04 | thay giá trị secret → chi tiết "Giá trị: đã thay đổi", trang không chứa `LEAK_2` (`leaksOnPage`) |
| E18 | 〃 | Q8 · M4-AC07 | binh `/audit`: dòng acme, không "Toàn hệ thống", không `Khôi phục bản trước`; `/audit/{id globex}` → "Không tìm thấy" |
| E19 | 〃 | M4-R12 | 55 dòng `m4-page-*` → tìm "m4-page" → `Tải thêm` → > 50 `listitem` |
| E20 | 〃 | M4-AC12 | an `/audit`, `/usage` → `/member` |
| E21 | `m4-conflict.spec.ts` | M4-R17 · M4-AC14 | user `lan` / tenant acme, admin (API) lưu trước → "admin vừa sửa user này lúc … (v{n}). Bản của bạn dựa trên v{m}."; `Ghi đè` → "Lịch sử vẫn giữ v{n}." |

