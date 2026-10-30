"""DLC status report (docs/design/AI-SDLC-Status-Report.html): four swimlanes (New System, Enhancement, Bug Fix, Feature Migration), one node per step,
coloured by status, hover = details. Reuses the neon-blueprint helpers of the DLC design reports (swimlane.py)."""
import json
import os
import sys
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swimlane import (BG, COL_W, EX_H, LANE_GAP, LANE_H, NODE_H, NODE_W, PINK, PHASE_COLORS, TEAL_LINE, TOP,  # noqa: E402
                      X0, _defs, esc, label_on_line, text, wrap)

LANES = [
    ("user", "01 / Người dùng", "BA, PM, khách", "#67e8f9", "#0c2b37"),
    ("fe", "02 / Frontend", "chat agent + workflow tool", "#c4b5fd", "#1d1835"),
    ("ctrl", "03 / DLC engine", "control plane + cổng (code)", "#fdba74", "#2a1c12"),
    ("agent", "04 / DLC engine", "agent (LLM)", "#5eead4", "#0c2a2a"),
    ("rag", "05 / RAG System", "namespace /v1 (DLC dùng dev; prod đã có)", "#f9a8c4", "#2a1421"),
]
ST = {  # status -> (label, colour, border dash, fill opacity)
    "done": ("XONG", "#86efac", None, 1.0),
    "part": ("CÒN CẤN", "#fdba74", "7 5", 0.85),
    "todo": ("CHƯA ĐỤNG", "#7f93b0", "3 5", 0.45),
}


def N(i, lane, phase, title, sub, st, can, co, cap="", rag="", src="", rework=None):
    d = OrderedDict()
    d["Trạng thái"] = ST[st][0]
    d["Cần gì"] = can
    d["Đã có"] = co
    if cap:
        d["Còn cấn / chưa có"] = cap
    if rag:
        d["Phần RAG System"] = rag
    if src:
        d["Bằng chứng"] = src
    return dict(id=i, lane=lane, phase=phase, title=title, sub=sub, st=st, detail=d, rework=rework)


RAG_DEV = "Capabilities /v1 đã lên RAG System prod (11/10, bản beta); DLC hiện vẫn chạy với RAG System dev (namespace line_dev), chưa có namespace trên prod."

