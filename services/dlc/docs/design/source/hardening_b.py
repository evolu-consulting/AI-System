"""Hardening (part B): folds missing fixes into the design. Applied at render time."""

ADD = {
    # ── integration, environments, deploy ─────────────────────────────────
    "c4": {
        "steps": [
            "<b>Chạy mọi test acceptance ở mỗi lần gộp</b>, kể cả test còn đỏ theo kế hoạch; chặn khi một test đã xanh bị "
            "đỏ lại (I03)",
            "<b>Gộp theo lô khi hàng dài:</b> hàng đợi > 5 unit thì gộp thành lô (tối đa 8 unit, chờ tối đa 10 phút); lô "
            "đỏ thì gỡ unit gây lỗi ra (chia đôi lô tới khi tìm ra), các unit còn lại đi tiếp (I03, R5)",
            "<b>Xung đột ngữ nghĩa sinh unit Fixer riêng</b>, claim cả hai phía; không giao cho 'unit sau' (I03)",
            "Mỗi unit vào hàng mang <b>fencing epoch</b> của lease; epoch cũ bị từ chối (I15)",
        ],
        "rules": [
            "0 test đã xanh bị đỏ lại sau khi gộp; lô đỏ phải tìm ra unit gây lỗi trong ≤ 3 lần chia đôi (I03, R5)",
        ],
    },
    "U1": {
        "steps": [
            "<b>Registry contract liên project</b> (kiểu Pact): bên dùng API viết contract test, lưu ở registry có version; "
            "provider đổi API thì verifier chạy contract của mọi bên dùng (I06)",
            "Trước khi deploy: kiểm 'can-i-deploy' giữa phiên bản provider và mọi bên dùng đang chạy trên QAS (I06)",
        ],
        "rules": ["Thay đổi phá vỡ contract của bất kỳ bên dùng nào → chặn, gửi model phán xét kèm danh sách bên dùng (I06)"],
    },
    "U2": {
        "steps": [
            "<b>Migration chia 2 chuyến:</b> 'expand' (thêm cột / bảng, không mất dữ liệu) đi chuyến trước; 'contract' (xóa / "
            "đổi tên) đi chuyến sau, khi không còn code dùng phần cũ. Trên HANA dùng hdbmigrationtable để kiểm soát (R17)",
            "up → test → down → up chạy trên <b>snapshot cỡ QAS đã che dữ liệu</b>, không chỉ DB tạm (R17)",
        ],
        "rules": ["Linter từ chối chuyến nào vừa có code vừa có thay đổi schema không tương thích ngược (R17)"],
    },
    "p2": {
        "steps": [
            "<b>Deploy có khóa:</b> khóa = (run, digest artifact); deploy trùng khóa → bỏ qua, không chạy migration / seed lần "
            "hai (I16)",
            "<b>Config nằm trong artifact:</b> biến môi trường, binding, feature flag là config-as-code đi cùng digest; "
            "rollback trả cả code + config + snapshot DB (I35)",
            "<b>QAS chia vùng theo run:</b> mỗi run một schema / tiền tố tenant; khôi phục snapshot fixture trước mỗi lần "
            "chạy test; checksum dữ liệu lệch → lỗi INFRA, không phải lỗi code (I05)",
            "<b>Khung đầu tiên sau lần gộp đầu</b> luôn chở walking skeleton lên QAS; mọi khung sau đều chạy smoke + "
            "acceptance các F-item đã xong, nên điểm tích hợp thật cách nhau ≤ 1 khung (I08)",
            "<b>Preview giống QAS:</b> preview dựng từ đúng artifact + config-as-code, dữ liệu từ snapshot QAS đã che; mỗi "
            "đêm chạy bộ smoke QAS trên một preview (R4)",
            "<b>Kiểm trên preview trước:</b> thay đổi của Fixer hay quyết định của model phán xét phải đỏ → xanh trên "
            "preview rồi mới được lên chuyến; QAS chỉ để xác nhận (R3)",
            "<b>Chuyến hỏng không chặn cả chuyến:</b> smoke fail → chia đôi theo F-item trên preview, cắt lại chuyến không "
            "có F-item lỗi, thử lại trong 30 phút cùng khung (R18)",
            "<b>UAT không bị đổi bản dưới chân:</b> UAT chạy trên môi trường ghim phiên bản, hoặc project khai báo cửa sổ UAT "
            "thì các chuyến bị đóng băng; chỉ urgent do người gắn được phá (R16)",
            "<b>Khung giờ đặt theo QAS, không theo project:</b> nhiều project dùng chung một QAS thì chia slot có trọng số "
            "trong cùng khung (R21)",
            "<b>Urgent chỉ do danh tính người:</b> token của agent không gắn được urgent; cảnh báo khi urgent > 20% số "
            "deploy / tuần của project (R19)",
            "Cờ cấu hình rollout dùng blue/green hoặc rolling của Cloud Foundry (cf push --strategy rolling, có thể canary "
            "từng bước); env / binding không tự quay lại khi hủy deploy nên phải nằm trong artifact (I35)",
        ],
        "rules": [
            "Tỉ lệ 'xanh trên preview, đỏ trên QAS' ≤ 10% mỗi tuần; vượt → báo INFRA (R4)",
            "Vòng Fixer trung vị < 4 giờ nhờ kiểm trên preview (R3)",
            "Smoke không qua trong 5 phút → giữ bản cũ, khôi phục code + config + DB snapshot (I35)",
        ],
    },
    "g5": {
        "steps": [
            "Trước mỗi lần chạy: khôi phục snapshot fixture của run, kiểm checksum; lệch → INFRA (I05)",
            "<b>Quy lỗi cho đúng chủ:</b> F-item đỏ chỉ được tính cho thay đổi có test fail truy về claim của nó; chuyến có "
            "nhiều thay đổi thì chia đôi trên preview trước khi gán (R5)",
        ],
        "rules": ["Kết quả không quy được cho ai → gắn 'không quy được', không tính vào lịch sử hay độ chính xác (R5)"],
    },
    "c1": {
        "steps": [
            "<b>Cổng sẵn sàng môi trường cho cả 3 flow:</b> trước khi nhận run, nền tảng build image đã pin và phải qua build "
            "sạch + bộ test hiện có + một test đỏ mẫu (I29)",
        ],
        "rules": ["Không qua cổng sẵn sàng → run bị chặn mã INFRA, không agent nào khởi động (I29)"],
    },
    "a4": {
        "steps": [
            "<b>Feature flag có chủ và hạn:</b> mọi flag mới khai báo trong registry flag (chủ, ngày hết hạn ≤ 30 ngày); flag "
            "hết hạn → Planner tạo unit gỡ flag (I21)",
            "<b>Lockfile đóng băng theo run:</b> đổi dependency chỉ trong unit dependency riêng có claim lockfile; nâng cấp "
            "chạy theo nhóm ngoài run feature, tối đa 3 đang mở mỗi project (I39)",
            "<b>Decision record:</b> lựa chọn mà spec / contract không nói tới (tên field, định dạng, múi giờ) được Builder "
            "ghi (khóa, giá trị); control plane so khóa giữa các unit, trùng khóa khác giá trị → Architect chốt (I26)",
        ],
        "rules": ["Không tái dùng tên flag đã gỡ; 0 flag quá hạn khi bắt đầu run mới (I21)"],
    },
    "g3": {
        "steps": [
            "Từ chối flag mới không có chủ / hạn trong registry (I21)",
            "Từ chối diff đổi lockfile nếu unit không giữ claim lockfile (I39)",
            "Từ chối diff có lựa chọn ngầm (giá trị cấu hình / định dạng mới) mà không có decision record (I26)",
        ],
        "rules": ["Mọi kiểm này chạy bằng code; không cần model (I21, I39, I26)"],
    },
    # ── control plane reliability ─────────────────────────────────────────
    "c3": {
        "steps": [
            "<b>Fencing epoch:</b> mỗi lần cấp lease tăng epoch; push, nộp verifier, vào hàng gộp, ghi RAG System đều mang epoch; "
            "server từ chối epoch cũ hơn epoch đã thấy; tên nhánh chứa epoch (I15)",
            "<b>Timebox theo giờ thật</b> = 2 lần ước lượng của unit; hết giờ → dừng phiên, coi như BLOCKED / ENV, không "
            "tính là thất bại của agent (I28)",
            "<b>Nhật ký lần thử do control plane ghi</b> (fingerprint, cách đã thử, kết quả) đi kèm mỗi checkpoint; agent "
            "đọc được nhưng không sửa được (I25)",
        ],
        "rules": ["0 lần ghi được chấp nhận với epoch cũ (kiểm trong chaos test) (I15)"],
    },
    "a5": {
        "steps": [
            "<b>Tool BLOCKED</b> với mã lý do (MISSING_INFO, IMPOSSIBLE, ENV): kết thúc phiên, không tính thất bại; "
            "MISSING_INFO về nghĩa yêu cầu → người §3, IMPOSSIBLE → model phán xét §6, ENV → INFRA (I28)",
            "Ghi decision record cho mọi lựa chọn spec / contract không nói tới (I26)",
        ],
        "rules": ["BLOCKED trùng lý do trong cùng run gộp thành một ca (I28)"],
    },
    "d5": {
        "steps": [
            "Fixer nhận <b>nhật ký lần thử do control plane ghi</b>, không nhận tóm tắt tự viết của agent trước, nên không "
            "lặp lại cách đã hỏng (I25)",
        ],
        "rules": ["Cách sửa trùng fingerprint một cách đã thử → bị từ chối trước khi chạy (I25)"],
    },
    "t1": {
        "steps": [
            "<b>Chuyển trạng thái idempotent có khóa</b> (run, unit, epoch, trạng thái đích); gửi lại hai lần không đổi kết "
            "quả (N1)",
            "<b>Reconciler mỗi 5 phút</b> so git ref, lease, hàng gộp, trạng thái QAS với trạng thái chiếu từ event; lệch → "
            "đóng băng run đó, báo INFRA (N1)",
            "<b>Control plane là một sản phẩm:</b> có người / nhóm chủ, SLO (sẵn sàng ≥ 99,5% giờ làm việc, độ trễ giao "
            "việc p95 < 30 giây), runbook cho mỗi loại sự cố (I38)",
            "<b>Chaos suite trong CI</b>, phải xanh trước mọi run tự động: giết builder giữa lúc push, lease hết hạn giữa "
            "lúc ghi, bão 429 từ provider, QAS sập, event trùng, replay từ snapshot (I38, N1)",
        ],
        "rules": ["Chaos suite đỏ → không mở run tự động mới (I38)", "Replay từ snapshot cho ra đúng trạng thái hiện tại (N1)"],
    },
    "t5": {
        "steps": [
            "<b>Outbox:</b> thông báo, ticket, tin nhắn ra ngoài được ghi vào bảng outbox trong cùng giao dịch với thay đổi "
            "trạng thái, rồi một tiến trình riêng gửi đi; bên nhận bỏ qua message id đã xử lý (I16)",
        ],
        "rules": ["Mọi tác động ra ngoài có khóa idempotency; gửi trùng → 0 tác động thêm (I16)"],
    },
    "e1": {
        "steps": [
            "<b>Trường bắt buộc trên mọi event:</b> run, unit, phiên, lần thử, epoch, phiên bản agent, id snapshot model, "
            "id bài học đang bật, hash spec, chi phí (I18)",
            "Đặt tên span theo quy ước OpenTelemetry GenAI (gọi agent, gọi model, chạy tool) để xem được chuỗi gọi lồng nhau "
            "và chi phí theo F-item; mặc định chỉ ghi metadata, nội dung chỉ ghi khi bật riêng (I18)",
        ],
        "rules": ["Event thiếu trường bắt buộc bị control plane từ chối (I18)"],
    },
    # ── judge, learning loop ─────────────────────────────────────────────
    "d8": {
        "steps": [
            "<b>Lịch sử phán xét chỉ do code ghi</b>, dạng bản ghi có cấu trúc (đặc điểm ca, phương án, model + phiên bản "
            "phán xét, kết quả, cờ quy được); không chép chữ tự do từ bằng chứng vào lịch sử (R6)",
            "Chỉ tính kết quả khi test fail truy về claim của quyết định; flaky, INFRA, chuyến gộp chưa chia → 'không quy "
            "được', loại khỏi lịch sử (R5)",
            "<b>'Không có trong spec' chia 3 loại:</b> bị cấm (popup tự bịa → gỡ), thuộc quy ước chung đã chốt ở ns7 (toast "
            "lỗi, spinner → giữ), hoặc spec thật sự thiếu → về người §3 (R20)",
        ],
        "rules": ["Lịch sử có version theo model phán xét; bản ghi cũ hơn 8 tuần hoặc của phiên bản cũ giảm trọng số còn 0,5 (R6)"],
    },
    "e3": {
        "steps": [
            "<b>Bài học có nguồn gốc:</b> mỗi bài học lưu run, unit, event đã sinh ra nó; chỉ chắt từ unit đã qua QAS + "
            "review và không có cờ gian lận (I22)",
            "Bài học có <b>TTL 90 ngày</b>; hết hạn mà không được chấm lại thì tự tắt (I22)",
        ],
        "rules": ["Bài học liên project chỉ khi ≥ 3 project độc lập ủng hộ; quét câu mệnh lệnh / tên guard trước khi lưu (I22)"],
    },
    "e4": {
        "steps": [
            "<b>Holdout riêng ngoài RAG System:</b> bộ task chấm lấy từ project mới mỗi quý, không lưu trong RAG System, có chuỗi canary để "
            "phát hiện rò rỉ; bài học không được chấm trên task mà nó được chắt ra (I32)",
        ],
        "rules": ["Chuỗi canary xuất hiện trong output của agent → bộ holdout coi như lộ, thay bộ mới (I32)"],
    },
    "e5": {
        "steps": [
            "<b>Chấm bằng kết quả, không bằng số mã lỗi:</b> chỉ số hẹn của mỗi quyết định là QAS xanh lần đầu, lỗi lọt "
            "UAT, holdout pass; số mã lỗi chỉ để chẩn đoán (N5)",
        ],
        "rules": ["Quyết định có chỉ số hẹn là 'số mã lỗi giảm' bị từ chối (N5)"],
    },
    "e7": {
        "steps": [
            "<b>Chia ngẫu nhiên 50/50:</b> với mỗi bài học mới, một nửa unit khớp khóa được nhận, một nửa không; so hai nhánh "
            "trên chỉ số kết quả, để tránh 'lỗi tự giảm' bị tính là bài học đúng (R7)",
        ],
        "rules": ["Giữ bài học chỉ khi nhánh có bài học hơn nhánh không có, ≥ 30 unit mỗi nhánh (R7, N5)"],
    },
    "k7": {
        "steps": [
            "<b>Pin snapshot model</b>, không pin alias; eval canary hằng đêm cho mỗi cặp (model, vai trò) trên bộ holdout "
            "(I31)",
        ],
        "rules": ["Điểm eval đêm tụt > 5% so với nền → đóng băng phiên mới trên model đó, chuyển model dự phòng đã qua eval (I31)"],
    },
    # ── humans: escalation, oversight, outcome metrics ────────────────────
    "r5h": {
        "steps": [
            "<b>Hạn trả lời 2 ngày làm việc;</b> quá hạn → báo lên trưởng nhóm sản phẩm. Không tự chọn mặc định; F-item vẫn "
            "chờ (R14)",
            "Gói câu hỏi theo schema: một quyết định, 2-4 phương án, phương án đề xuất, tác động, bằng chứng; thiếu trường "
            "→ code trả lại (I07)",
        ],
        "rules": ["≤ 3 câu hỏi mở mỗi project; vượt → tạm dừng F-item ưu tiên thấp nhất, không gửi thêm (I07)"],
    },
    "h1": {
        "steps": [
            "<b>Đo chất lượng duyệt của người:</b> % câu trả lời < 15 giây; cài 1 / 20 câu hỏi có sẵn đáp án sai để đo tỉ "
            "lệ người bắt được (I07, I33)",
            "<b>Giữ kỹ năng người:</b> mỗi run chọn ngẫu nhiên 5% unit đã gộp cho người review sâu, có chấm điểm; luân phiên "
            "người (không ai duyệt quá 4 tuần liền một mảng); dãy duyệt liên tiếp dài bị kiểm lại (I33)",
            "<b>Chỉ số kết quả theo F-item:</b> thời gian từ chốt tài liệu tới QAS xanh, lỗi lọt UAT / production, tỉ lệ làm "
            "lại (rework rate, chỉ số thứ 5 của DORA), phút công người, chi phí; so với nền lịch sử trước khi mở rộng (I34)",
        ],
        "rules": [
            "Tỉ lệ bắt được câu sai cài sẵn < 80% → người đó tạm nghỉ duyệt, ôn lại (I33)",
            "Không mở rộng sang project mới khi lỗi lọt UAT mỗi F-item cao hơn nền (I34)",
        ],
    },
    "l1": {
        "steps": ["Báo cáo tuần: chỉ số kết quả (I34) + độ chính xác model phán xét + tỉ lệ 'không quy được' (R5)"],
        "rules": ["Tỉ lệ 'không quy được' > 30% → xem lại cách chia chuyến (R5)"],
    },
    "g4": {
        "steps": ["Lỗi nặng 2 vòng → <b>model phán xét §6</b> (không gọi người) (R15)"],
        "rules": ["Đích escalate theo bảng đích escalate (R15)"],
    },
    "c2": {
        "steps": ["Graph sai sau 2 lần lập lại kế hoạch → <b>model phán xét §6</b> (R15)"],
        "rules": ["Đích escalate theo bảng đích escalate (R15)"],
    },
    "t10": {
        "steps": ["Unit bị cách ly 3 lần → <b>model phán xét §6</b>; nếu nguyên nhân là hạ tầng → INFRA (R15)"],
        "rules": ["Đích escalate theo bảng đích escalate (R15)"],
    },
    "g1": {
        "steps": ["Hai lần đọc vẫn lệch sau 2 lần đọc lại → <b>người §3</b> (đây là nghĩa yêu cầu) (R15)"],
        "rules": ["Đích escalate theo bảng đích escalate (R15)"],
    },
}

