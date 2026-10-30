"""Hardening (part A): folds missing fixes into the design. Applied at render time."""

# node id -> extra card content appended to that node's modal card
ADD = {
    # ── spec and requirements (section 3 stays human) ──────────────────────────
    "h0": {"steps": [
        "<b>Cổng đo được (testability)</b>: code kiểm mỗi F-item có ≥ 1 tiêu chí chấp nhận đo được; từ mơ hồ trong từ điển "
        "(nhanh, dễ, phù hợp, thân thiện...) không kèm con số bị gắn cờ; > 10% F-item rớt → trả pack về người nộp. (N2)",
        "<b>Đổi spec giữa run</b>: pack vN+1 được diff theo điều khoản; theo vết điều khoản → test → unit, control plane hủy "
        "lease đúng các F-item bị chạm, tái dùng unit xanh có vết không đổi; ảnh hưởng > 30% F-item → lập lại kế hoạch toàn "
        "run. (I02)"],
        "rules": ["Pack có > 10% F-item không đo được thì không được nhận. (N2)",
                  "Sửa pack tại chỗ bị cấm; mọi thay đổi là vN+1 hoặc phụ lục vN.k. (I02, N3)"]},
    "g1": {"steps": [
        "<b>Checklist khe trống</b> bằng code cho mỗi F-item: input, output, lỗi, giới hạn / rỗng, đơn vị / múi giờ / làm "
        "tròn, quyền, lưu trữ. Khe không có câu trích → ASSUMED-n trong Sổ giả định. (I01)",
        "Giả định chạm tiền, quyền, xóa dữ liệu, giao diện ngoài → vào lượt hỏi người ở r5h; giả định khác ghi trên board và "
        "gói demo. (I01, I37)",
        "<b>Dò lại mâu thuẫn</b> cho các F-item mà bước so hai bản đã đổi nghĩa (ví dụ '30 ngày' → '30 ngày làm việc'). (R11)",
        "Mọi câu trả lời của người ở bước này cũng thành phụ lục vN.k như r5h. (N3)"],
        "rules": ["Mỗi F-item đủ 7 khe; khe trống không trích được thì phải là ASSUMED-n, không được im lặng. (I01)"]},
    "r5c": {"steps": [
        "<b>Độ phủ graph</b>: mỗi lần dò báo % entity bị chạm có ≥ 1 quy tắc hoặc test đã khóa trong graph; < 80% → nhãn "
        "UNSCANNED, các entity đó vào lượt hỏi người. (R10)",
        "<b>Bootstrap hệ thống cũ</b>: một lần cho mỗi hệ thống chưa từng ingest, trích quy tắc từ test và code hiện có vào "
        "graph với nhãn 'chưa xác minh'. (R10)",
        "<b>Ghi graph là cổng hoàn tất</b> ở cả 3 flow (h1, en16, bf13); job hằng đêm đếm test đã khóa không gắn quy tắc nào; "
        "> 0 thì lần dò kế tiếp không được trả 'không mâu thuẫn'. (R12)",
        "Tự thay thế quy tắc cũ chỉ được khi ngoài vùng tiền, quyền, xóa dữ liệu, giao diện ngoài; trong vùng đó luôn vào "
        "lượt hỏi người, kể cả khi spec ghi 'thay thế'. Mọi thay thế được liệt kê trong thông báo của run. (R13)"],
        "rules": ["Độ phủ < 80% không bao giờ được báo 'không mâu thuẫn'. (R10)",
                  "0 test khóa 'mồ côi' trước khi dò. (R12)"]},
    "r5h": {"steps": ["Hạn trả lời 2 ngày làm việc, quá hạn báo lên cấp trên của chủ sản phẩm; F-item giữ trạng thái chờ, "
                      "không tự chọn mặc định. (I01, N3)"]},
    "h1": {"steps": [
        "<b>Demo theo F-item</b>: F-item xanh trên QAS → gửi chủ nghiệp vụ link demo + danh sách ASSUMED của F-item đó; cửa "
        "sổ góp ý 48 giờ, góp ý đi vào đường đổi spec (vN+1). (I37)",
        "Run chỉ được đóng khi quy tắc mới đã ghi vào graph (cổng hoàn tất). (R12)"],
        "rules": ["Không có góp ý trong 48 giờ thì giữ nguyên; có góp ý thì thành Change Request. (I37)"]},
    # ── tests: holdout, integrity, flaky ────────────────────────────────────────
    "a3": {"steps": [
        "<b>Đọc câu gốc</b>: Test Author viết test từ các đoạn trích gốc, không từ bản tóm tắt của reader. (N4)",
        "<b>Bộ holdout</b>: một model khác nhà cung cấp viết thêm 20-30% test cho mỗi F-item; Builder và Fixer không bao "
        "giờ thấy bộ này; verifier và QAS chạy cả hai bộ. (N4, I23, R2)",
        "Mỗi assertion trỏ về quote_id hoặc ASSUMED-n; verifier loại assertion không truy được. (I01)"],
        "rules": ["Hiện xanh mà holdout đỏ = cờ gian lận cho unit đó. (I23, R2)",
                  "Đo độ đồng thuận giữa reader, Test Author, reviewer; đồng ý 100% trên mẫu 50 ý là báo động 'thiếu đa dạng'. (N4)"]},
    "g2": {"steps": [
        "<b>Burn-in</b>: test mới phải xanh / đỏ ổn định 10/10 lần chạy trước khi được dùng làm cổng. (I04)",
        "<b>Khóa hạ tầng test</b>: fixture, mock, snapshot, conftest / jest config được băm và khóa như file test. (I23)"],
        "rules": ["Test không ổn định 10/10 → trả Test Author. (I04)"]},
    "g3": {"steps": [
        "<b>Toàn vẹn test</b>: số test thu được ≥ số kỳ vọng theo bản đồ vết; 0 marker skip / only / xfail mới; coverage "
        "dòng đổi ≥ 70%; grep literal của test trong code chính; mutation test (Stryker, chế độ incremental, chỉ dòng đổi) "
        "≥ 60%. (I23, I24)",
        "<b>Bảo mật</b>: Semgrep / CodeQL trên diff + osv-scanner / npm audit; phát hiện mới mức high / critical → chặn và "
        "vào vòng sửa như fingerprint. (I10)",
        "<b>Dependency mới</b>: phải có trên registry nội bộ; nếu chưa có thì kiểm qua deps.dev: phát hành > 90 ngày, "
        "> 10k lượt tải / tuần, không gần tên (typo) với package phổ biến; không đạt → không cài, tạo câu hỏi kỹ thuật cho "
        "model phán xét chọn package thay thế. Lockfile có hash. (I14)",
        "<b>Secret</b>: gitleaks trước commit trong sandbox và lại ở verifier; dòng có secret → chặn. (I11)",
        "<b>Trùng lặp + độ phức tạp</b>: jscpd trên diff so với repo, khối trùng mới ≥ 25 dòng → fail kèm chỉ tới hàm đã có; "
        "hàm mới cyclomatic > 15 → fail. (I09)",
        "<b>Đường dẫn nhạy cảm</b>: diff chạm CI, pipeline, file cấu hình agent (AGENTS.md, CLAUDE.md, .cursorrules) luôn "
        "nằm ngoài claim → chặn; action CI phải pin theo SHA. (I13)"],
        "rules": ["Mutation score dòng đổi ≥ 60%, coverage dòng đổi ≥ 70%, 0 skip mới. (I23, I24)",
                  "0 phát hiện high / critical mới; 0 secret; 0 dependency chưa qua kiểm. (I10, I11, I14)",
                  "Các ngưỡng trên nằm trong registry guard, chỉ đọc với model phán xét, Distiller và pipeline agent. (R8)"]},
    "g5": {"steps": [
        "<b>Điểm chập chờn theo xác suất</b> (kiểu Meta PFS) thay cho đếm 1/3: test có điểm > ngưỡng mới vào cách ly. (I04)",
        "Test acceptance bị cách ly <b>không bao giờ</b> tính vào F-item xanh: F-item giữ màu vàng và có unit Fixer kèm SLA "
        "24 giờ. Test mới chập chờn trên đường code vừa đổi = bug, không phải flaky. (I04, R2)",
        "Chạy cả bộ holdout trên QAS. (I23, R2)"],
        "rules": ["Trần cách ly: ≤ 2% bộ test mỗi project và 0 test acceptance được tính xanh khi đang cách ly. (I04)"]},
    "c4": {"steps": ["Mỗi lần gộp chạy cả holdout của các F-item bị chạm. (I23)"]},
    # ── reproducibility ─────────────────────────────────────────────────────────
    "a1": {"steps": [
        "<b>Ghi để phát lại</b>: mọi input / output LLM được lưu theo hash (prompt, model snapshot, tham số) để replay khi "
        "điều tra. (I30)",
        "Điểm quyết định (so hai bản, phán xét, BLOCKED) phải cho cùng kết quả trên k = 2 mẫu; khác → coi như bất đồng. (I30)",
        "<b>Chữ chưa tin</b>: văn bản spec đi vào prompt trong khối đánh dấu là dữ liệu (spotlighting); reader không có "
        "tool ghi, chỉ trả JSON; agent có quyền (planner, builder) chỉ thấy JSON đã kiểm, không thấy văn bản gốc thô (kiểu "
        "dual-LLM / CaMeL). (I12)"],
        "rules": ["Không replay được thì quyết định đó không được dùng làm tiền lệ cho model phán xét. (I30)"]},
    "p1": {"steps": [
        "<b>Gỡ chữ ẩn</b>: bỏ chữ cỡ 0, trắng trên trắng, comment, metadata, ký tự Unicode tag / bidi / zero-width; gắn cờ "
        "câu nói với agent ('ignore', 'you are', 'also add'). (I12)",
        "Yêu cầu tạo năng lực nhạy cảm (bỏ qua auth, endpoint không auth, host egress mới, xử lý credential, vai trò admin) "
        "luôn vào lượt hỏi người ở mục 3. (I12)"],
        "rules": ["Tài liệu có chữ ẩn hoặc câu nói với agent → gỡ, ghi lại và báo người nộp. (I12)"]},
    # ── security of the sandbox and data ───────────────────────────────────────
    "a5": {"steps": [
        "<b>Proxy công cụ</b> chặn DROP / TRUNCATE, rm -rf ngoài worktree, force-push, xóa nhánh. (I20)",
        "Builder chỉ nạp định nghĩa agent đã ký từ registry; file cấu hình agent trong repo bị bỏ qua và quét ký tự ẩn. (I13)",
        "Sandbox nhận credential ngắn hạn, phạm vi hẹp, có cài canary token; canary bị dùng → cảnh báo P0. (I11)"],
        "rules": ["0 lệnh phá hủy đi qua proxy. (I20)"]},
    "p2": {"steps": [
        "Snapshot dữ liệu QAS trước mỗi chuyến deploy; diễn tập khôi phục hằng tuần. (I20)",
        "Mọi transcript, event và dữ liệu ghi vào RAG System đi qua bộ che secret trước khi lưu. (I11)"],
        "rules": ["Khôi phục thử thất bại → khóa deploy tới khi sửa. (I20)"]},
    "e1": {"steps": ["Che secret trên event trước khi lưu (cùng bộ quét với gitleaks). (I11)"]},
    # ── judge model safety (sections 6 and 8) ───────────────────────────────────
    "d8": {"steps": [
        "<b>Cổng trích dẫn</b>: mỗi quyết định phải trích ≥ 1 quote_id mà đoạn gốc chứa đúng dữ kiện quyết định (kiểm chuỗi "
        "như r7); không trích được hoặc chỉ dựa vào giả định → tự chuyển về mục 3 cho người. (R1)",
        "<b>Chấm bằng holdout</b>: quyết định chỉ được tính 'đúng' khi cả bộ hiện và bộ holdout xanh; hiện xanh mà holdout "
        "đỏ = quyết định sai. (R2)",
        "<b>Khác nhà cung cấp</b>: model phán xét khác nhà cung cấp với builder và reviewer khi có thể; một model thứ hai "
        "kiểm chéo 10% quyết định (không chặn); ca bất đồng không vào lịch sử. (R9)"],
        "rules": ["100% quyết định có trích dẫn hợp lệ. (R1)",
                  "Bất đồng giữa hai model phán xét > 20% trong một tháng → đổi model phán xét qua canary. (R9)",
                  "Không được ghi vào registry guard. (R8)"]},
    "e5": {"steps": [
        "Cùng cổng trích dẫn và chấm bằng holdout như d8. (R1, R2)",
        "Model phán xét khác nhà cung cấp với Distiller; đo độ chính xác hằng tuần khi có ≥ 20 quyết định. (R9)"],
        "rules": ["Quyết định không trích được bằng chứng thì không được bật bài học. (R1)"]},
    "e8": {"steps": [
        "<b>Registry guard</b>: danh sách cố định các tham số an toàn (ngưỡng ở g3, g5, quyền sandbox) kèm chiều an toàn; "
        "model phán xét, Distiller và pipeline phiên bản agent không ghi được. (R8)"],
        "rules": ["Luật cứng mới chỉ được siết, không được nới, tham số trong registry. (R8)"]},
    "k3": {"steps": [
        "Eval có bộ đối kháng: phiên bản prompt / tool mới làm rơi một điều khoản an toàn đã đăng ký → trượt. (R8)"],
        "rules": ["0 điều khoản an toàn bị rơi so với phiên bản đang chạy. (R8)"]},
    # ── code quality ────────────────────────────────────────────────────────────
    "a4": {"steps": [
        "Phát unit tiện ích chung trước khi các unit dùng nó; cứ 10 unit lên lịch 1 unit refactor có claim refactor riêng. (I09)"],
        "rules": ["Khối trùng do jscpd phát hiện → unit refactor kế tiếp phải gom. (I09)"]},
    # ── enhancement / bug flows ────────────────────────────────────────────────
    "en0": {"steps": ["CR đến giữa lúc run khác đang chạy trên cùng vùng → dùng đường đổi spec giữa run như h0. (I02)"]},
    "en3": {"steps": ["Chạy cùng cổng độ phủ graph như r5c; vùng chưa có graph → bootstrap trước khi dò. (R10)"]},
    "bf13": {"steps": ["Ghi quy tắc đã sửa vào graph là cổng hoàn tất của bug fix. (R12)"]},
}