NEW = [
    N("ns1", "user", "Đầu vào", "Spec / Blueprint", "spec.md với các mục ## F1..", "part",
      "Spec đúng mẫu F-item (mỗi mục có tiêu chí kiểm được), blueprint đã ký.",
      "Mẫu todo-pack; DLC đọc mọi .md/.txt trong pack.",
      "Chưa có màn soạn spec; ký blueprint / contract chưa có (app SDLC cũ có Scope Sign-off, chưa nối).",
      src="samples/todo-pack/spec.md"),
    N("ns2", "fe", "Đầu vào", "Frontend: chat chọn flow / flow #22", "đính kèm .md + 'implement'", "done",
      "Một chỗ để chọn process và nhập đầu vào.",
      "Chat ở Frontend: đính kèm spec .md, nói 'implement' → agent đọc quy tắc trong RAG System, chọn New System, "
      "chạy flow #22 và mở panel DLC; run thật xanh ($0.29). Flow #22 cũng chạy trực tiếp được.",
      src="flows/22-dlc-new-system.json, main f807c5a"),
    N("ns3", "fe", "Đầu vào", "Chuẩn bị pack + repo", "dlc_flow.ps1 -Mode new", "done",
      "Pack (spec.md + pack.json) và repo target mới trên nhánh main.",
      "Shell node gọi tools/dlc_flow.ps1; đầu vào qua biến môi trường nên spec có dấu nháy vẫn an toàn.",
      src="sdlc-line 29dbcde"),
    N("ns4", "ctrl", "Đầu vào", "Nhận run + cây ngân sách", "POST /api/runs, trần $/run", "done",
      "Run id, trạng thái admitted, ngân sách run → F-item → unit, lease run.",
      "Server :8796, budget warn 80% / stop 100%, resume sau restart.",
      src="line/pipeline.py admit, budget.py"),
    N("ns5", "rag", "Đầu vào", "Namespace + đóng băng pack", "manifest, packs:freeze, lease run", "part",
      "Namespace của dây chuyền, pack đóng băng có quote id ổn định, lease run có epoch.",
      "Adapter HTTP + outbox khi mất kết nối; chạy live trên dev (namespace line_dev) xanh.",
      "Lần thử qua Frontend hôm nay chạy RAG off (Docker tắt); chưa có trên prod.",
      rag=RAG_DEV, src="rag/http_adapter.py"),
    N("ns6", "agent", "Hiểu", "Reader A / B", "tóm tắt theo khu vực, có trích dẫn", "done",
      "Hai bản đọc độc lập của mọi F-item, mỗi ý có quote.",
      "understand/readers.py; đọc lại độc lập khi lệch.", src="line/understand"),
    N("ns7", "ctrl", "Hiểu", "Đối chiếu + kiểm trích dẫn", "quote phải khớp nguyên văn", "done",
      "Hai bản đọc khớp nhau, quote có thật trong spec.",
      "reconcile.py + literal quote check.", src="line/understand/reconcile.py"),
    N("ns7a", "agent", "Hiểu", "Trích feature graph", "feature T1-T4, data, contract, rule", "done",
      "Agent đọc spec ra node (feature 4 tầng, data, contract, rule) và cạnh (parent_of, depends_on, produces, "
      "consumes, constrained_by), mỗi cạnh có trích dẫn nguyên văn.",
      "fgraph/extract.py + prompt fgraph.md; code kiểm, sửa lại 1 lần kèm đúng danh sách lỗi. Chạy thật trên spec "
      "thư viện (4 F-item): graph đúng ngay lần đầu, 'today' nhận ra là đến từ bên ngoài.",
      "Bật bằng cờ LINE_FGRAPH (mặc định tắt).", src="sdlc-line 3eb958d, run R20261011-135832-e63c"),
    N("ns7b", "ctrl", "Hiểu", "Kiểm graph + phụ thuộc multi-hop", "thiếu bên tạo ra → hỏi, không bịa", "done",
      "Graph hợp lệ; ai dùng X thì phụ thuộc ai tạo X (nhiều bước); thứ tự build; thứ được dùng mà không ai tạo "
      "ra thành câu hỏi (external / thêm feature / không cần) qua ask hoặc decide.",
      "Đã nối vào pipeline. Run thật: tự suy F3 cần F1+F2, F4 cần F3; dừng đúng 1 câu hỏi 'thời hạn mượn' (spec "
      "cố ý bỏ trống); trả lời → addendum v1.1 → đọc lại, trích lại graph, chạy tiếp tới xanh ($2.13). 547 test, "
      "dry e2e 8/8.",
      "Graph mới lưu ở store của dây chuyền, chưa lên RAG System.",
      rag="Lưu graph lên RAG System qua capability /v1/{ns}/graph (slice A5, chưa làm).",
      src="sdlc-line 46dd412 + 3eb958d"),
    N("ns8", "agent", "Hiểu", "Gap + mâu thuẫn", "7 ô checklist, đồ thị rule", "part",
      "Phát hiện chỗ thiếu, giả định, mâu thuẫn với hệ đang chạy.",
      "understand_plus (gaps, conflicts, rule graph, addendum vN.k).",
      "Mặc định tắt (LINE_UPLUS); chưa chạy với model thật.",
      rag="Rule graph mirror lên records; capability rules (3 hop) có trên dev.",
      src="line/understand_plus"),
    N("ns9", "user", "Hiểu", "Trả lời câu hỏi", "ask: chờ người · decide: model tự quyết", "part",
      "ask: người trả lời bất đồng bộ; decide: model chọn và ghi lại để đối chiếu.",
      "Cả hai chế độ đã code (human_mode); decide ghi worklog project; e2e decide_off xanh.",
      "Bản triển khai cho khách chạy decide (LINE_PROFILE=agents): không ai phải trả lời; Frontend mặc định chỉ theo dõi tiến độ, còn màn trả lời câu hỏi ở chế độ ask vẫn qua board / API.",
      rag="POST /v1/{ns}/worklog ghi vào worklog project (có trên RAG System prod từ 11/10).",
      src="sdlc-line dac1d7d, RAG System c0bd292"),
    N("ns10", "agent", "Hiểu", "Test chấp nhận", "mọi F-item, khóa sha", "done",
      "Test chạy được cho từng tiêu chí, đỏ khi chưa có code, khóa lại.",
      "Test author + red-on-empty + locked sha; commit 'acceptance tests (locked)'.",
      src="git log target: acceptance tests (locked)"),
    N("ns11", "ctrl", "Kế hoạch", "Skeleton + contract", "walking skeleton", "todo",
      "Architect dựng khung + interface trước khi chia unit.",
      "Planner giữ unit contract chỉ ở mức interface.",
      "Chưa có bước architect / walking skeleton riêng."),
    N("ns12", "agent", "Kế hoạch", "Planner: work graph", "theo thứ tự feature graph", "done",
      "Unit cho mọi F-item, phụ thuộc, wave, đúng thứ tự phụ thuộc giữa các feature.",
      "Planner nhận thứ tự build + input từ bên ngoài; luật FEATURE_ORDER kiểm lại. Run thật: wave U1 → U2|U3 "
      "→ U4 (chờ U2,U3) → U5 (chờ U4). Builder được đưa 'Uses': feature của nó dùng gì, ai tạo, ở file nào.",
      src="build/planner.py, graph.py, 3eb958d"),
    N("ns13", "ctrl", "Kế hoạch", "Kiểm graph + claim file", "không vòng, cỡ, claim", "done",
      "Graph hợp lệ, mỗi unit claim file của nó (trong một run).",
      "graph.py checks + scheduler theo wave.",
      "Claim chỉ trong một run; registry claim giữa các run chưa có."),
    N("ns14", "rag", "Xây", "Ngữ cảnh theo key", "/context/step + finding", "part",
      "Gói ngữ cảnh theo role/step/stack, finding đúng tình huống, lesson đã duyệt.",
      "retrieve() của adapter; RAG System: key tier, triggers, chia sẻ người ↔ agent trong project (F15).",
      "Dây chuyền chưa tự ghi finding khi lỗi lặp; tier agents phía người đang tắt chờ bench.",
      rag="F15: bound / triggers / people TTL 90 ngày, agent propose finding (có trên RAG System prod từ 11/10).",
      src="RAG System 4abb4c5, ab9b21b"),
    N("ns15", "agent", "Xây", "Builder pool", "song song trong wave", "done",
      "Mỗi unit một worktree, fence lease, retry ladder.",
      "builder.py, sandbox worktree, đổi model ở nấc 2.", src="line/build/builder.py"),
    N("ns16", "ctrl", "Kiểm", "Verifier", "server tự chạy test, scope", "done",
      "Test do server chạy (không tin agent), diff trong scope, test khóa không bị sửa.",
      "verifier.py + empty-change rule.", src="7f529c3"),
    N("ns17", "agent", "Kiểm", "Review + drift + judge", "ngữ cảnh sạch", "part",
      "Reviewer không thấy lịch sử tác giả; tín hiệu lệch; judge phân xử.",
      "review/ (reviewer, drift, judge, decision log).",
      "Bật bằng cờ; judge chưa lần nào được gọi trong run thật.", src=""),
    N("ns18", "ctrl", "Tích hợp", "Merge queue", "rebase + hợp bộ test", "done",
      "Merge theo wave, chạy lại hợp bộ test sau rebase.", "ship/merge_queue.py.",
      rework=("ns15", "conflict / đỏ → unit")),
    N("ns19", "ctrl", "Test", "Deploy QAS + chạy x3", "blue/green, flaky cách ly", "part",
      "Bản build trên QAS, acceptance + hồi quy chạy 3 lần, fixer khi đỏ.",
      "deploy.py (blue/green thư mục local), qas_runner x3, fixer 2 thế hệ.",
      "QAS là thư mục local; chưa có QAS thật (server / BTP), chưa đặt slot.",
      rework=("ns15", "đỏ → fixer")),
    N("ns20", "rag", "Test", "Event / record / metric", "outbox khi mất kết nối", "done",
      "Mọi event lên store chung theo thứ tự, không mất khi đứt mạng.",
      "Live trên dev: 54/54 event, records run/unit/digest/test/graph.",
      "DLC chưa có namespace trên RAG System prod (mới chạy với dev).", rag=RAG_DEV, src=""),
    N("ns21", "user", "Test", "Board: QAS xanh", "xem run, câu hỏi, chi phí", "part",
      "Một màn xem tiến độ, câu hỏi, chi phí, lỗi.",
      "Frontend mặc định (đăng nhập Keycloak): tiến độ từng node, Pause / Resume, bấm node xem worklog agent + danh sách report, nút Start / Open app mở http://<IP>:<port>; board :8796 cũng có đăng nhập.",
      "Bước UAT / nghiệm thu chưa có."),
    N("ns22", "user", "Release", "UAT → Go/No-Go → PRD", "sign-off, invoice", "todo",
      "Khách nghiệm thu, quyết định go-live, deploy PRD, ký và xuất invoice.",
      "App SDLC cũ có UAT / cutover / sign-off / mốc invoice (chưa nối).",
      "Dây chuyền dừng ở QAS; chưa có PRD, chưa có Contract Management."),
    N("ns23", "agent", "Học", "Bài học → eval → canary", "distill, holdout, canary", "part",
      "Rút bài học từ lỗi, chấm trên holdout, thử canary trước khi dùng.",
      "learn/ (distiller, evalgate, serve), agents_dir.",
      "Eval gate từ chối tất cả cho tới khi có eval set.",
      rag="items lifecycle, vault holdout, rollback tự động (có trên RAG System prod từ 11/10).", src=""),
]