STATUS_UPDATE = {
    "I03": ("IN", "c4: chạy mọi acceptance mỗi lần gộp, gộp theo lô + gỡ unit lỗi, Fixer riêng cho xung đột."),
    "I05": ("IN", "p2 / g5: vùng QAS theo run, khôi phục snapshot fixture, checksum → INFRA."),
    "I06": ("IN", "U1: registry contract liên project, can-i-deploy trước deploy."),
    "I08": ("IN", "p2: khung đầu tiên chở skeleton; mọi khung chạy smoke + acceptance F-item đã xong."),
    "I35": ("IN", "p2: config-as-code trong artifact, rollback code + config + DB, smoke 5 phút."),
    "I29": ("IN", "c1: cổng sẵn sàng môi trường cho cả 3 flow."),
    "I21": ("IN", "a4 / g3: registry flag có chủ + hạn ≤ 30 ngày, unit gỡ flag, verifier từ chối flag không hạn."),
    "I39": ("IN", "a4 / g3: lockfile đóng băng theo run, unit dependency riêng, tối đa 3 nâng cấp mở."),
    "I15": ("IN", "c3 / c4: fencing epoch trên push, verifier, hàng gộp, ghi RAG System."),
    "I16": ("IN", "p2 / t5: deploy có khóa (run, digest), outbox cho tác động ra ngoài."),
    "I18": ("IN", "e1: trường bắt buộc, span theo OTel GenAI, từ chối event thiếu trường."),
    "I25": ("IN", "c3 / d5: nhật ký lần thử do control plane ghi, agent không sửa được."),
    "I26": ("IN", "a4 / a5 / g3: decision record, so khóa giữa unit, Architect chốt."),
    "I28": ("IN", "a5 / c3: tool BLOCKED có mã lý do, timebox 2 lần ước lượng."),
    "N1": ("IN", "t1: chuyển trạng thái idempotent, reconciler 5 phút, replay trong chaos suite."),
    "I38": ("IN", "t1: chủ, SLO, runbook, chaos suite phải xanh trước run tự động."),
    "I22": ("IN", "e3: nguồn gốc, TTL 90 ngày, ≥ 3 project, quét câu mệnh lệnh."),
    "I32": ("IN", "e4: holdout ngoài RAG System làm mới mỗi quý, chuỗi canary, loại theo nguồn gốc."),
    "I31": ("IN", "k7: pin snapshot, eval đêm, tụt > 5% → đóng băng."),
    "N5": ("IN", "e5 / e7: chấm bằng kết quả, chia ngẫu nhiên 50/50, ≥ 30 unit mỗi nhánh."),
    "I07": ("IN", "r5h / h1: schema gói, ≤ 3 câu hỏi mở, đo duyệt < 15 giây, câu sai cài sẵn."),
    "I33": ("PA", "h1: review sâu ngẫu nhiên 5%, luân phiên, câu sai cài sẵn; nhưng §6 / §8 không có người nên kỹ năng "
                  "vẫn có thể mai một ở mảng đó."),
    "I34": ("IN", "h1 / l1: chỉ số kết quả theo F-item (lead time, lỗi lọt, rework rate, phút công, chi phí) so với nền."),
}