# issue id -> (new status code IN/PA, where in the design now - Vietnamese, one sentence)
STATUS_UPDATE = {
    "I01": ("IN", "g1: checklist 7 khe + Sổ giả định; a3: assertion truy về quote / ASSUMED; r5h: hỏi người có hạn."),
    "I02": ("IN", "h0 / en0: diff vN+1 theo điều khoản, hủy lease F-item bị chạm, > 30% → lập lại kế hoạch."),
    "N2": ("IN", "h0: cổng đo được, > 10% F-item không đo được → trả pack."),
    "N3": ("IN", "g1 + r5h: mọi câu trả lời của người thành phụ lục vN.k."),
    "N4": ("IN", "a3: Test Author đọc câu gốc + holdout khác nhà cung cấp + đo độ đồng thuận."),
    "I37": ("IN", "h1: demo theo F-item kèm ASSUMED, góp ý 48 giờ thành Change Request."),
    "I04": ("IN", "g2 burn-in 10/10; g5 điểm chập chờn theo xác suất, test cách ly không tính xanh, trần 2%."),
    "I23": ("IN", "a3 holdout; g2 khóa fixture / mock; g3 mutation ≥ 60%, grep literal; g5 / c4 chạy holdout."),
    "I24": ("IN", "g3: đếm test thu được, 0 skip mới, coverage dòng đổi ≥ 70%."),
    "I09": ("IN", "g3 jscpd ≥ 25 dòng + cyclomatic > 15; a4 unit tiện ích trước + 1 unit refactor / 10 unit."),
    "I10": ("IN", "g3: Semgrep / CodeQL + osv-scanner, high / critical mới → chặn."),
    "I30": ("IN", "a1: ghi để replay, quyết định ổn định trên k = 2 mẫu."),
    "I11": ("IN", "g3 / a5 gitleaks + credential ngắn hạn + canary token; p2 / e1 che secret trước khi lưu."),
    "I12": ("PA", "p1 gỡ chữ ẩn; a1 spotlighting + tách model đọc / model có quyền; yêu cầu nhạy cảm hỏi người. Chưa có bộ phân loại injection ở runtime."),
    "I13": ("IN", "a5 chỉ nạp định nghĩa đã ký, bỏ qua cấu hình agent trong repo; g3 chặn diff chạm CI / cấu hình, pin SHA."),
    "I14": ("IN", "g3: registry nội bộ + kiểm deps.dev (> 90 ngày, > 10k tải / tuần, không gần tên), lockfile hash."),
    "I20": ("IN", "a5 proxy chặn lệnh phá hủy; p2 snapshot trước deploy + diễn tập khôi phục hằng tuần."),
}