ENH = [
    N("en1", "user", "Đầu vào", "Spec phần nâng cấp", "## F.. cho hành vi mới", "part",
      "Delta spec + CR đã duyệt.", "Spec nhập trực tiếp vào flow #23.",
      "Chưa có CR / duyệt hai lần (app SDLC cũ có, chưa nối)."),
    N("en2", "fe", "Đầu vào", "Frontend: flow #23 Enhancement", "target + name + spec", "done",
      "Chọn repo có sẵn và nhập spec.", "Workflow #23; chạy thử 2026-10-11 xanh ($0.40).",
      src="flows/23-dlc-enhancement.json"),
    N("en3", "fe", "Đầu vào", "Kiểm repo + chuẩn bị pack", "dlc_flow.ps1 -Mode enhance", "done",
      "Repo là git, pack delta.", "Từ chối nếu target không phải git repo.", src="sdlc-line 29dbcde"),
    N("en4", "rag", "Đầu vào", "Chọn project có sẵn", "projects:match", "part",
      "Agent nhận việc đọc RAG System và tự quyết project cũ hay mới.",
      "Route POST /v1/{ns}/projects:match (có trên RAG System prod từ 11/10).",
      "Dây chuyền chưa gọi route này; project mới do tài khoản thật tạo khi quy trình bắt đầu.",
      rag="D28; RAG System 4abb4c5."),
    N("en5", "ctrl", "Đầu vào", "Nhận run + ngân sách", "như New System", "done",
      "Run trên base sha của repo có sẵn.", "admit ghi base_sha.", src="run detail base_sha"),
    N("en6", "agent", "Hiểu", "Reader: delta + ảnh hưởng", "file, test bị chạm", "part",
      "Đọc delta và phân tích ảnh hưởng lên code đang có.",
      "Reader đọc spec delta; builder đọc repo khi làm.",
      "Chưa có phân tích impact riêng trên repo."),
    N("en7", "ctrl", "Hiểu", "Impact có thật", "multi-hop từ node bị đổi", "todo",
      "Kiểm mọi file / test được nhắc tới có thật; ảnh hưởng = các node đi tới được từ node bị đổi.",
      "Phép tính multi-hop đã có (fgraph.must_precede).",
      "Chưa có graph của hệ đang chạy để đi từ đó (cần lưu graph lên RAG System, slice A5)."),
    N("en8", "agent", "Hiểu", "Test delta + hồi quy cũ", "mới đỏ, cũ xanh", "part",
      "Test mới cho delta (đỏ), bộ test cũ vẫn xanh.",
      "Test author viết test delta và khóa lại.",
      "Chưa chứng minh bộ test cũ của repo luôn được chạy lại như hồi quy."),
    N("en9", "agent", "Kế hoạch", "Planner: unit + claim", "tập thay đổi nhỏ nhất", "done",
      "Ít unit nhất cho delta.", "Planner chung (run thử: 1 unit)."),
    N("en10", "ctrl", "Kế hoạch", "Chồng lấn với run khác", "registry claim", "todo",
      "Không cho hai run sửa cùng chỗ cùng lúc.", "-",
      "Chưa có registry claim giữa các run (thiết kế 12.1)."),
    N("en11", "agent", "Xây", "Builder trên nhánh", "không refactor ngoài scope", "done",
      "Sửa trong worktree, giữ hành vi cũ.", "Builder chung + verifier scope."),
    N("en12", "ctrl", "Kiểm", "Verifier + scope", "diff trong claim", "done",
      "Test server chạy, diff trong scope.", "verifier.py."),
    N("en13", "agent", "Kiểm", "Review ngữ cảnh sạch", "delta so với spec", "part",
      "Review delta độc lập.", "review/ có sẵn.", "Bật bằng cờ, chưa chạy thật."),
    N("en14", "ctrl", "Tích hợp", "Merge: rebase + hợp test", "hotfix > train", "part",
      "Rebase lên main mới nhất, hợp bộ test.", "merge_queue rebase + hợp test.",
      "Chưa có thứ tự ưu tiên hotfix trước train.", rework=("en11", "conflict → unit")),
    N("en15", "ctrl", "Test", "QAS: delta + hồi quy x3", "slot dùng chung", "part",
      "Deploy slot QAS, chạy acceptance delta + hồi quy.",
      "deploy blue/green local + runner x3.", "QAS local; chưa có slot đặt trước."),
    N("en16", "rag", "Test", "Event + worklog", "store chung", "done",
      "Run và quyết định nằm trong store chung của project.", "Như New System.", rag=RAG_DEV),
    N("en17", "user", "Test", "Board: CR xanh → UAT", "nghiệm thu CR", "part",
      "Xem kết quả, nghiệm thu CR.", "Board :8796.", "UAT cho CR chưa có."),
    N("en18", "agent", "Học", "Bài học: sót impact", "xung đột, hotspot", "part",
      "Ghi lại chỗ sót impact, xung đột.", "learn/ chung.", "Eval set chưa có."),
]

