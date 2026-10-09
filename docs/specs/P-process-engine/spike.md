---
id: P-process-engine/S1
title: Spike S1 — điều phối Nhóm agent BA với Claude CLI thật
date: 2026-10-10
status: done (đề xuất; chờ người dùng chốt Q4)
code: apps/agent-runtime/spikes/process_team/ (team_spike.py, run_all.sh; raw ở out/, gitignore *)
---

# Spike S1 — Nhóm BA: chọn chế độ mặc định + giới hạn

**Cách đo.** `claude -p --output-format json` (CLI 2.1.294, `claude-sub`, WSL user `worker`, dev/test CR-019), không tool/MCP/session, `--system-prompt` riêng mỗi vai. Đầu vào: "Yêu cầu: Cho phép xuất hoá đơn ra PDF … có logo công ty." Thành viên: Analyst, Domain Expert (sonnet), UX Writer, BA Lead (haiku). Token lấy từ `usage` của JSON. **39/40 lần gọi** (31 chạy + 8 judge). Mỗi chế độ chạy 2 lần.

## Kết quả (tổng token = in + out + cache-read + cache-write; trung bình 2 lần, trong ngoặc là 2 giá trị)
| Chế độ | Lần gọi | Token tổng | Trong đó out | Thời gian | Chất lượng /8 (judge) | Biến thiên |
|---|---|---|---|---|---|---|
| **A** tuần tự cố định | 3 | **27,3k** (29,1 / 25,5) | 16,1k | **95 s** (101 / 88) | 8, 8 | token ±7%, thời gian ±7% |
| **B** song song + gộp | 4 | 41,2k (41,5 / 41,0) | 26,4k | 106 s (109 / 103) | 8, 7 | token ±1% |
| **C** trưởng nhóm lập kế hoạch | 6 | 67,3k (72,2 / 62,4) | 35,0k | 211 s (227 / 194) | 8, 7 | token ±8%, thời gian ±8% |
| **D** MCP lai | — | **không đo** | | | | xem dưới |

- C: kế hoạch (1 lần, ~600 token out, 10 s, rẻ) ra 4 bước: analyst → domain → ux → **analyst lần 2** (gộp lại); cộng 1 lần trưởng nhóm kiểm cuối (đọc tóm tắt + file; haiku trả 3–4k token out dù đã dặn "chỉ liệt kê lỗi", ~11k token vào). Hai khoản này (bước thừa + kiểm cuối) chiếm ~50% tổng token của C.
- Chất lượng: cả 3 chế độ đủ 5 mục khung, 34–64 AC, phủ đủ logo/nhiều trang/điều chỉnh-thay thế/lỗi thiếu logo/tiền-ngày VN (kiểm tự động bằng regex: đạt cả 6 lần). Judge (haiku) trừ 1 điểm "bịa phạm vi" ở B2 và C2 (watermark, nhật ký, trạng thái PDF hoá đơn gốc). Kiểm tay: **A bám sát nhất**; B1 vẫn thêm AC hoá đơn ngoại tệ mà judge không bắt → judge haiku **dễ dãi**, điểm 7 vs 8 chưa phân biệt được ở mẫu nhỏ. Mọi chế độ đều **phình** (11–15k ký tự, 34–69 AC cho một yêu cầu một dòng) — cần dặn trần số AC trong prompt vai.
- Mỗi thành viên **viết lại cả file** nên out token ≈ 60–70% tổng và tăng theo độ dài file; cache gần như không giúp (prompt hệ thống ~0,9k token, phần đổi mỗi lượt là file; `cache_read` chỉ 0,9–2,8k khi chạy lại trong vòng 5 phút).

## Làm lại (từ A1, góp ý "Thiếu trường hợp hoá đơn nhiều trang; thêm số trang 1/2 ở chân trang")
| | Lần gọi | Token | Thời gian | Chi phí quy đổi API* | Điểm | Có "1/2" |
|---|---|---|---|---|---|---|
| (i) chạy lại đủ 3 thành viên | 3 | 52,7k | 136 s | $0,244 | 8 | có |
| (ii) chọn lọc: Domain + UX | 2 | **34,1k (−35%)** | **89 s (−35%)** | $0,125 (−49%) | 8 | có |

Bỏ Analyst (mục tiêu/user story không bị ảnh hưởng) là đủ; chất lượng ngang nhau. Mỗi lần làm lại rẻ hơn chạy mới (A: 27k) vì file đã có — nhưng **đắt hơn** do file dài hơn; ~34–53k/lần làm lại, nên trần 3 lần làm lại ≈ 160k token/stage.