# extra tables shown in a new section 'Gói tăng cứng'
TABLES = [
    ("Gói toàn vẹn test (để model phán xét có sự thật đáng tin)", ["Cơ chế", "Làm gì", "Ngưỡng", "Vấn đề"], [
        ["Bộ holdout", "Model khác nhà cung cấp viết thêm test; Builder / Fixer không thấy; verifier, QAS và việc chấm "
         "quyết định đều chạy", "20-30% số test mỗi F-item; hiện xanh + holdout đỏ = gian lận", "I23, N4, R2"],
        ["Khóa hạ tầng test", "Fixture, mock, snapshot, cấu hình test băm và khóa như test", "0 thay đổi trong diff", "I23"],
        ["Đếm test thật", "So số test thu được với bản đồ vết; chặn skip / only / xfail mới", "≥ kỳ vọng; 0 skip mới", "I24"],
        ["Mutation test", "Stryker chế độ incremental, chỉ trên dòng đổi", "≥ 60%", "I23"],
        ["Coverage dòng đổi", "Đo trên dòng mới / sửa", "≥ 70%", "I24"],
        ["Burn-in test mới", "Chạy 10 lần trước khi dùng làm cổng", "10/10 ổn định", "I04"],
        ["Cách ly test chập chờn", "Điểm chập chờn theo xác suất; test cách ly không tính xanh", "≤ 2% bộ test; 0 acceptance tính xanh",
         "I04, R2"],
    ]),
    ("Cổng an ninh trong verifier và sandbox", ["Cơ chế", "Làm gì", "Ngưỡng", "Vấn đề"], [
        ["SAST + SCA", "Semgrep / CodeQL trên diff; osv-scanner / npm audit", "0 high / critical mới", "I10"],
        ["Dependency mới", "Registry nội bộ, kiểm deps.dev, lockfile hash", "> 90 ngày, > 10k tải / tuần, không gần tên", "I14"],
        ["Secret", "gitleaks trước commit + verifier; che secret trước khi lưu event / RAG System; canary token", "0 secret", "I11"],
        ["Chữ chưa tin", "Gỡ chữ ẩn; spotlighting; model đọc không có tool, model có quyền chỉ thấy JSON",
         "yêu cầu nhạy cảm → người", "I12"],
        ["Cấu hình agent + CI", "Chỉ định nghĩa đã ký; bỏ qua file cấu hình trong repo; pin action theo SHA", "0 diff chạm CI", "I13"],
        ["Lệnh phá hủy", "Proxy chặn; snapshot trước deploy; diễn tập khôi phục", "hằng tuần", "I20"],
        ["Registry guard", "Ngưỡng an toàn chỉ đọc với phán xét / Distiller; eval đối kháng ở k3", "chỉ được siết", "R8"],
    ]),
    ("Cổng chất lượng spec và model phán xét", ["Cơ chế", "Làm gì", "Ngưỡng", "Vấn đề"], [
        ["Cổng đo được", "Mỗi F-item có tiêu chí đo được; gắn cờ từ mơ hồ", "≤ 10% F-item rớt", "N2"],
        ["Khe trống + Sổ giả định", "7 khe mỗi F-item; khe trống thành ASSUMED-n", "giả định nhạy cảm → người", "I01"],
        ["Độ phủ graph", "Báo % entity có quy tắc; bootstrap hệ thống cũ; ghi graph là cổng hoàn tất",
         "≥ 80% hoặc UNSCANNED; 0 test mồ côi", "R10, R12"],
        ["Cổng trích dẫn", "Quyết định của model phán xét phải trích đúng câu gốc", "100%; không có → mục 3", "R1"],
        ["Đa dạng model phán xét", "Khác nhà cung cấp; kiểm chéo 10%", "bất đồng ≤ 20% / tháng", "R9"],
    ]),
]

SOURCES = [
    "https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view",
    "https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/",
    "https://simonw.substack.com/p/camel-offers-a-promising-new-direction",
    "https://www.infoq.com/news/2025/04/deepmind-camel-promt-injection",
    "https://docs.deps.dev/api/v3/",
    "https://arxiv.org/html/2406.07791v9",
    "https://metr.org/blog/2025-06-05-recent-reward-hacking/",
    "https://arxiv.org/html/2510.20270v1",
    "https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/",
]