BUG = [
    N("bf1", "user", "Đầu vào", "Báo lỗi", "title, repro, expected, actual", "part",
      "Ticket đã xác nhận: bước tái hiện, dữ liệu, kỳ vọng, thực tế.",
      "Flow #24 nhận 7 trường và dựng spec bug.",
      "Chưa nhận ticket từ Freshdesk / Jira (app SDLC cũ có Jira chỉ đọc).",
      src="flows/24-dlc-bug-fix.json"),
    N("bf2", "fe", "Đầu vào", "Frontend: flow #24 Bug Fix", "target + chi tiết lỗi", "done",
      "Chọn repo, nhập lỗi.", "Workflow #24; chạy thử xanh ($0.52, 'add \"\"' bị từ chối).",
      src=", R20261011-121816-9443"),
    N("bf3", "fe", "Đầu vào", "Dựng spec bug", "dlc_flow.ps1 -Mode bug", "done",
      "Spec F1 = hành vi đúng, giữ nguyên phần còn lại.", "Mẫu spec bug trong script."),
    N("bf4", "ctrl", "Đầu vào", "Nhận theo mức độ", "critical chen trước", "part",
      "Lỗi nặng vượt hàng, capacity giữ sẵn.", "Nhận run như mọi run.",
      "Chưa có mức độ / ưu tiên giữa các run."),
    N("bf5", "agent", "Tái hiện", "Agent tái hiện", "script fail trên bản sao QAS", "todo",
      "Script tái hiện chạy fail trên bản sao QAS.", "-",
      "Chưa có; hiện test chấp nhận (đỏ) đóng vai repro."),
    N("bf6", "ctrl", "Tái hiện", "Fail đúng lý do", "assert khớp ticket", "part",
      "Repro fail đúng triệu chứng.", "Test khóa phải đỏ trước khi sửa.",
      "Chưa đối chiếu assert với ticket."),
    N("bf7", "agent", "Chẩn đoán", "Phân tích nguyên nhân", "code + cách sửa đã biết", "todo",
      "RCA từ code, log, finding đã biết.", "-", "Chưa có agent RCA.",
      rag="Finding có trigger (crash...) và bound project đã có ở RAG System (có trên RAG System prod từ 11/10) để agent đọc."),
    N("bf8", "agent", "Sửa", "Fixer: diff tối thiểu", "nhánh hotfix từ tag PRD", "part",
      "Sửa nhỏ nhất, từ tag PRD.", "Builder sửa trên main (run thử: 1 unit).",
      "Chưa có nhánh hotfix / tag PRD."),
    N("bf9", "ctrl", "Kiểm", "Fail trước / pass sau", "scope, không sửa test", "done",
      "Test khóa đỏ trước, xanh sau, diff trong scope.", "verifier + locked tests."),
    N("bf10", "agent", "Kiểm", "Review ngữ cảnh sạch", "bản sửa vs nguyên nhân", "part",
      "Review độc lập.", "review/.", "Bật bằng cờ, chưa chạy thật."),
    N("bf11", "ctrl", "Tích hợp", "Merge + forward-port", "hotfix đứng đầu hàng", "part",
      "Merge hotfix, đưa sửa sang nhánh đang phát triển.", "Merge queue.",
      "Chưa có forward-port, chưa ưu tiên hotfix.", rework=("bf8", "đỏ → sửa lại")),
    N("bf12", "ctrl", "Test", "QAS ưu tiên + hồi quy x3", "chen trước test feature", "part",
      "Slot QAS ưu tiên, repro + hồi quy 3 lần.", "QAS runner x3 (local).",
      "Chưa có slot ưu tiên."),
    N("bf13", "rag", "Test", "Event + worklog", "store chung", "done",
      "Run lỗi và kết quả trong store chung.", "Như New System.", rag=RAG_DEV),
    N("bf14", "user", "Release", "Board: đã sửa → release", "quyết định đưa PRD", "part",
      "Xác nhận đã sửa, quyết định release.", "Board :8796.", "Chưa có bước release / PRD."),
    N("bf15", "rag", "Học", "Finding RCA kèm trigger", "lần sau gặp là biết", "part",
      "Ghi cách sửa thành finding đúng tình huống cho lần sau.",
      "RAG System: finding bound project + triggers, agent được propose (có trên RAG System prod từ 11/10).",
      "Dây chuyền chưa tự ghi finding sau RCA.", rag="F15 (có trên RAG System prod từ 11/10)."),
]


