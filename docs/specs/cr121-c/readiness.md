## Kết luận: NOT READY (lần 1, 2026-11-06)
Phạm vi đã kiểm: docs/specs/cr121-c/{spec.md,tasks.md} · 2 file + CLAUDE.md + `defs.routes.ts:26-51` + grep schema `source_template_id/rel_version` (có trong migrations-hub 0068/0092) · mã: CR-121 R1–R9, Q1–Q7, D1–D5, c9…c21

## Lỗ hổng
| # | Mức | Mục | Vị trí | Vấn đề | Mặc định đề xuất |
|---|-----|-----|--------|--------|------------------|
| 1 | Chặn | B/J | spec R9 dòng 143-144 | Endpoint mới c9 (lọc `slot/def_id`, sao chép thư viện→công ty) không có method/path chốt ("đề xuất mở rộng `copy` hoặc `POST /tenants/:tid/...`"), thiếu schema request/response, mã lỗi/HTTP status, role gọi | Chốt `POST /tenants/:tid/process-defs/:id/clone-for-company`; platform_admin mọi tenant; tenant_admin chỉ `:tid` = tenant mình (khác ⇒ 404); member 403; res `{def_id, source_template_id, rel_version, created:boolean}`; 200 khi đã có (idempotent), 201 khi tạo mới; def không phải thư viện/slot ⇒ 422 `NOT_LIBRARY_DEF` |
| 2 | Chặn | B | spec R4/R8 vs `defs.routes.ts:26` | Def thư viện (`slot`) chỉ hiện với platform_admin, nhưng Q6 cho tenant_admin thấy tab Quy trình và Q1 mở thư viện chỉ-xem + Sao chép. Không nói tenant_admin có Gán/Đổi/Sao chép/Mở chỉ xem được không | tenant_admin: xem + Sao chép + Gán/Đổi cho tenant mình (đọc def thư viện qua đường đọc riêng chỉ-xem theo tenant); không sửa def thư viện. Ghi vào Quyết định |
| 3 | Cao | H | tasks.md 12-31 | Không có cột `Rủi ro`; c9, c18, c20 (RLS/dữ liệu khách/đường ghi) phải `cao` | Thêm cột; c9/c18/c20/c19 `cao` (Sonnet high + Opus low soát), còn lại `thường` |
| 4 | Cao | I | tasks.md 5-6,47 · spec 13,155 | "migration: không / Không làm migration" mâu thuẫn c18 (0037) và c20; tiêu đề nói "9 lát c9…c17" nhưng có 13 lát | Sửa: `migration: admin 0037 (c18), pack-contracts 0076 (c20), hub 0103 (chỉ c9 nếu cần; cột source_template_id/rel_version đã có ⇒ dự kiến KHÔNG cần)`; "13 lát c9…c21" |
| 5 | Cao | H | tasks.md 30 | c20 ghi "số do điều phối giao" thay vì 0076; c9 chưa ghi 0103; journal `when` chưa giao | Ghi 0076, 0103 (nếu cần), 0037; điều phối giao `when` trước |
| 6 | Cao | H/I | tasks.md 34 | Nói "c15 ‖ c17 song song" nhưng c17 phụ thuộc c15 (dòng 23) | Bỏ "‖": c15 → c17 nối tiếp (hoặc bỏ phụ thuộc c15 của c17 nếu thật sự độc lập) |
| 7 | Cao | H/J | tasks.md 15,17,23,30 | Phạm vi file mơ hồ, không phải đường dẫn cụ thể: c9 "`*list*`", "routing luật định tuyến", "test int mới"; c16 "hub-api module đọc gộp"; c17 "chỉ phần soi lệch"; c18 "fixture/test/i18n nhắc engine feature"; c20 "module cài đặt công ty/`/pack/me`" | Mỗi lát liệt kê đường dẫn + tên hàm/kiểu; lát chưa biết thì bước đầu là Explore Haiku điền vào tasks.md trước khi giao |
| 8 | Cao | F/H | tasks.md 36-44 | "Xong khi" thiếu cho c18, c19, c20, c21 (dữ liệu: backfill test, mọi chỗ đọc, check) và yếu cho c12–c14 | Thêm: c18 int migrate + grep không còn tham chiếu engine feature/suy app từ tiền tố; c19 int từng quy tắc check; c20 int backfill + đổi tên ⇒ `/pack/me` ETag; c21 int seed-một-lần idempotent |
| 9 | Cao | D | spec D2 dòng 44 | Quy tắc check (2) và "đề xuất rút từ code, c19 xác minh trước khi khoá" = chưa chốt, hai cách hiểu (lỗi hay cảnh báo) | Quy tắc 1,3,4,5 = lỗi; quy tắc 2 = cảnh báo cho đến khi c19 xác minh bằng dữ liệu thật; ghi vào Quyết định |
| 10 | Cao | K/D8 | tasks.md | Chỉ c9/c10/c16 có dòng perf; c11–c15, c17–c21 thiếu mục "perf" (D8). c18/c20 là migration trên bảng thật (khóa/độ dài), c19 check quét toàn tenant | Mỗi lát một dòng perf: c11–c15,c17 "không chạm đường nóng; không thêm truy vấn từng hàng"; c18/c20 "migration set-based, một câu mỗi bảng"; c19–c21 "check một câu SQL theo tập, không lặp theo tenant" |
| 11 | Cao | E2E | tasks.md 40-44 | e2e MỚI D5 (hành trình gán qua Công ty › Quy trình, platform_admin) không gán lát nào; spec 151-152 chỉ liệt kê; e2e tenant_admin 5 tab chỉ ghi ở c14 nhưng tenant_admin còn dùng tab Quy trình (c11) | Gán D5-journey cho c11 (qc), tenant_admin 5 tab cho c14; e2e Dify bật/tắt (c16) |
| 12 | Cao | C | spec R9 / D1,D5,D3 | Ngoài c9: cách ly tenant cho "Dùng bởi" Công cụ AI (c16: công ty nào thấy gì), endpoint công tắc Dify theo công ty (role), `/pack/me` đọc `admin.tenants.name` (cross-schema, RLS/grant) chưa nói | c16 endpoint: platform_admin only, 403 cho role khác; số đếm không lộ tên công ty cho tenant_admin; c20 `/pack/me` đọc tên qua tenant của phiên (RLS giữ), int chặn đọc chéo |
| 13 | Cao | D | spec R8 dòng 135 | Chưa nói: khi nhiều luật điều kiện trỏ bản thư viện cũ nhưng luật khác trỏ quy trình khác loại/bản riêng khác; xung đột 2 admin cùng bấm; mã lỗi khi việc không còn slot | Chỉ đổi luật đang trỏ đúng def thư viện nguồn; khoá `FOR UPDATE` trên hàng slot; lần hai trả `created:false` |
| 14 | Trung | J | spec | Câu báo lỗi/toast nguyên văn chưa có (Sao chép thành công/lỗi, "Tối đa 20 bước" có; thông báo chuyển hướng workflow-tools có) | Thêm 3 chuỗi: "Đã sao chép và gán cho công ty này", "Không sao chép được: <lý do>", ... vào mục i18n |
| 15 | Thấp | L | — | c18 chạm `i18n`/fixtures chung với lát song song | Namespace riêng, merge driver JSON |

