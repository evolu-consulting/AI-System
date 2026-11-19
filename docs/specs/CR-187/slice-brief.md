# Brief chung cho mọi lát đợt CR-187..192 (đọc trước khi làm)

**Nguồn:** spec `docs/specs/CR-187/nghiep-vu.md` (thắng khi lệch) · kế hoạch + bản đồ file `docs/specs/CR-187/plan.md` (CR-187/188/192) và `docs/specs/CR-189/plan.md` (CR-189/190/191) · bản mẫu `docs/specs/<CR>/prototype.html` chỉ để xem bố cục · luật `CLAUDE.md` (mục 4–6) · khuôn `tasks.md` + Delta: `docs/WORKFLOW.md` mục «Mẫu tasks.md của lát» · luật UI `packages/web-kit/src/ui/kit/RULES.md`.

**Cách làm:**
1. `bun run slice:new <tên-lát>` từ `D:\AI\ai-system` ⇒ worktree `D:\AI\evolu-wt\<tên-lát>`, nhánh `slice/<tên-lát>` (từ `staging`). Từ đó chỉ ghi trong worktree của mình, luôn đường dẫn tuyệt đối.
2. `docs/specs/<tên-lát>/tasks.md` theo khuôn (Plan ngắn · Làm · Không làm/Chạm · Test tối thiểu · Quyết định trong lúc làm · Delta · Việc còn lại). Mỗi Kịch bản Delta có `[test: <path> » <tiêu đề>]`.
3. Lỗi/hành vi mới: viết test đỏ trước (N8). Quyền/RLS: có ca «người được giao, không phải người tạo» (N2).
4. Chỉ chạy unit + int của file sửa (int nặng ⇒ evotest `powershell -File deploy/evotest/run-tests.ps1 -Step int -Filter "<đường dẫn>" -Dirty`, đặt `$env:EVOTEST_KEY="$HOME\.ssh\evoc_key"`); `tsc` một lần cuối chỉ gói đổi. KHÔNG chạy e2e (viết e2e trong lát, điều phối chạy cuối đợt). Tối đa 3 lượt test.
5. Migration: chỉ thêm, đúng SỐ được giao trong brief riêng, thêm entry `meta/_journal.json`. Không sửa migration đã có.
5b. TRƯỚC commit cuối: `bun run openspec:check <tên-lát>` trong worktree phải xanh — `[test: <đường dẫn file> » <tiêu đề test nguyên văn, không gồm describe>]`; MODIFIED/REMOVED chỉ trỏ file `docs/current/**` ĐANG CÓ, file mới dùng ADDED. Test mới dưới `tests/**`/`e2e/**` ⇒ `bun run test:lock:write` rồi `test:lock:verify` xanh.
   evotest chạy bằng công cụ PowerShell (qua Bash `tar` lỗi rồi báo xanh giả, 0 test).
6. Commit trong worktree, message có `[CR-xxx]`, kèm test trong cùng commit; dòng cuối:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
   Không push, không merge (điều phối gộp).
7. Nhãn tiếng Việt nghiệp vụ, không từ kỹ thuật; chuỗi qua i18n (`packages/i18n/locales/**`), không viết cứng.

**Cấm (A5):** `--no-verify`, `LEFTHOOK=0`, tiến trình tách rời, ghi ngoài worktree, `git checkout -- .`, `git stash`/`reset` index chung, kill rộng, sửa test đã khoá của lát khác (trừ khi spec mới đổi nghĩa — ghi rõ trong Delta + báo cáo), dừng giữa lát để hỏi (tự quyết theo mặc định, ghi «Quyết định trong lúc làm»). Bị hệ thống quyền từ chối ⇒ dừng, báo lại. Thấy sai ngoài phạm vi ⇒ một dòng trong báo cáo, không tự sửa.

**Giới hạn:** ≤ 60 lần gọi công cụ; quá giờ ⇒ commit phần xanh, ghi «Việc còn lại», dừng.

**Báo cáo (≤ 6 dòng, A4):** commit (hash) · test (lệnh → kết quả) · việc dở · bẫy · thời gian (code/chờ/sửa).