MIG = [
    N("mg1", "user", "Đầu vào", "Repo v1 + v2 + ghi chú khách", "repo, thư mục nhiều repo, hoặc file danh sách", "done",
      "Repo bản cũ (v1) và bản viết lại (v2, là target), tùy chọn ref v1 gốc (vanilla) để tách phần custom của khách, ghi chú .md, chế độ ask / decide.",
      "Đủ đầu vào: v1, v1Ref, v1Base, v2, v2Ref, notes, mode, scope, build, ngân sách. v1 / v2 là thư mục nhiều repo thì "
      "tự tìm repo, scan từng repo (song song 3, cache theo commit, repo lỗi không làm hỏng repo khác) rồi gộp; dry e2e "
      "estate 3 repo xanh.",
      src="line/migrate/estate.py, scan.py, main 2e4bd5c"),
    N("mg2", "fe", "Đầu vào", "Chat ở Frontend hoặc flow #25", "agent tự chọn flow theo RAG System", "part",
      "Người dùng chat 'migrate v1 ở .. sang v2 ở ..'; agent đọc quy tắc trong RAG System, chọn Feature Migration, chạy flow và mở panel DLC.",
      "Flow #25 'DLC: Feature Migration' đã import vào workflow tool; quy tắc 4 flow đã ghi vào RAG System dev.",
      "Chưa thử migration qua chat với model thật (New System đã xanh qua chat).",
      src="flows/25-dlc-feature-migration.json"),
    N("mg3", "ctrl", "Đầu vào", "Nhận migration", "POST /api/migrations", "done",
      "Migration id, trạng thái, resume sau restart.",
      "API /api/migrations (+ /answers), CLI migrate / migrate-answer; trạng thái admitted → inventoried → matched → parked / decided → building → verifying → green / analysed / escalated; server tự resume.",
      src="line/migrate/runner.py, server.py"),
    N("mg4", "ctrl", "Phân tích", "Trích xuất theo stack", "generic + CAP/CDS + UI5", "part",
      "Lấy service, entity/view, action, handler, màn hình, định danh của cả hai cây, không cần model.",
      "Extractor generic và cap-cds-ui5 (service, entity + view, action, hook before/on/after, màn UI5); so bề mặt bằng code. Thêm stack = thêm 1 class.",
      "Parser bằng regex: nhận tên, chưa hiểu ngữ nghĩa; chưa có call graph cho CAP.",
      src="line/migrate/extract.py"),
    N("mg5", "agent", "Phân tích", "Kiểm kê feature v1 / v2", "gom theo vùng nghiệp vụ, có trích dẫn", "part",
      "Danh sách feature theo vùng nghiệp vụ, mỗi feature có trích dẫn nguyên văn từ code.",
      "Model liệt kê, code kiểm trích dẫn; feature không chứng minh được bị đánh dấu unproven và không bao giờ được migrate. Object master data + các bảng = 1 feature data.",
      "Mới chạy với fake model (dry); chưa chạy model thật trên repo lớn.",
      src="line/migrate/inventory.py"),
    N("mg6", "ctrl", "Phân tích", "Vòng xác nhận", "luật từ đợt scan SMDG", "done",
      "Không báo thiếu khi feature thực ra có ở bên kia.",
      "Luật chạy trước model: đổi tên, chỉ có trong catalogue (= đã lên kế hoạch, chưa build), chỉ là chuỗi (= không phải feature); bằng chứng chỉ từ source, không .json, không test fixture. Có test trên cặp CAP/UI5 nhỏ.",
      src="test_migrate_rules.py; bài học từ lần scan SMDG V1.7 và 2.0"),
    N("mg7", "agent", "Phân tích", "Ghép theo hành vi", "handler hai bên trong prompt", "part",
      "Ghép feature v1 với v2 theo hành vi, không chỉ theo tên; liệt kê quyết định mở để hỏi trước.",
      "Ghép kèm handler hai bên; sinh câu hỏi mở (API đích, phạm vi bản UI cũ).",
      "Chất lượng ghép với model thật chưa đo."),
    N("mg8", "ctrl", "Phân tích", "Ma trận parity 4 loại", "+ cờ custom, độ tin cậy", "done",
      "Mỗi feature thuộc 1 loại: chỉ v1 (migrate), chỉ v2 (bảo vệ), cả hai giống (kiểm còn sống), cả hai trái nhau (quyết định).",
      "Ma trận v1_only / v2_only / both_same / both_conflict, cờ custom từ v1Base, độ tin cậy, vùng. Dry e2e: 1/1/1/1.",
      src="line/migrate/matrix.py, e2e migrate PASS"),
    N("mg9", "user", "Quyết định", "Chọn khi trái nhau (ask)", "dừng trước khi sửa", "done",
      "Liệt kê các chỗ trái nhau trước khi làm để người chọn v1 hay v2.",
      "Chế độ ask dừng migration trước mọi thay đổi; flow kết thúc với câu hỏi + link board; trả lời ngay trên tab "
      "Migrations của board (hoặc API) rồi resume; dry e2e: dừng, trả lời v2, chạy tiếp tới xanh.",
      src="line/board.html, POST /api/migrations/{id}/answers, main 6a02625"),
    N("mg10", "ctrl", "Quyết định", "Decide: giữ v2 + backup", "decisions.jsonl", "done",
      "Chế độ auto: ưu tiên v2 nhưng giữ bằng chứng để đối chiếu.",
      "Giữ v2, ghi hành vi v1 vào backup/, thêm dòng vào decisions.jsonl.",
      src="line/migrate/conflicts.py"),
    N("mg11", "ctrl", "Kế hoạch", "Blast radius", "feature bị ảnh hưởng, gate, merge", "part",
      "Không làm hỏng feature đang sống của v2.",
      "Feature bị ảnh hưởng qua entity / interface dùng chung; gate = guard của v2 mà feature migrate phải đi qua (ghi vào spec); gộp bảng vào entity đang sống = rủi ro cao; mức rủi ro từng thay đổi.",
      "Đồ thị phụ thuộc theo import chỉ có cho Python; CAP/UI5 mới dựa vào entity / interface dùng chung.",
      src="line/migrate/blast.py"),
    N("mg12", "ctrl", "Kế hoạch", "Ước lượng effort", "bảng, service, màn hình", "done",
      "Gợi ý công sức theo vùng và theo thay đổi để lên kế hoạch.",
      "effort.json theo vùng / thay đổi.", src="line/migrate/effort.py"),
    N("mg13", "ctrl", "Kiểm", "Baseline suite v2", "chạy trước khi sửa", "done",
      "Biết test nào của v2 đang xanh trước khi đụng vào.",
      "Chạy toàn bộ suite v2 trước mọi thay đổi.", src="line/migrate/verify.py"),
    N("mg14", "agent", "Xây", "Spec pack → Enhancement trên v2", "chạy pipeline thường", "part",
      "Biến thay đổi thành spec rồi build trên v2 theo thứ tự phụ thuộc.",
      "Sinh spec.md (1 F-item mỗi feature migrate) và chạy như Enhancement; baseline / verify chạy theo stack của repo "
      "(Python, CAP, UI5 TS, React); run con nhận phần ngân sách còn lại; dry e2e xanh.",
      "Chưa chạy với model thật; chưa có test UI trình duyệt (OPA5 / wdi5); v2 nhiều repo chỉ phân tích (TARGET_ESTATE).",
      src="line/migrate/specgen.py, line/stacks, main 6a02625"),
    N("mg15", "ctrl", "Kiểm", "Hồi quy: PARITY_REGRESSION", "xanh trước, đỏ sau = lỗi", "done",
      "Không feature nào của v2 bị hỏng vì migrate.",
      "Chạy lại suite; test xanh trước mà đỏ sau là PARITY_REGRESSION, trừ khi có quyết định chọn v1 thay thế.",
      src="line/migrate/verify.py"),
    N("mg16", "agent", "Kiểm", "Test ghi hành vi v1", "golden input / output", "todo",
      "Chạy v1 để ghi lại đầu vào / đầu ra chuẩn làm tiêu chí cho v2.",
      "Hiện dùng ví dụ trích từ code v1.", "Chưa chạy v1 để ghi golden."),
    N("mg17", "user", "Báo cáo", "Report parity + board", "ma trận, quyết định, rollback", "done",
      "Một báo cáo cho khách: đã chuyển gì, giữ gì, quyết định gì, cách rollback.",
      "report.md (vùng + effort, so bề mặt, quyết định, gate + merge, hồi quy, unproven, chi phí từng repo, rollback) và "
      "tab Migrations trên board: timeline, ngân sách, ma trận kèm bằng chứng, bảng repo, blast radius, nâng trần + resume.",
      src="line/migrate/report.py, line/board.html, main 6a02625"),
    N("mg18", "ctrl", "Báo cáo", "Dữ liệu, cấu hình, role, interface", "cut-over, chạy song song, ký nhóm feature", "todo",
      "Migrate dữ liệu / master data / cấu hình, role, interface đối tác, kế hoạch cut-over, chạy song song v1 / v2, "
      "khách ký xác nhận theo nhóm feature.",
      "Đã liệt kê trong thiết kế (feature-migration.md mục 7).", "Chưa tự động hóa."),
    N("mg19", "rag", "Báo cáo", "Event + quy tắc trong RAG System", "store chung", "part",
      "Lịch sử migration và quyết định nằm trong store chung; agent đọc được quy tắc chọn flow.",
      "Event migration.* đi qua outbox lên RAG System như mọi run; quy tắc 4 flow trong RAG System dev.",
      "Ma trận / quyết định chưa ghi thành knowledge để lần sau dùng lại.", rag=RAG_DEV),
]


