---
id: cr121-r6-port-clash
lát: cr121-r6-port-clash
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

Lượt `verify:wave` 4: `pm-checklist-pm` báo "http://localhost:3420 is already used", `journey-approval-journey.1of3` báo "3440 is already used".
Nguyên nhân thật: KHÔNG phải tranh cổng giữa các slot (mỗi slot là một project Docker riêng, mạng riêng, không `ports:`). Đụng cổng xảy ra TRONG một slot, giữa hai việc chạy cùng lúc: log `console.log` cho thấy bin `pm-checklist-pm + root-2` và bin `journey.1of3 + root-4`. Cổng web của mảnh gốc `root-k` = 3400 + 10k trùng bảng cổng cố định của cấu hình khác: pm-checklist 3420–3424 (root-2 = 3420), journey 3440–3444 (root-4 = 3440), workspace-web-stack 3410–3413 (root-1), community-web-stack 3400–3405, community-web 3470 (root-7).

## Chọn cách: (a') dời dải cổng mảnh gốc, không phải (a) cộng khoảng theo slot

(a) "mỗi slot một khoảng cổng" không chữa được lỗi này vì nó nằm TRONG slot (hai việc cùng slot cùng được dịch như nhau, vẫn trùng nhau). (b) "kế hoạch không xếp hai việc trùng cổng" cần bảng cổng của mọi cấu hình và ràng buộc thêm vào LPT. Rẻ và chắc nhất: mảnh gốc đã nhận cổng từ env (`E2E_ROOT_WEB_PORT`), nên chỉ cần dời cơ sở sang dải mà không cấu hình nào dùng: web = 3600 + 10k (k = 1..6), API = web + 1, mảnh `clock` 3690, mảnh 0 giữ 3000/3001. Dải 3600–3699 vẫn nằm trong 3000..5500 của luật làn local (+3000/làn) nên làn local không đổi.

## Làm

- `test-e2e-par.rules.ts`: `ROOT_PORT_BASE` 3400 → 3600 (dùng cho cả `rootJobs` của `test:e2e:par` local và mảnh của cổng đợt).
- `e2e-pieces.rules.ts`: `ROOT_CLOCK_PORT` 3490 → 3690, sửa chú thích.
- `wave-plan.test.ts`: test chặn trùng — cổng mảnh gốc (k = 1..6 + clock, cả API) nằm trong 3600–3699, khác nhau, và không file `e2e/**/playwright*.config.ts` / `e2e/**/_*.ts` nào chứa số trong khoảng đó; `test-e2e-par.test.ts` kiểm ca khác 0 ≥ 3610.

## Không làm / Chạm

Không chạy `verify:wave` thật, không đổi cấu hình e2e (khoá test). Chỉ tools/scripts.

## Test tối thiểu

`bun test tools/scripts/src/wave-plan.test.ts tools/scripts/src/test-e2e-par.test.ts` (33 pass). Dry-run: `planJobs` với `root@0..6,root@clock` cho `root-0:3000 root-1:3610 … root-6:3660 root-clock:3690`; `verify:wave --plan --slots=7` vẫn lập được kế hoạch.

## Quyết định trong lúc làm

- Bất kỳ cấu hình e2e mới phải tránh 3600–3699 (test sẽ đỏ nếu dùng).
- Các cấu hình cố định còn lại (cs 3400, ws 3410, community-web 3470, pm 3420, journey 3440, N1 3300, cw 3310…) đã khác nhau từng đôi nên chạy cùng slot được.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: hạ tầng chạy test; chỉ đổi dải cổng của mảnh gốc e2e để không đụng cổng cố định của cấu hình khác trong cùng slot)

## Việc còn lại

- Xác nhận ở lượt `verify:wave` kế: không còn "is already used".