TABLES = [
    ("Bảng đích escalate: mỗi điểm escalate gửi về đúng một nơi (R15)",
     ["Điểm escalate", "Khi nào", "Đích", "Ghi chú"],
     [
         ["g1 / r8 So hai bản tóm tắt", "Vẫn lệch sau 2 lần đọc lại", "Người §3", "Nghĩa yêu cầu"],
         ["r5c / r5h Dò chỗ trái ngược", "Trái ngược, không có câu thay thế rõ", "Người §3", "Hạn 2 ngày làm việc (R14)"],
         ["Sổ giả định (I01)", "Giả định về tiền, quyền, xóa dữ liệu, giao diện ngoài", "Người §3", "Gom một lượt hỏi"],
         ["a5 BLOCKED", "MISSING_INFO về nghĩa yêu cầu", "Người §3", ""],
         ["a5 BLOCKED", "IMPOSSIBLE", "Model phán xét §6", ""],
         ["a5 BLOCKED / c3 timebox", "ENV", "INFRA on-call", ""],
         ["c2 Soát bảng chia việc", "Graph sai sau 2 lần lập lại", "Model phán xét §6", ""],
         ["g3 / d6 Thang sửa", "Hết thang (đổi model, tách unit, reset)", "Model phán xét §6 (d8)", ""],
         ["g4 Người ngoài đọc lại code", "Lỗi nặng 2 vòng", "Model phán xét §6", ""],
         ["d8 Model phán xét", "Quyết định không trích được câu gốc / spec thật sự thiếu", "Người §3", "Cổng trích dẫn"],
         ["d8 Model phán xét", "Chọn lại 3 lần vẫn sai", "Không gọi ai: thẻ đỏ trên board", "F-item dừng"],
         ["t4 / I27 Ping-pong giữa Fixer", "Cùng test đổi xanh / đỏ > 2 lần", "Model phán xét §6", "Run bị đóng băng"],
         ["t10 Người canh", "Unit bị cách ly 3 lần", "Model phán xét §6 (INFRA nếu do hạ tầng)", ""],
         ["g5 Chạy test QAS", "> 2 test flaky", "Model phán xét §6", "Quyết cách xử lý test"],
         ["g5 Chạy test QAS", "QAS sập > 30 phút / checksum lệch", "INFRA on-call", ""],
         ["p2 Deploy", "Lỗi sau rollback + 1 lần thử", "INFRA on-call", ""],
         ["c1 Nhận việc", "Hết quota / cổng sẵn sàng không qua", "INFRA on-call", "Thẻ vàng 'chờ tài nguyên'"],
         ["t1 Reconciler", "Trạng thái lệch", "INFRA on-call", "Run bị đóng băng"],
         ["I11 Canary token", "Token mồi bị dùng", "INFRA on-call (P0)", ""],
         ["bf3 / bf5 Bug fix", "Repro sai / không có bằng chứng nguyên nhân", "Model phán xét §6", ""],
         ["bf0 Bug fix", "Ticket mơ hồ về hành vi mong đợi", "Người §3", ""],
         ["e5 / e8 Vòng học", "Chốt nguyên nhân, luật cứng", "Model phán xét §8", ""],
         ["§1 'F-item đỏ quá 15 phút'", "-", "Bỏ: chỉ hiện trên board, không gọi ai", "Thay bằng các dòng trên"],
     ]),
    ("Vệ sinh deploy và vận hành",
     ["Cơ chế", "Luật", "Ngưỡng"],
     [
         ["Deploy có khóa (run, digest)", "Trùng khóa → không làm gì (I16)", "0 migration / seed chạy hai lần"],
         ["Config-as-code trong artifact", "Rollback code + config + DB snapshot (I35)", "smoke 5 phút"],
         ["Vùng QAS theo run + snapshot fixture", "Checksum lệch → INFRA (I05)", "mỗi lần chạy test"],
         ["Preview giống QAS", "Cùng artifact + config, snapshot QAS đã che (R4)", "lệch ≤ 10% / tuần"],
         ["Kiểm trên preview trước", "Fixer / quyết định đỏ → xanh trên preview rồi mới lên chuyến (R3)", "vòng Fixer < 4 giờ"],
         ["Migration 2 chuyến", "expand trước, contract sau (R17)", "0 chuyến trộn"],
         ["Cắt lại chuyến hỏng", "Chia đôi theo F-item, bỏ phần lỗi (R18)", "≤ 30 phút"],
         ["UAT ghim / đóng băng", "Chuyến không đổi bản UAT (R16)", "chỉ urgent phá được"],
         ["Urgent", "Chỉ danh tính người gắn được (R19)", "cảnh báo > 20% deploy / tuần"],
         ["Khung giờ theo QAS", "Chia slot có trọng số giữa project (R21)", "-"],
     ]),
    ("Chấm vòng học và model phán xét",
     ["Thành phần", "Luật", "Ngưỡng"],
     [
         ["Chỉ số chấm", "Kết quả (QAS xanh lần đầu, lỗi lọt UAT, holdout), không phải số mã lỗi (N5)", "-"],
         ["Chia ngẫu nhiên", "50/50 có / không có bài học (R7)", "≥ 30 unit mỗi nhánh"],
         ["Quy lỗi", "Chỉ tính khi test fail truy về claim (R5)", "'không quy được' ≤ 30%"],
         ["Lịch sử phán xét", "Bản ghi có cấu trúc, do code ghi, version theo model (R6)", "bản ghi > 8 tuần × 0,5"],
         ["Bài học", "Nguồn gốc + TTL + ≥ 3 project mới liên project (I22)", "TTL 90 ngày"],
         ["Holdout", "Ngoài RAG System, làm mới mỗi quý, chuỗi canary (I32)", "-"],
         ["Model", "Pin snapshot, eval đêm (I31)", "tụt > 5% → đóng băng"],
     ]),
    ("Độ tin cậy control plane",
     ["Cơ chế", "Luật", "Ngưỡng"],
     [
         ["Fencing epoch", "Mọi lần ghi mang epoch (I15)", "0 lần ghi epoch cũ được nhận"],
         ["Chuyển trạng thái có khóa", "Idempotent (N1)", "-"],
         ["Reconciler", "So git / lease / hàng gộp / QAS với trạng thái chiếu (N1)", "mỗi 5 phút"],
         ["Chaos suite", "Phải xanh trước run tự động (I38)", "6 kịch bản"],
         ["SLO control plane", "Có chủ + runbook (I38)", "≥ 99,5% giờ làm việc, giao việc p95 < 30 giây"],
         ["Event bắt buộc đủ trường", "Từ chối event thiếu (I18)", "-"],
         ["Outbox", "Tác động ra ngoài có khóa (I16)", "0 tác động trùng"],
     ]),
]

SOURCES = [
    "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue",
    "https://docs.pact.io/getting_started/how_pact_works",
    "https://docs.cloudfoundry.org/devguide/deploy-apps/rolling-deploy.html",
    "https://cap.cloud.sap/docs/guides/databases/schema-evolution",
    "https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html",
    "https://microservices.io/patterns/data/transactional-outbox.html",
    "https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/",
    "https://www.thoughtworks.com/radar/techniques/complacency-with-ai-generated-code",
]