def render(steps, tid):
    lanes = OrderedDict((k, (a, b, acc, fill)) for k, a, b, acc, fill in LANES)
    keys = list(lanes)
    top = {k: TOP + i * (LANE_H + LANE_GAP) for i, k in enumerate(keys)}
    ex_top = TOP + len(keys) * (LANE_H + LANE_GAP)
    W = X0 + len(steps) * COL_W + 40
    H = ex_top + EX_H + 70
    pos = {s["id"]: (X0 + i * COL_W, top[s["lane"]] + (LANE_H - NODE_H) / 2 + 8) for i, s in enumerate(steps)}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
           f'aria-labelledby="{tid}"><title id="{tid}">Swimlane</title>'] + _defs(tid)
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#grid)"/>')
    phases = OrderedDict()
    for i, s in enumerate(steps):
        phases.setdefault(s["phase"], []).append(i)
    for pi, (ph, idx) in enumerate(phases.items()):
        x1, x2 = X0 + idx[0] * COL_W - 6, X0 + idx[-1] * COL_W + NODE_W + 6
        col = PHASE_COLORS[pi % len(PHASE_COLORS)]
        out.append(f'<rect x="{x1}" y="40" width="{x2 - x1}" height="34" rx="17" fill="#101928" stroke="{col}" '
                   f'stroke-width="1.5"/>')
        out.append(text((x1 + x2) / 2, 62, ph, 14, col, 800))
    for k in keys:
        a, b, acc, fill = lanes[k]
        y = top[k]
        out.append(f'<rect x="20" y="{y}" width="{W - 40}" height="{LANE_H}" rx="14" fill="{fill}" fill-opacity="0.25" '
                   f'stroke="#263650" stroke-width="2" stroke-dasharray="9 7"/>')
        out.append(text(36, y + 28, a, 13, acc, 800, "start"))
        for j, part in enumerate(wrap(b, 26, 2)):
            out.append(text(36, y + 47 + j * 16, part, 11.5, "#6b7a93", 500, "start"))
    out.append(f'<rect x="20" y="{ex_top}" width="{W - 40}" height="{EX_H}" rx="14" fill="#2a1421" fill-opacity="0.25" '
               f'stroke="{PINK}" stroke-width="2" stroke-dasharray="9 7"/>')
    out.append(text(36, ex_top + 28, "Vòng lặp / sửa lại", 12.5, PINK, 800, "start"))
    for i in range(len(steps) - 1):
        (ax, ay), (bx, by) = pos[steps[i]["id"]], pos[steps[i + 1]["id"]]
        y1, y2, x1, x2 = ay + NODE_H / 2, by + NODE_H / 2, ax + NODE_W, bx
        d = f"M{x1} {y1}H{x2 - 2}" if abs(y1 - y2) < 1 else f"M{x1} {y1}H{x1 + (COL_W - NODE_W) / 2}V{y2}H{x2 - 2}"
        out.append(f'<path d="{d}" stroke="{TEAL_LINE}" stroke-width="3" fill="none" filter="url(#glow)" '
                   f'marker-end="url(#ar-teal-{tid})"/>')
    labels, track = [], 0
    for s in steps:
        if not s.get("rework") or s["rework"][0] not in pos:
            continue
        tgt, lbl = s["rework"]
        (sx, sy), (tx, ty) = pos[s["id"]], pos[tgt]
        yt = ex_top + 50 + (track % 5) * 22
        track += 1
        xs, xt = sx + NODE_W / 2 + 18, tx + NODE_W / 2 - 18
        out.append(f'<path d="M{xs} {sy + NODE_H}V{yt}H{xt}V{ty + NODE_H + 2}" stroke="{PINK}" stroke-width="2" '
                   f'stroke-dasharray="9 6" fill="none" marker-end="url(#ar-pink-{tid})"/>')
        labels.append(label_on_line((xs + xt) / 2, yt, lbl, PINK))
    out.extend(labels)
    for s in steps:
        x, y = pos[s["id"]]
        _, _, acc, fill = lanes[s["lane"]]
        lbl, scol, dash, op = ST[s["st"]]
        border = acc if s["st"] == "done" else scol
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        body = [f'<rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" rx="8" fill="{fill}" stroke="{border}" '
                f'stroke-width="2.5"{dash_attr}{"" if s["st"] == "todo" else " filter=" + chr(34) + "url(#glow)" + chr(34)}/>',
                text(x + 10, y + 16, s["id"], 10.5, acc, 800, "start"),
                text(x + NODE_W - 10, y + 16, lbl, 10, scol, 800, "end")]
        tl = wrap(s["title"], 24, 2)
        ty0 = y + 38 if len(tl) == 2 else y + 46
        tcol = "#f3f6fb" if s["st"] != "todo" else "#8a97ab"
        for j, line in enumerate(tl):
            body.append(text(x + NODE_W / 2, ty0 + j * 16, line, 13, tcol, 800))
        for j, line in enumerate(wrap(s["sub"], 31, 2)):
            body.append(text(x + NODE_W / 2, y + 78 + j * 13, line, 10.5, "#a7b0bf"))
        body.append(f'<rect x="{x}" y="{y + NODE_H - 5}" width="{NODE_W}" height="5" rx="2" fill="{scol}" '
                    f'opacity="{op}"/>')
        tip = esc(json.dumps({"id": s["id"], "title": s["title"], "accent": scol, **s["detail"]}, ensure_ascii=False))
        out += [f'<g class="tipnode" data-tip="{tip}" tabindex="0">'] + body + ["</g>"]
    out.append("</svg>")
    return "\n".join(out)


