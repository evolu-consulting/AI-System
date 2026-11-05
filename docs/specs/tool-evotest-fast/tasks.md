---
id: tool-evotest-fast
lát: tool-evotest-fast
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Giảm thời gian chờ ngoài test của `deploy/evotest/run-tests.ps1` (int nhỏ 100–220 s → ≤ 45 s). Đo: nguồn 128 MB (docs/specs 106 MB ảnh bằng chứng) đi tgz+scp mỗi lượt, ~9 vòng ssh/scp.

## Làm
1. **Loại nhị phân bằng chứng**: `deploy/evotest/archive-exclude.txt` (pathspec `docs/**/*.{png,jpg,jpeg,gif,webm,mp4,zip,pdf}`; baseline e2e `e2e/**/baseline` GIỮ). Đã grep: không test/tool nào đọc các file này (test đọc docs chỉ đọc .md/.json). Tgz 127,6 → 21,2 MB.
2. **Mirror git trên máy chủ** `~/workspace/evotest/mirror.git` (`receive.shallowUpdate`): `git push <sha>:refs/evotest/<stamp>` chỉ gửi phần chênh lệch (lần đầu ~20 s, sau đó ~2–3 s); `remote.sh` `git archive` tại chỗ (+ loại theo archive-exclude.txt). `-Dirty` = commit tạm dựng từ index tạm (tôn trọng .gitignore, gồm file mới/đã xoá) đẩy cùng đường; không đụng index/nhánh thật. Đẩy lỗi hoặc `-NoMirror` ⇒ dự phòng `git archive` local → tgz → scp (cũng loại nhị phân). Ref `refs/evotest/*` > 1 ngày bị dọn cuối `remote.sh` (giữ ref mới nhất làm gốc); `gc --auto --prune=1.day.ago`. Bản `run-tests.ps1` cũ vẫn chạy (không gửi `EVO_SRC_REF` ⇒ nhánh tgz).
3. **Ít vòng**: 1 tgz kit (gồm boot.sh, lock.sh, archive-exclude.txt) = 1 scp; boot/lock tách trong chính lệnh ssh chạy; lấy log về 1 scp (out.tgz cũ >3 h do remote.sh dọn). ssh probe tạo luôn mirror. 9 → 5 vòng (probe, push, kit, chạy, log). ControlMaster KHÔNG dùng được trên OpenSSH Windows (`getsockname failed: Not a socket`).
4. **Tóm tắt gọn** `tools/scripts/src/evotest-summary.ts` (+ `.rules.ts`, test): mặc định `run-tests.ps1` chỉ in ≤ ~8 dòng (bước, tổng/server, thời gian từng pha, pass/fail, việc e2e, CHỈ đỏ MỚI `NEW [suite] file › ca`, đường dẫn log); `-Full` in cả log; `-Step perf`/`-Exclusive`/`-Probe` luôn in đủ. Ghi `summary.compact.txt`. Lượt chia slot in tóm tắt gộp các ngăn.
5. **`bun run verify:slice [--e2e <việc>[,<việc>]] [-Dirty]`**: mở rộng verify:slice có sẵn (import-graph → int dính diff; local ∥ server); `--e2e` thêm việc e2e vào kế hoạch server (int + e2e vào thùng/slot khác nhau chạy song song), `-Dirty` ép gửi thay đổi chưa commit.
6. Sửa lỗi cũ: biến `$probe` (lệnh đo tải) đè `-Probe` (PowerShell không phân biệt hoa/thường) ⇒ `EVO_PROBE` luôn là chuỗi lệnh; đổi tên `$loadProbe`. Thêm BOM cho run-tests.ps1 (PS 5.1 hết hỏng dấu tiếng Việt).

## Không làm / Chạm
Không đổi cache dựng web/dbtpl, không đổi test nào. Chạm: deploy/evotest/{run-tests.ps1,remote.sh,archive-exclude.txt,README.md}, tools/scripts/src/{evotest-summary*,verify-slice,test-affected*}.ts, docs/WORKFLOW.md.

## Test tối thiểu
Unit: `evotest-summary.rules.test.ts` (6), `test-affected.test.ts` (parse `--e2e-jobs/--dirty`). Chạy thật trên evotest: int nhỏ (mirror, -Dirty có file chưa theo dõi, -NoMirror), e2e community-web, bản run-tests.ps1 cũ + remote.sh mới.

## Quyết định trong lúc làm
- `-Dirty` dùng commit tạm thay vì patch + áp dụng phía máy chủ: cùng kết quả (chỉ phần chênh lệch đi), xử lý nhị phân/xoá/untracked sẵn, không cần mã áp patch.
- Tóm tắt gọn là mặc định (agent chỉ cần nó); log đầy đủ luôn ở `<log>\console.log`.

## Số đo (cùng bộ lọc int `community.flows.int.test.ts`; e2e `community-web`)
| | trước | sau |
|---|---|---|
| int nhỏ, wall | 109 s | 38 s (lượt đầu của mirror 92 s: đẩy 20+ s một lần) |
| e2e community-web, wall | 167 s (server 117 s, dựng web 58 s) | 100 s (server 82 s, cache dựng đã nóng) |
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ hạ tầng test/evotest — đường chuyển mã nguồn (mirror git + loại nhị phân bằng chứng docs), tóm tắt gọn, `verify:slice --e2e/-Dirty`; không đổi mã sản phẩm nào).
## Việc còn lại