## Khuyến nghị
1. **Mặc định P-a: chạy tuần tự do Hub điều phối, kế hoạch lấy từ trưởng nhóm một lần (biến thể "C-gọn" = C bỏ bước kiểm cuối của trưởng nhóm và bước thừa).** Giữ ngữ nghĩa Q4 (trưởng nhóm chỉ trả kế hoạch, Hub gọi thành viên). Ước tính ≈ A + 1 lần gọi kế hoạch ≈ **30k token / 4 lần gọi / ~105 s** (suy ra từ số đo, **chưa đo trực tiếp**). Hub kiểm template bằng mã (P-R03) thay vì LLM kiểm; trưởng nhóm chỉ đọc tóm tắt khi thành viên báo "còn hở". Với nhóm seed có thứ tự cố định thì dùng A (bỏ luôn lần kế hoạch).
2. **B (song song + gộp)** chỉ khi cần thời gian ngắn và các vai độc lập (đo: không nhanh hơn A vì lần gộp tốn 50–65 s, và tốn +50% token). **C đầy đủ** (có kiểm cuối) chỉ khi người dùng bật "kiểm kỹ"; không làm mặc định.
3. **Giới hạn team-run** (đối chiếu §2.1): ≤ **10 lần gọi** giữ nguyên (đo cao nhất 6; mặc định 4–5); ≤ **200k token** giữ nguyên, đếm theo cùng công thức in+out+cache (đo cao nhất 72k, làm lại ≤ 53k; chừa ~2,7× để file dài hơn); ≤ **10 phút** giữ nguyên (đo cao nhất 227 s, mỗi lần gọi 10–68 s; hạ không có lợi). "Dừng sớm khi 2 lần gọi liền không đổi" **chưa kiểm** (không có ca nào kích hoạt) — giữ, cần test ở P-a. Thêm: **trần 5 bước/kế hoạch** (C1/C2 đều ra 4 bước, có 1 bước thừa) và Hub từ chối `member` lạ.
4. **Tóm tắt**: ≤ 200 token chỉ được tuân thủ gần đúng (vài bản tóm tắt của ux/analyst dài hơn, chưa đếm chính xác); Hub phải cắt cứng ở 200 token khi đưa cho trưởng nhóm. Thành viên nên trả **chỉ phần/mục của mình + tóm tắt** thay vì cả file (Hub ghép theo mục), vì viết lại cả file là khoản out lớn nhất — ước giảm 40–60% token (chưa đo).
5. **Bố cục prompt cho cache**: system = [quy tắc nhóm + template + thẻ vai] cố định, user = [yêu cầu → file hiện tại → việc lần này]. Ở quy mô này (~1k token) cache không đáng kể; chỉ có ý nghĩa nếu tiền tố ≥ 1k token (quy tắc/ví dụ dài) — đừng thiết kế quanh cache ở P-a.
6. **MCP lai (D) — không đáng ở P-a (đầu vào Q4).** Không đo: dựng máy chủ MCP bọc `claude -p` lồng nhau là khả thi (đã có `mcp_fake.py` làm mẫu) nhưng mỗi lượt trưởng nhóm phải mang cả file trong ngữ cảnh (≥ C về token), Hub mất kiểm soát đếm lần gọi/token/thời gian từng thành viên (HUB-FR-115/116, WRK-BR-07), và CR-023 đang Hoãn. Mở lại khi có nhu cầu trưởng nhóm tự quyết gọi thành viên theo nội dung.

## Hạn chế
Mẫu nhỏ (2 lần/chế độ, 1 đề bài, 1 ngôn ngữ); judge haiku dễ dãi, không thay được người duyệt; **\*Chi phí USD do CLI quy đổi theo giá API — gói subscription không tính theo token** nên thực tế bị giới hạn bởi quota/slot (K3), không phải đô la; thời gian gồm ~5–10 s khởi động CLI mỗi lần gọi; không tool/MCP nên số liệu không gồm chi phí tool; `usage.input_tokens` luôn = 2 vì CLI đưa toàn bộ prompt vào cache-write.

## Phụ lục — số đo từng lần gọi
| Chạy | Lần gọi (vai: model, out token, cache-w, giây) | Tổng in/out/cr/cw | Giây | USD* |
|---|---|---|---|---|
| A1 | analyst s 2872/910/28 · domain s 6196/3792/41 · ux h 8256/7109/32 | 6 / 17324 / 0 / 11811 | 101,5 | 0,115 |
| A2 | analyst s 2494/0(cr 910)/23 · domain s 5426/3414/37 · ux h 6909/6339/27 | 6 / 14829 / 910 / 9753 | 87,5 | 0,098 |
| B1 | ux h 2604/924/19 · analyst s 3097/902/29 · domain s 5216/931/45 · lead h 16366/11417/65 | 8 / 27283 / 0 / 14174 | 109,4 | 0,102 |
| B2 | ux h 2660/0/19 · analyst s 3128/0/29 · domain s 6574/0/50 · lead h 13103/12765/53 (3 vai đầu cr 2757) | 8 / 25465 / 2757 / 12765 | 102,5 | 0,108 |
| C1 | plan h 605/970/10 · analyst s 3290/1040/30 · domain s 7060/4085/49 · ux h 12114/7586/48 · analyst s 11357/8845/68 · lead-kiểm h 4250/11004/24 | 12 / 38676 / 0 / 33530 | 227,4 | 0,285 |
| C2 | plan h 639/0(cr 970)/10 · analyst 3289/1041/32 · domain 6638/3950/44 · ux 8944/7144/35 · analyst 8880/7551/54 · lead-kiểm 2855/10438/19 | 12 / 31245 / 970 / 30124 | 194,0 | 0,248 |
| redo_full | analyst s 7851/7466/46 · domain s 9561/8161/54 · ux h 10060/9583/35 | 6 / 27472 / 0 / 25210 | 135,6 | 0,244 |
| redo_sel | domain s 8844/7495/56 · ux h 9079/8675/33 | 4 / 17923 / 0 / 16170 | 88,7 | 0,125 |
| judge ×8 | haiku | — | — | — |

Điểm judge /8: A1 8 · A2 8 · B1 8 · B2 7 · C1 8 · C2 7 · redo_full 8 · redo_sel 8. Raw: `apps/agent-runtime/spikes/process_team/out/*.{md,json}` (~200 KB, gitignore).