## Mâu thuẫn giữa tài liệu
- spec "Không migration (dự kiến)"/tasks `migration: không` ↔ spec D1/D3/D5 (0037, pack mới) → giữ D1–D5, sửa đầu trang.
- tasks "c15 ‖ c17" ↔ c17 phụ thuộc c15 → nối tiếp.
- spec R1 redirect `/commands`→`/ai-tools?kind=` ↔ c10 "route /ai-tools chuyển hướng tạm → /workflows" (đúng nếu c16 thay sau) → ghi rõ tạm.

## Checklist
| Mục | Kết quả | Bằng chứng |
|-----|---------|-----------|
| A Phạm vi | Đạt | spec R1–R9, "Không làm" 154-155 |
| B Contract | Thiếu | #1, #2, #12 |
| C Dữ liệu | Đạt một phần | D1–D5 có backfill/đọc/check; thiếu RLS #12 |
| D Nghiệp vụ | Thiếu | #9, #13 |
| E UI | Đạt | R1–R8 nhãn nguyên văn; artboard tên trong spec dòng 6 (chưa mở đối chiếu) |
| F Kiểm chứng | Thiếu | #8, #11 |
| G Phụ thuộc | Đạt | Dify mock sẵn; không thêm thư viện |
| H Task | Thiếu | #3,#5,#6,#7 |
| I Nhất quán | Mâu thuẫn | #4 |
| J Chính xác | Thiếu | #1,#7,#14 |
| K Hiệu năng | Thiếu | #10 (R9 dòng 147 chỉ phủ c9/c16) |
| D6 | Đạt | c11 chuyển+gỡ TenantProcessSlots; c16 gỡ workflow-tools; c13/c14 gỡ nốt; c18–c21 liệt kê đọc/gỡ |
| Song song | Đạt trừ #6 | c9‖c10‖c18 không chung file; registry.ts tuần tự c18→c21 |