def counts(steps):
    c = {k: sum(1 for s in steps if s["st"] == k) for k in ST}
    return "".join(f'<span class="chip" style="color:{ST[k][1]};border-color:{ST[k][1]}">{ST[k][0]} {c[k]}</span>'
                   for k in ST)


def section(sid, title, steps):
    return (f'<section id="{sid}"><h2>{esc(title)}</h2><p class="chips">{counts(steps)}</p>'
            f'<div class="scroll"><div class="diagram">{render(steps, sid + "-d")}</div></div></section>')


SUM_CSS = """
.sum{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.kpi{border:2px solid var(--line);border-radius:10px;padding:10px 16px;min-width:120px;background:var(--panel)}
.kpi b{display:block;font-size:28px;line-height:1.1} .kpi span{color:var(--dim);font-size:12px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin:4px 0 8px}
.box{border:2px solid var(--line);border-radius:10px;padding:4px 16px;background:var(--panel)}
.box h3{font-size:14px;color:var(--cyan);margin:10px 0 4px} .box ul{margin:0 0 10px;padding-left:18px} .box li{margin:3px 0}
"""

CSS = """
:root{--bg:#0a0f1a;--panel:#101928;--line:#263650;--text:#f3f6fb;--dim:#a7b0bf;--teal:#5eead4;--cyan:#67e8f9;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);
font:14px/1.55 "JetBrains Mono","Cascadia Mono",Consolas,ui-monospace,monospace;
background-image:linear-gradient(rgba(148,170,210,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(148,170,210,.035) 1px,transparent 1px);
background-size:40px 40px}
main{max-width:none;width:100%;box-sizing:border-box;margin:0;padding-inline:16px;padding-block:28px 64px}
h1{font-size:24px;margin:0 0 4px;text-wrap:balance} h2{font-size:18px;margin:40px 0 6px;color:var(--teal)}
.byline,.legend{color:var(--dim);font-size:12.5px} .legend{margin:12px 0 0;display:flex;flex-wrap:wrap;gap:8px 16px}
.chip{display:inline-block;border:1.6px solid;border-radius:5px;padding:0 7px;font-size:12px;font-weight:800;margin-right:8px}
.scroll{overflow-x:auto;border:2px dashed var(--line);border-radius:14px;background:var(--bg)}
.diagram{width:max-content} .diagram svg{display:block}
g.tipnode{cursor:help} g.tipnode:focus{outline:none} g.tipnode:hover rect,g.tipnode:focus rect{filter:brightness(1.3)}
#tip{position:fixed;z-index:50;max-width:440px;pointer-events:none;display:none;background:#0b1220;border:2px solid var(--cyan);
border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 0 14px -2px rgba(103,232,249,.45)}
#tip .th{font-weight:800;font-size:13.5px;margin-bottom:6px} #tip .tk{color:var(--dim);font-weight:700;margin-top:6px}
"""

