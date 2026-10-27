---
id: MS-impact
lát: B3 (backend + UI hộp xác nhận)
cr: CR-101b (Intake 2026-10-27 R18, R19, R34; Câu 11)
làn: đầy đủ (ngưỡng perf, đọc điểm khách)
migration: không dự kiến (nếu cần lưu delta: xin số mới từ điều phối, KHÔNG dùng 0059 của REP-v3)
phụ thuộc: REP-v3 đã merge (engine hiện hành); DOC-legal đã merge (cùng `todo.repo.ts`)
---
# MS-impact — Xác nhận mốc hiện tác động thật

## Plan (ngắn)
Hộp xác nhận mốc hiện tiêu chí trước → sau và điểm trước → sau do MÁY CHỦ tính (xem trước, không ghi); lưu delta thật trên sự kiện khi xác nhận; dòng thời gian đọc delta thật ("uy tín X: a → b"). Bỏ ước lượng client `points.ts`. Lỗi "Chưa rõ": chưa tính điểm + việc "Xác minh lỗi mốc trễ" vào Cần xử lý sau 3 ngày (Câu 11, theo tiền lệ mock bổ sung).

## Làm
| # | Việc |
|---|---|
| 1 | API `GET /obligations/:id/impact?fault=&actual_on=` — một đối tác × một vai, p95 ≤ 100 ms, không quét toàn bộ đối tác, số câu SQL cố định |
| 2 | Lưu delta thật vào sự kiện khi xác nhận mốc (cột/payload hiện có trước; migration chỉ khi bắt buộc) |
| 3 | Nguồn Cần xử lý "Xác minh lỗi mốc trễ" (hàm riêng trong `todo.repo.ts`, sau DOC-legal/REP-v3) |
| 4 | UI `contract-milestones/components/ConfirmBox.tsx` đọc impact thật; bỏ `lib/points.ts`; dòng thời gian đọc delta |

## Không làm
Đổi engine điểm, đổi luật lỗi trễ (chỉ lỗi đối tác trừ điểm — đã có), biểu đồ đối tác.

## Chạm
`H/application/obligation-impact*` (mới), `obligations` xác nhận (ghi delta), `todo.repo.ts` (hàm mới), `W/features/contract-milestones/**` (ConfirmBox, points, timeline), `locales/contracts/ms.*.json`.

## Test tối thiểu
Unit tính delta từ trạng thái trước/sau; một int preview (không ghi) + xác nhận (delta khớp preview); perf p95 ≤ 100 ms đo thật; test chéo tenant endpoint mới. e2e viết không chạy.

## Việc còn lại
- [ ] 1–4.