## Quét từ mơ hồ
Chưa quét Grep đầy đủ; các cụm "đề xuất", "nếu cần", "c19 xác minh", "c20 xác nhận" được ghi ở #1, #9 (D3 brand giữ ở gói: mặc định có, chấp nhận).

## Chưa kiểm
Artboard `.dc.html` (nhãn); BA/INDEX/CODEMAP; symbol code cũ ngoài `defs.routes.ts`; trần kích thước (spec ~16 KB > 12 KB: Thấp, cắt văn xuôi).

---
## Lần 2 (2026-11-06) — Kết luận: READY
Phạm vi: diff e741d245..70d66e9f của spec.md/tasks.md (chỉ đối chiếu lỗ hổng Chặn/Cao lần 1 + Q8 vai tenant_admin + Q11 canvas mặc định). Chưa đọc lại toàn bộ.

| # lần 1 | Kết quả | Bằng chứng |
|---|---|---|
| 1 Chặn endpoint clone | Đóng | spec R9 dòng 134: `POST /tenants/:tid/process-defs/:id/clone-for-company`, res `{def_id,source_template_id,rel_version,created}`; tasks c9: 201/200/422 `NOT_LIBRARY_DEF`,`SLOT_GONE` |
| 2 Chặn vai tenant_admin | Đóng | Q8 (spec:24) + R9 dòng 135 `GET /tenants/:tid/process-library/:id`: tenant lạ 404, member 403, kiểm ở service, int chặn chéo tenant |
| 3 Rủi ro | Đóng | tasks cột Rủi ro: c9/c18/c19/c20/c21 `cao`; c16 ghi thường kèm endpoint role |
| 4,5 Migration | Đóng | tasks: 0037/0076/0103 (hub chỉ nếu cần), giao `when` trước |
| 6 c15‖c17 | Đóng | "c15 → c17 (KHÔNG song song)" |
| 7 File cụ thể | Đóng | mục "Phạm vi file + xong khi + perf" từng lát có đường dẫn |
| 8,10 Xong khi/perf | Đóng | mỗi lát có "Xong khi" và "Perf" |
| 9 D2 | Đóng | quy tắc 2 = cảnh báo (tasks c19, Q10) |
| 11 e2e D5 | Đóng | c11 (D5 + tenant_admin Sao chép/Gán), c14 (5 tab), c16 (Dify) |
| 12 Cách ly | Đóng | R9 dòng 136 c16 platform_admin only/403; c20 `/pack/me` qua tenant phiên + int chéo tenant |
| 13 R8 | Đóng | spec:121 chỉ đổi luật trỏ đúng def nguồn; 14 chuỗi toast: spec:122 |
| Q11 mới | Đạt | spec:126-128 mặc định canvas, khoá `processView`, lỗi ⇒ canvas; `view-mode.ts` c11 tạo, c15/c17 dùng lại |

Thấp còn lại: spec.md ~24 KB vượt trần 12 KB (cắt văn xuôi); artboard Tpl-Detail/Tpl-Editor có thể vẽ danh sách bước làm mặc định ⇒ Q11 thắng, c15/c17 đối chiếu khi code; quét từ mơ hồ đầy đủ chưa chạy lại (đã chỉ đối chiếu diff).