JS = """
(function(){var tip=document.getElementById('tip');
function show(g,x,y){var d;try{d=JSON.parse(g.getAttribute('data-tip'))}catch(e){return}
tip.textContent='';tip.style.borderColor=d.accent;var h=document.createElement('div');h.className='th';h.style.color=d.accent;
h.textContent=d.id.toUpperCase()+' · '+d.title;tip.appendChild(h);
Object.keys(d).forEach(function(k){if(k==='id'||k==='title'||k==='accent')return;var t=document.createElement('div');t.className='tk';
t.textContent=k;var v=document.createElement('div');v.textContent=d[k];tip.appendChild(t);tip.appendChild(v)});
tip.style.display='block';place(x,y)}
function place(x,y){var w=tip.offsetWidth,h=tip.offsetHeight,X=x+16,Y=y+16;
if(X+w>innerWidth-8)X=Math.max(8,x-w-16);if(Y+h>innerHeight-8)Y=Math.max(8,y-h-16);tip.style.left=X+'px';tip.style.top=Y+'px'}
document.addEventListener('mouseover',function(e){var g=e.target.closest&&e.target.closest('g.tipnode');if(g)show(g,e.clientX,e.clientY)});
document.addEventListener('mousemove',function(e){if(tip.style.display==='block'&&e.target.closest&&e.target.closest('g.tipnode'))place(e.clientX,e.clientY)});
document.addEventListener('mouseout',function(e){var g=e.target.closest&&e.target.closest('g.tipnode');if(g&&!g.contains(e.relatedTarget))tip.style.display='none'});
document.addEventListener('focusin',function(e){var g=e.target.closest&&e.target.closest('g.tipnode');if(g){var r=g.getBoundingClientRect();show(g,r.right,r.top)}});
document.addEventListener('focusout',function(){tip.style.display='none'});
document.addEventListener('keydown',function(e){if(e.key==='Escape')tip.style.display='none'});
})();
"""


def page():
    legend = "".join(f'<span><span class="chip" style="color:{c};border-color:{c}">{l}</span></span>'
                     for l, c, _, _ in ST.values())
    legend += "".join(f'<span style="color:{acc}">■ {a} {b}</span>' for _, a, b, acc, _ in LANES)
    allsteps = NEW + ENH + BUG + MIG
    tot = {k: sum(1 for s in allsteps if s["st"] == k) for k in ST}
    body = ('<!doctype html><html lang="vi"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>DLC Status</title><style>{CSS}{SUM_CSS}</style></head><body><main>'
            '<h1>DLC: trạng thái theo từng bước</h1>'
            '<p class="byline">Cập nhật 2026-10-12 01:30 · rê chuột (hoặc Tab) vào node để xem cần gì, đã có gì, còn cấn gì.</p>'
            '<div class="sum">'
            f'<div class="kpi"><b>{len(allsteps)}</b><span>bước trên 4 flow</span></div>'
            f'<div class="kpi" style="color:{ST["done"][1]}"><b>{tot["done"]}</b><span>xong</span></div>'
            f'<div class="kpi" style="color:{ST["part"][1]}"><b>{tot["part"]}</b><span>còn cấn</span></div>'
            f'<div class="kpi" style="color:{ST["todo"][1]}"><b>{tot["todo"]}</b><span>chưa đụng</span></div>'
            '</div>'
            '<div class="cols"><div class="box"><h3>Đã chạy được</h3><ul>'
            '<li>Cả 3 flow (New System, Enhancement, Bug Fix) chạy thật qua workflow tool: xanh.</li>'
            '<li>Bộ triển khai cho khách (Windows Server): Keycloak (https) + RAG System chỉ cho agent + DLC engine + Frontend mặc định, cài bằng script, đã chạy thử cả chuỗi trên máy build.</li>'
            '<li>Đăng nhập Keycloak cho engine và Frontend; Pause / Resume; worklog + report theo node; nút Start app mở app đã deploy.</li>'
            '<li>Chat ở Frontend: đính kèm .md + "implement" → agent đọc quy tắc trong RAG System, chọn 1 trong 4 flow, chạy và mở panel DLC (New System xanh, $0.29).</li>'
            '<li>Flow 4 Feature Migration (v1 → v2): scan từng repo rồi gộp, tab Migrations trên board, ngân sách riêng, '
            'chờ nhiều giờ; dry e2e xanh (một repo, nhiều repo, ask dừng hỏi → trả lời → xanh).</li>'
            '<li>Target stack: Python, CAP, UI5 TS, React (test thật trên repo CAP mẫu xanh).</li>'
            '<li>Seal không chặn + scan theo phần thay đổi: đã nối (cờ LINE_SEAL / LINE_SCAN_CACHE, mặc định tắt); dry e2e '
            'seal / seal_taint xanh; 655 test.</li>'
            '<li>Feature graph: cây phụ thuộc feature, hỏi lại khi thiếu, build theo thứ tự (chạy thật xanh).</li>'
            '<li>Chế độ hỏi người: ask (gom câu hỏi) hoặc decide (model tự quyết, ghi log).</li>'
            '<li>RAG System: capabilities /v1 đã lên prod 11/10.</li></ul></div>'
            '<div class="box"><h3>Việc bạn cần quyết / làm tiếp</h3><ul>'
            '<li>Triển khai lần đầu trên VPS của khách theo runbook nội bộ, rồi demo 1 flow New System.</li>'
            '<li>Cho DLC dùng RAG System prod (tạo namespace prod) hay giữ dev thêm.</li>'
            '<li>Feature Migration: chạy thật với model trên SMDG V1.7 → 2.0, trước ở build=false (chỉ phân tích), sau đó pilot 1 template.</li>'
            '<li>Migration: overlay riêng cho khách, mức L0 / L1 / L2 có người ký, batch dữ liệu, thứ tự data model → config → code.</li>'
            '<li>Flow #22-24 còn báo success khi run bị escalate (flow #25 đã sửa).</li>'
            '<li>Feature graph còn A5 (lưu graph lên RAG System), A6 (feature tree ở Frontend), A7.</li>'
            '<li>Phase B: POC → MVP → bản chính thức (~57,6h), chưa bắt đầu.</li></ul></div></div>'
            f'<div class="legend">{legend}</div>'
            + section("f-new", "Flow 1: New System", NEW)
            + section("f-enh", "Flow 2: Enhancement", ENH)
            + section("f-bug", "Flow 3: Bug Fix", BUG)
            + section("f-mig", "Flow 4: Feature Migration (v1 → v2)", MIG)
            + f'</main><div id="tip" role="tooltip"></div><script>{JS}</script></body></html>')
    return body


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "AI-SDLC-Status-Report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page())
    print("wrote", out, "nodes", len(NEW), len(ENH), len(BUG), len(MIG))
