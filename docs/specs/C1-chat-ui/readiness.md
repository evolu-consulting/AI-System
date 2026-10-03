# Readiness · C1-chat-ui

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-04 | NOT READY (lần 1) | 0 | 3 | 11 | 14 lỗ hổng, đã xử lý theo mặc định (Luật 2) trong cùng commit; chờ chạy lại spec-readiness. Câu hỏi người dùng: ADR-0006 (H1) |

## Lần 1 · 2026-10-04 · NOT READY: cách xử lý

| # | Mức | Lỗ hổng | Xử lý |
|---|---|---|---|
| 1 | Cao | Tay nắm sheet trùng nhãn nút ✕ | `aria-label="Kéo để đóng"` (spec §9 M5–M6, plan-frontend §5/§7) |
| 2 | Cao | Thiếu hạ tầng test contract | Task B0 (bunfig ignore, `bunfig.contract.toml`, script, `LOCKED_DIRS`); QB phụ thuộc B0; bỏ khỏi B6 |
| 3 | Cao | Lệnh xong B2–B4 chạy contract bằng `bun test` | Đổi sang `bun --config=bunfig.contract.toml test --timeout 30000 tests/contract/chat/<file>` |
| 4 | Thấp | F13 tự quét `src/**` | `bunx playwright test -c e2e/chat/playwright.config.ts` + `bun test tests/acceptance/C1/no-hub-url.test.ts` |
| 5 | Thấp | Lệnh xong mốc là placeholder; AC-35 tên file tạm | Điền lệnh cụ thể (spec §8); `e2e/chat/*.chat.ts` |
| 6 | Thấp | "Thu nhỏ flow" chưa định nghĩa | Cùng hành vi ✕ (plan-frontend §5, spec §9) |
| 7 | Thấp | ErrorCard thiếu bảng nút theo mã | Bảng nút theo mã (plan-frontend §5; câu chữ ui-chat §8) |
| 8 | Thấp | "Stream 500 delta không giật" chưa đo được | Hạ thành mục tiêu thiết kế, không phải AC (spec §6, plan-frontend §10/§13) |
| 9 | Thấp | Giới hạn ô đổi tên lệch contract | ≤ 200 ký tự (plan-frontend §5) |
| 10 | Thấp | test-plan §8 M8 chưa chốt | "Đã chốt (spec §9 M8): sai định dạng → coi như không có" |
| 11 | Thấp | `Conversation.flow_count`, `MOCK_FAST` thiếu | Thêm vào spec §3; `MOCK_FAST` mặc định 0, e2e đặt 1 (spec §7) |
| 12 | Thấp | plan.md lệch M1/M3 | §4.1 (`test:contract:chat`, không trong `bun test` gốc), §3.6 (mốc ms/`sid`), §3.2 "30" |
| 13 | Thấp | Contract BA/UI thiếu mã mới | Spec §9: plan §2 là nguồn; backlog H1 ở `TECH-DEBT.md` #32 |
| 14 | Thấp | H2, H4 chưa chép vào spec | Spec §9: H2 chờ người dùng ở Gate (Sáng, TECH-DEBT); H4 theo canvas |

Câu hỏi người dùng: **ADR-0006** (markdown, ≈ 44 KB + 15–20 KB gzip, nạp lazy; mặc định Duyệt), và H2 (giao diện Tối) ở Gate.
