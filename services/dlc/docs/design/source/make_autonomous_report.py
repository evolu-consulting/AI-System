"""AI SDLC - autonomous implementation + testing line (local HTML report, neon blueprint style).

    python make_autonomous_report.py [OUT]   default OUT = ../AI-SDLC-Autonomous-Build-Report.html
"""
import html
import os
import sys

from friendly_titles import apply as friendly
from node_internals import NODES
from nodes_vi_a import AGENT_VI, DRIFT_VI, LEARN_VI, READ_VI
from nodes_vi_b import BUG_VI, ENH_VI, NEW_SYS_VI
from nodes_vi_d import MIG_VI
from nodes_vi_c import DAG_VI, TIER_VI
from design_status import LABEL, STATUS
import hardening_a
import hardening_b
from issue_debate_data import GROUPS as ISSUE_GROUPS, ISSUES
from swimlane import VI, render_blocks, render_dag, render_swimlane

LANES = [
    ("human", "01 / Humans (input, board, escalation only)", "#67e8f9", "#0c2b37"),
    ("ctrl", "02 / Control plane (deterministic, no LLM)", "#fdba74", "#2a1c12"),
    ("agent", "03 / Agents (LLM workers)", "#5eead4", "#0c2a2a"),
    ("guard", "04 / Verifiers + reviewers", "#f9a8c4", "#2a1421"),
    ("plat", "05 / Platform (repo, CI, QAS, ingest pool, RAG System)", "#fde68a", "#29230f"),
    ("learn", "06 / Learn (events -> lessons -> served back)", "#c4b5fd", "#1d1a3a"),
]
ACC = {k: (a, f) for k, _, a, f in LANES}


def S(id, title, lane, phase, sub="", tag="", rework=None, mark=None):
    return dict(id=id, title=title, lane=lane, phase=phase, sub=sub, tag=tag, rework=rework, mark=mark)


AUTO = "AUTO"   # an automated gate that replaces a human gate of the earlier flow

# ── 0. the line, generic (Vietnamese, with hover details) ──────────────────
AUTO_VI = "TỰ ĐỘNG"

LANES_VI = [
    ("human", "01 / Con người (input, board, escalate)", "#67e8f9", "#0c2b37"),
    ("ctrl", "02 / Control plane (code, không LLM)", "#fdba74", "#2a1c12"),
    ("agent", "03 / Agent (worker LLM)", "#5eead4", "#0c2a2a"),
    ("guard", "04 / Kiểm tra + review", "#f9a8c4", "#2a1421"),
    ("plat", "05 / Nền tảng (repo, CI, QAS, pool, RAG System)", "#fde68a", "#29230f"),
    ("learn", "06 / Học (event -> bài học -> trả lại)", "#c4b5fd", "#1d1a3a"),
]


def V(id, title, lane, phase, sub, tag, detail, rework=None, mark=None):
    d = S(id, title, lane, phase, sub, tag, rework, mark)
    d["detail"] = detail
    return d


def D(lam, vao, ra, ai, hong, xem):
    return {"Làm gì": lam, "Đầu vào": vao, "Đầu ra": ra, "Ai / cái gì chạy": ai, "Khi hỏng": hong, "Xem thêm": xem}


LINE_VI = [
    V("h0", "Spec Pack đóng băng", "human", "Đầu vào", "tài liệu + yêu cầu, version + hash", "bước người cuối",
      D("Con người nộp bộ tài liệu và yêu cầu đã duyệt; hệ thống khóa lại thành một version có hash.",
        "Blueprint, spec, tài liệu nghiệp vụ, dữ liệu mẫu (đã đúng và đủ).",
        "Spec Pack v1 (chỉ đọc), mã hash dùng để truy vết mọi bước sau.",
        "Con người (BA / PM). Đây là bước cuối cùng con người phải làm trên đường chính.",
        "Thiếu file bắt buộc theo template: không nhận, báo ngay người nộp.", "§1")),
    V("c1", "Nhận việc + ngân sách", "ctrl", "Đầu vào", "ưu tiên, quota, cây ngân sách token", "§7",
      D("Quyết định run có được chạy chưa, ưu tiên bao nhiêu, và cấp ngân sách token / thời gian.",
        "Spec Pack, quota của project, tải hiện tại của các pool.",
        "Run được nhận, cây ngân sách run → F-item → unit, vị trí trong hàng đợi.",
        "Control plane (code). Không dùng LLM.",
        "Hết quota: run chờ trong hàng đợi, board hiển thị 'chờ tài nguyên'; bug critical được chen trước.", "§7")),
    V("p1", "Ingest + tách cấu trúc", "plat", "Hiểu", "cache theo hash, pool parse/OCR", "§3",
      D("Đọc file, OCR, bảng, tách mục; chỉ xử lý phần chưa có trong cache.",
        "File trong Spec Pack.",
        "Văn bản có cấu trúc (mục, bảng, id) gắn vị trí gốc để trích dẫn.",
        "Pool ingest riêng (CPU/GPU, không LLM) + model nhỏ để tách cấu trúc.",
        "File lỗi định dạng: thử parser khác (F1); vẫn lỗi thì báo người nộp đúng file đó.", "§3")),
    V("a1", "Đọc lần 1: tóm tắt spec", "agent", "Hiểu", "mọi ý phải trích đoạn gốc", "§3",
      D("Đọc spec và viết bản tóm tắt: F-item, tiêu chí, dữ liệu, quy tắc, con số. Kèm theo: dò chỗ yêu cầu mới trái với logic hệ thống đang chạy hoặc tự trái nhau trong spec mới (model vừa + truy vấn graph nhiều bước); trái ngược mà spec không nói rõ là thay thế → hỏi người.",
        "Văn bản có cấu trúc + bài học đọc tài liệu theo loại template (RAG).",
        "Bản tóm tắt lần 1, mỗi ý kèm trích dẫn đoạn gốc.",
        "Agent Reader, model mạnh.",
        "Ý không trích được đoạn gốc bị loại ở bước đối chiếu.", "§3")),
    V("a2", "Đọc lại để xác nhận: tóm tắt spec", "agent", "Hiểu", "model khác / prompt khác", "§3",
      D("Đọc độc lập lần hai để bắt chỗ hiểu sai của lần một.",
        "Cùng văn bản như lần 1, nhưng không thấy kết quả lần đọc 1.",
        "Bản đọc xác nhận có trích dẫn.",
        "Agent Reader dùng model hoặc prompt khác với lần 1.",
        "Như Đọc lần 1.", "§3")),
    V("g1", "Đối chiếu + kiểm trích dẫn", "guard", "Hiểu", "so từng trường của hai bản", "§3",
      D("So hai digest theo từng F-item, quy tắc, con số; kiểm mỗi ý có trích đúng đoạn gốc.",
        "Bản tóm tắt lần 1, bản xác nhận, văn bản gốc.",
        "Spec digest đã thống nhất, hoặc danh sách chỗ lệch.",
        "Code (so sánh, kiểm trích dẫn) + model nhỏ để chuẩn hóa cách diễn đạt.",
        "Lệch: đọc lại đúng mục đó kèm bài học (tối đa 2 lần); vẫn lệch thì escalate người với 2 cách hiểu.", "§3"),
      ("a1", "lệch -> đọc lại đúng mục")),
    V("a3", "Viết test chấp nhận", "agent", "Hiểu", "spec chạy được, trước khi code", "§3",
      D("Biến từng tiêu chí chấp nhận thành test chạy được (Given / When / Then).",
        "Spec digest đã thống nhất.",
        "Bộ test acceptance, mỗi test trỏ về F-item và đoạn gốc.",
        "Agent Test Author.",
        "Test sai được bắt ở bước kiểm test vs spec.", "§3")),
    V("g2", "Kiểm test vs spec", "guard", "Hiểu", "đỏ khi chưa có code, truy vết", "§3",
      D("Đảm bảo test có 'răng': chạy trên code rỗng phải đỏ, và mỗi test truy về spec.",
        "Bộ test acceptance, repo hiện tại.",
        "Bộ test được duyệt tự động, khóa cùng Spec Graph.",
        "Code chạy test + kiểm truy vết.",
        "Test xanh trên code rỗng hoặc không truy được: trả lại Test Author.", "§3"),
      ("a3", "không truy vết / xanh khi rỗng")),
    V("a4", "Lập kế hoạch: work graph", "agent", "Kế hoạch", "unit, phụ thuộc, contract, claim", "§4",
      D("Từ spec đã đọc, agent dùng model mạnh tự chia việc thành từng phần nhỏ theo feature; liên kết phụ thuộc giữa các feature được lưu trong graph. Dựa vào graph, nó sắp xếp phần nào làm trước, phần nào làm sau, phần nào chạy song song được vì không phụ thuộc nhau; rồi chuẩn bị contract và claim file cho từng unit đã chia.",
        "Spec Graph + bộ test + cấu trúc repo.",
        "Work graph: unit (≤ 1 phiên, ≤ 8 file), cạnh phụ thuộc, wave.",
        "Agent Planner, model mạnh.",
        "Graph không hợp lệ: bị trả lại ở bước kiểm graph.", "§4")),
    V("c2", "Kiểm graph", "ctrl", "Kế hoạch", "không vòng, cỡ unit, contract trước", "§4",
      D("Thay cho bước 'dev duyệt plan': kiểm graph bằng luật.",
        "Work graph.",
        "Graph hợp lệ, khóa lại để scheduler dùng.",
        "Control plane (code).",
        "Có vòng / unit quá lớn / F-item không có test: lập lại kế hoạch; quá 2 lần thì escalate.", "§4"),
      ("a4", "sai -> lập lại kế hoạch"), AUTO_VI),
    V("c3", "Điều phối unit sẵn sàng", "ctrl", "Xây", "đường găng trước, lease", "§4 §7",
      D("Chỉ phát unit đã đủ phụ thuộc; ưu tiên đường găng; cấp lease có hạn.",
        "Graph + trạng thái unit + ngân sách + năng lực agent đang rảnh.",
        "Unit được giao cho một agent kèm lease, worktree và ngân sách riêng.",
        "Control plane (scheduler), không LLM.",
        "Unit phụ thuộc vào unit hỏng: chuyển 'chờ' chứ không 'fail'; dây chuyền chạy tiếp.", "§4 §7")),
    V("a5", "Builder làm unit song song", "agent", "Xây", "mỗi unit một worktree, sandbox", "§4",
      D("Làm đúng một unit: code + cập nhật test trong phạm vi claim.",
        "Unit, contract, test của unit, bài học theo vai trò + stack (RAG).",
        "Diff trên worktree riêng, tiến độ ghi vào progress.",
        "Agent Builder theo stack (backend / frontend / db / config).",
        "Hết ngân sách unit hoặc mất heartbeat: watchdog dừng, trả unit về hàng đợi, chạy tiếp từ checkpoint.", "§6 §7")),
    V("g3", "Kiểm tra + phát hiện lệch", "guard", "Kiểm", "test, claim, plan vs diff", "§6",
      D("Server tự chạy build và test; kiểm diff nằm trong claim; so ý định unit với diff.",
        "Diff, test của unit, claim.",
        "Đạt, hoặc danh sách lỗi kèm mã lỗi và fingerprint.",
        "Code (verifier) + model nhỏ cho so sánh ý định.",
        "Sửa lại ≤ N lần kèm bằng chứng; cùng lỗi 2 lần thì đổi model hoặc tách unit.", "§6"),
      ("a5", "sửa <= N, rồi đổi agent / tách"), AUTO_VI),
    V("g4", "Review ngữ cảnh sạch", "guard", "Kiểm", "không thấy lịch sử tác giả", "§6",
      D("Đọc lại diff như người ngoài, chỉ với spec và contract.",
        "Diff + spec của unit (không có hội thoại của Builder).",
        "Danh sách lỗi theo mức độ, hoặc đạt.",
        "Agent Reviewer, model khác Builder.",
        "Lỗi nặng: trả Builder sửa; nặng 2 vòng: escalate.", "§6"),
      ("a5", "có lỗi -> sửa"), AUTO_VI),
    V("c4", "Hàng đợi tích hợp + merge", "ctrl", "Tích hợp", "rebase, chạy hợp các bộ test", "§7",
      D("Merge từng unit theo thứ tự; rebase; chạy hợp các bộ test liên quan.",
        "Unit đã qua kiểm, nhánh chính.",
        "Nhánh chính mới, xanh.",
        "Control plane xếp hàng + agent Integrator khi có xung đột.",
        "Xung đột ngữ nghĩa: trả unit sau về sửa; không bao giờ sửa test của bên kia.", "§7"),
      ("a5", "xung đột"), AUTO_VI),
    V("p2", "Deploy QAS (pipeline)", "plat", "Test", "đặt slot, agent không giữ quyền", "§1",
      D("Deploy lên QAS theo chuyến: gom mọi thứ đã xanh trên nhánh chính thành một bản, dựng bên cạnh bản đang chạy (blue/green), smoke qua mới chuyển sang; trong lúc QAS đang được test thì không deploy chen vào.",
        "Bản build xanh của nhánh chính.",
        "QAS chạy đúng version, smoke test xanh.",
        "Pipeline CI/CD (không LLM; agent không có credential).",
        "Deploy lỗi: vẫn ở bản cũ (chưa chuyển), thử lại 1 lần; vẫn lỗi thì escalate.", "§7")),
    V("g5", "QAS: chấp nhận + hồi quy", "guard", "Test", "chạy 3 lần, cách ly test chập chờn", "§1",
      D("Thay cho bước QC chạy SIT: chạy toàn bộ acceptance và regression trên QAS.",
        "QAS đã deploy, bộ test.",
        "F-item nào xanh, F-item nào đỏ kèm bằng chứng.",
        "Code chạy test (QAS Runner).",
        "F-item đỏ: tạo unit Fixer mới cho đúng F-item đó; test chập chờn bị cách ly và báo.", "§1"),
      ("c3", "F-item đỏ -> unit sửa"), AUTO_VI),
    V("h1", "Board: QAS xanh, báo", "human", "Test", "có thể bắt đầu UAT", "§2",
      D("Báo con người khi cả run xanh trên QAS.",
        "Trạng thái F-item từ dòng event.",
        "Thông báo + board; người bắt đầu UAT.",
        "Board (projection của event).",
        "Không áp dụng; thẻ đỏ được báo riêng ngay khi xảy ra.", "§2")),
    V("l1", "Event -> bài học", "learn", "Học", "mã lỗi, token, phiên bản agent", "§8",
      D("Gom event của run, đếm lỗi theo mã, đề xuất bài học, kiểm bằng eval rồi đưa lại theo khóa.",
        "Mọi event của run.",
        "Bài học theo vai trò + bước + stack; số liệu cho board và cải tiến agent.",
        "Distiller (agent) + code đếm + eval.",
        "Bài học không qua eval thì bỏ; không thay đổi gì trên run đang chạy.", "§8")),
]

LINE = [
    S("h0", "Spec Pack frozen", "human", "Input", "docs + requirements, version + hash", "last human step"),
    S("c1", "Admission + budget", "ctrl", "Input", "priority, quotas, token budget tree", "§7"),
    S("p1", "Ingest + extract", "plat", "Understand", "hash cache, parse/OCR pool", "§3"),
    S("a1", "Reader A: spec digest", "agent", "Understand", "every claim cites a span", "§3"),
    S("a2", "Reader B: spec digest", "agent", "Understand", "other model / other prompt", "§3"),
    S("g1", "Reconcile + quote check", "guard", "Understand", "field-by-field diff", "§3",
      ("a1", "disagree -> targeted re-read")),
    S("a3", "Test Author: acceptance tests", "agent", "Understand", "executable spec, before code", "§3"),
    S("g2", "Tests vs spec check", "guard", "Understand", "red on empty impl, trace to F-item", "§3",
      ("a3", "untraced / green on empty")),
    S("a4", "Planner: work graph", "agent", "Plan", "units, deps, contracts, claims", "§4"),
    S("c2", "Validate graph", "ctrl", "Plan", "acyclic, unit size, contracts first", "§4", ("a4", "invalid -> re-plan"),
      AUTO),
    S("c3", "Scheduler: dispatch ready units", "ctrl", "Build", "critical path first, leases", "§4 §7"),
    S("a5", "Builders (parallel units)", "agent", "Build", "worktree per unit, sandbox", "§4"),
    S("g3", "Verifiers + drift checks", "guard", "Verify", "tests, claims, plan-vs-diff", "§6",
      ("a5", "repair <= N, then swap/re-plan"), AUTO),
    S("g4", "Fresh-context reviewer", "guard", "Verify", "no author history", "§6", ("a5", "defects -> fix"), AUTO),
    S("c4", "Integration queue + merge", "ctrl", "Integrate", "rebase, union tests", "§7", ("a5", "conflict"), AUTO),
    S("p2", "Deploy QAS (pipeline)", "plat", "Test", "slot booking, no agent creds", "§1"),
    S("g5", "QAS acceptance + regression", "guard", "Test", "3 reruns, flaky quarantine", "§1",
      ("c3", "red F-item -> fixer unit"), AUTO),
    S("h1", "Board: QAS green, notify", "human", "Test", "UAT can start", "§2"),
    S("l1", "Events -> lessons", "learn", "Learn", "codes, tokens, agent version", "§8"),
]

# ── 3. comprehension ───────────────────────────────────────────────────────
READ = [
    S("r1", "Content-hash cache", "plat", "Ingest", "same file or page = no rework", "resource"),
    S("r2", "Parse / OCR / tables", "plat", "Ingest", "CPU/GPU ingest pool, not LLM", "resource"),
    S("r3", "Structure extract", "agent", "Ingest", "cheap model: sections, tables, ids", "tier: small"),
    S("r4", "Load reading lessons", "learn", "Read", "key = doc template + section", "RAG System"),
    S("r5", "Reader A digest", "agent", "Read", "F-items, acceptance, data, rules + citations", "tier: strong"),
    S("r6", "Reader B digest", "agent", "Read", "different model or prompt", "tier: strong"),
    S("r7", "Quote check", "guard", "Check", "each claim -> exact span", "deterministic", ("r5", "uncited claim")),
    S("r8", "Diff digests", "guard", "Check", "per F-item, per rule, per number", "deterministic",
      ("r5", "disagree -> re-read that section")),
    S("r9", "Acceptance tests", "agent", "Make executable", "Given/When/Then from digest", "Test Author"),
    S("r10", "Tests red on empty impl", "guard", "Make executable", "each test traces to a span", "deterministic",
      ("r9", "fix test")),
    S("r11", "Freeze Spec Graph v1", "ctrl", "Make executable", "hash; builders read only this", "contract"),
    S("r12", "Misread found later -> lesson", "learn", "Learn", "code spec-misread + section", "§8"),
]

# ── 6. drift ladder ────────────────────────────────────────────────────────
DRIFT = [
    S("d1", "Builder works on unit", "agent", "Work", "plan + acceptance tests attached"),
    S("d2", "Heartbeat + progress meter", "ctrl", "Detect", "tests green count, turns, tokens"),
    S("d3", "Signals", "guard", "Detect", "red tests, diff outside claim, plan-vs-diff, said-vs-did"),
    S("d4", "Classify (failure code)", "ctrl", "Classify", "MAST code + fingerprint"),
    S("d5", "Fixer: repair with evidence", "agent", "Respond", "failing test + diff + code", "", ("d3", "re-check")),
    S("d6", "Same fingerprint twice?", "ctrl", "Respond", "split unit / swap model / other agent"),
    S("d7", "Reset unit", "plat", "Respond", "discard worktree, main untouched"),
    S("d8", "Escalate with evidence pack", "human", "Respond", "only this unit blocks; line goes on"),
    S("d9", "Lesson keyed by role + step", "learn", "Learn", "served to the next builder"),
]

# ── 8. learning loop ───────────────────────────────────────────────────────
LEARN = [
    S("e1", "Events", "plat", "Collect", "code, unit, role, agent version, model, tokens"),
    S("e2", "Count in code", "ctrl", "Collect", "rate per code / role / model / stack"),
    S("e3", "Distiller proposes lesson", "agent", "Propose", "keyed: role + step + stack"),
    S("e4", "Eval on golden tasks", "guard", "Prove", "A/B: with vs without lesson", "", ("e3", "no gain -> drop")),
    S("e5", "Confirm inferred cause", "human", "Prove", "only when cause is a guess"),
    S("e6", "Lesson active", "learn", "Serve", "keyed per-step retrieval, no model turn"),
    S("e7", "Recurrence monitor", "ctrl", "Serve", "still recurring after 2 weeks?"),
    S("e8", "Harden: rule or new agent version", "agent", "Harden", "verifier rule or prompt/tool change"),
    S("e9", "Canary + rollout", "ctrl", "Harden", "runs pinned to their version", "", ("e8", "regression -> rollback")),
]

# ── 9. agent lifecycle ─────────────────────────────────────────────────────
AGENT = [
    S("k1", "Write agent definition", "human", "Create", "capability, IO schema, tools, scope, resource class"),
    S("k2", "Register (version)", "ctrl", "Create", "registry routes by capability, never by name"),
    S("k3", "Offline eval: golden tasks", "guard", "Prove", "beats or equals incumbent", "", ("k1", "below bar")),
    S("k4", "Shadow mode", "ctrl", "Prove", "runs beside incumbent, output compared, not used"),
    S("k5", "Canary 5% of units", "ctrl", "Roll out", "only its capability"),
    S("k6", "General (weighted routing)", "ctrl", "Roll out", "N+1 providers per capability"),
    S("k7", "SLO monitor", "guard", "Run", "drift rate, repair rate, cost per unit", "", ("k5", "breach -> auto rollback")),
    S("k8", "Drain", "ctrl", "Retire", "no new units; in-flight finish or hand over by lease"),
    S("k9", "Retire version", "plat", "Retire", "old runs keep their pinned version"),
]

# ── the three flows (implementation + testing only) ───────────────────────
NEW_SYS = [
    S("ns0", "Signed blueprint = Spec Pack", "human", "Input", "all F-items, docs frozen"),
    S("ns1", "Admission + budget tree", "ctrl", "Input", "run -> F-item -> unit caps"),
    S("ns2", "Ingest (cache, pool)", "plat", "Understand", "whole pack, off-peak batch if large"),
    S("ns3", "Readers x2 digest", "agent", "Understand", "per area, with citations"),
    S("ns4", "Reconcile + quote check", "guard", "Understand", "diff field by field", "", ("ns3", "re-read section"), AUTO),
    S("ns5", "Acceptance tests, all F-items", "agent", "Understand", "executable spec"),
    S("ns6", "Tests red, traced", "guard", "Understand", "red on empty impl", "", ("ns5", "fix tests"), AUTO),
    S("ns7", "Architect: skeleton + contracts", "agent", "Plan", "walking skeleton, interfaces, schema"),
    S("ns8", "Skeleton builds, contracts compile", "guard", "Plan", "end to end on DEV", "", ("ns7", "fix skeleton"), AUTO),
    S("ns9", "Planner: work graph", "agent", "Plan", "units for all F-items, waves"),
    S("ns10", "Validate graph + claims", "ctrl", "Plan", "acyclic, size, contracts", "", ("ns9", "re-plan"), AUTO),
    S("ns11", "Schedule waves", "ctrl", "Build", "skeleton -> core domain -> features"),
    S("ns12", "Builders (pool)", "agent", "Build", "parallel within a wave"),
    S("ns13", "Verifiers + drift checks", "guard", "Verify", "server-run tests, claims", "",
      ("ns12", "repair <= N"), AUTO),
    S("ns14", "Fresh reviewer", "guard", "Verify", "no author history", "", ("ns12", "defects"), AUTO),
    S("ns15", "Integration queue", "ctrl", "Integrate", "per wave, union tests", "", ("ns12", "conflict"), AUTO),
    S("ns16", "Deploy QAS", "plat", "Test", "pipeline, booked slot"),
    S("ns17", "Full acceptance + regression", "guard", "Test", "3 reruns, smoke", "", ("ns11", "fixer units"), AUTO),
    S("ns18", "Board: QAS green", "human", "Test", "UAT starts"),
    S("ns19", "Lessons", "learn", "Learn", "reading, planning, building"),
]
ENH = [
    S("en0", "CR + blueprint delta = Spec Pack", "human", "Input", "delta only, frozen"),
    S("en1", "Admission + budget", "ctrl", "Input", "CR size sets budget"),
    S("en2", "Ingest delta only", "plat", "Understand", "changed sections, cache hit rest"),
    S("en3", "Readers x2: delta + impact", "agent", "Understand", "files, tests, contracts touched"),
    S("en4", "Reconcile + impact resolves", "guard", "Understand", "paths exist in repo", "", ("en3", "re-read"), AUTO),
    S("en5", "Delta tests + regression set", "agent", "Understand", "new red, old green"),
    S("en6", "New red / old green", "guard", "Understand", "trace to delta", "", ("en5", "fix tests"), AUTO),
    S("en7", "Planner: units + claims", "agent", "Plan", "smallest change set"),
    S("en8", "Overlap check vs other runs", "ctrl", "Plan", "claim registry", "", ("en7", "serialize / merge owner"),
      AUTO),
    S("en9", "Schedule", "ctrl", "Build", "after blocking runs merge"),
    S("en10", "Builders on branch", "agent", "Build", "hotspot rules: no refactor"),
    S("en11", "Verifiers + scope + drift", "guard", "Verify", "diff inside claim", "", ("en10", "repair <= N"), AUTO),
    S("en12", "Fresh reviewer", "guard", "Verify", "delta vs Spec Pack", "", ("en10", "defects"), AUTO),
    S("en13", "Integration: rebase + union tests", "ctrl", "Integrate", "queue order: hotfix > train", "",
      ("en10", "semantic conflict"), AUTO),
    S("en14", "Deploy QAS slot", "plat", "Test", "booked, shared QAS"),
    S("en15", "Delta acceptance + impacted regression", "guard", "Test", "full suite before release", "",
      ("en9", "fixer units"), AUTO),
    S("en16", "Board: CR green on QAS", "human", "Test", "UAT for the CR"),
    S("en17", "Lessons", "learn", "Learn", "impact misses, conflicts"),
]
BUG = [
    S("bf0", "Confirmed defect = Spec Pack", "human", "Input", "ticket, steps, data, expected"),
    S("bf1", "Admission by severity", "ctrl", "Input", "critical preempts, reserved capacity"),
    S("bf2", "Repro agent", "agent", "Reproduce", "failing script on QAS clone"),
    S("bf3", "Repro fails for stated reason", "guard", "Reproduce", "assert matches ticket", "", ("bf2", "wrong repro"), AUTO),
    S("bf4", "Root-cause analyst", "agent", "Diagnose", "code + RAG System known fixes"),
    S("bf5", "Cause evidence check", "guard", "Diagnose", "log / diff points at cause", "", ("bf4", "new hypothesis"), AUTO),
    S("bf6", "Regression test (fail-before)", "agent", "Fix", "from the repro"),
    S("bf7", "Fixer: minimal diff", "agent", "Fix", "hotfix branch from PRD tag"),
    S("bf8", "Fail-before / pass-after + scope", "guard", "Verify", "minimal diff, no test edits", "",
      ("bf7", "repair <= N"), AUTO),
    S("bf9", "Fresh reviewer", "guard", "Verify", "fix vs cause", "", ("bf7", "defects"), AUTO),
    S("bf10", "Integrate + queue forward-port", "ctrl", "Integrate", "hotfix first in queue"),
    S("bf11", "Deploy QAS (priority slot)", "plat", "Test", "preempts feature tests"),
    S("bf12", "Repro + regression on QAS", "guard", "Test", "3 reruns", "", ("bf4", "still fails"), AUTO),
    S("bf13", "Board: fixed on QAS", "human", "Test", "release decision"),
    S("bf14", "RCA lesson with code", "learn", "Learn", "known fix for next triage"),
]

# ── 4. example work graph ──────────────────────────────────────────────────
A = ACC
DAG_NODES = [
    ("U1", "Contracts: API + schema", "OpenAPI, DB interface, events", "Architect", *A["agent"]),
    ("U2", "DB migration", "credit_limit table + index", "Builder-db", *A["agent"]),
    ("U3", "Backend service", "limit check + API", "Builder-backend", *A["agent"]),
    ("U4", "UI form + validation", "customer screen", "Builder-frontend", *A["agent"]),
    ("U5", "Integration test", "API + DB + UI flow", "Test Author", *A["guard"]),
    ("U6", "Docs + release notes", "only what is done", "Docs agent", *A["learn"]),
]
DAG_EDGES = [("U1", "U2", ""), ("U1", "U3", ""), ("U1", "U4", "contract"), ("U2", "U3", "schema"),
             ("U3", "U5", ""), ("U4", "U5", ""), ("U5", "U6", "")]


def tiers_spec():
    a, g, c, p, l, h = (ACC[k] for k in ("agent", "guard", "ctrl", "plat", "learn", "human"))
    T = {n["id"]: n for n in TIER_VI}
    nodes, boxes, arrows = [], [], []
    boxes.append((30, 40, 1500, 520, "TẦNG 2 / nhiều project song song, chung định nghĩa agent", "#fdba74", True))
    for i, name in enumerate(("Project A (new system)", "Project B (enhancement)", "Project C (bug fix)")):
        x = 60 + i * 490
        boxes.append((x, 90, 450, 440, f"TẦNG 1 / {name}", "#5eead4", True))
        nodes.append((x + 20, 120, 410, 104, "", T["t1"]["title"], T["t1"]["sub"], T["t1"]["tag"], *c))
        for j, k in enumerate(("t2", "t3", "t4")):
            nodes.append((x + 20 + j * 140, 240, 130, 110, "", T[k]["title"], T[k]["sub"], "", *a))
        nodes.append((x + 20, 380, 410, 104, "", T["t5"]["title"], T["t5"]["sub"], T["t5"]["tag"], *p))
    boxes.append((30, 620, 1500, 200, "DÙNG CHUNG / chủ yếu chỉ-đọc, có version, có quota", "#c4b5fd", True))
    shared = [(T["t6"], *c), (T["t7"], *l), (T["t8"], *g), (T["t9"], *p), (T["t10"], *g)]
    for k, (n, acc, fill) in enumerate(shared):
        nodes.append((60 + k * 292, 680, 270, 110, "", n["title"], n["sub"], "", acc, fill))
    for i in range(3):
        x = 60 + i * 490 + 225
        arrows.append(([(x, 530), (x, 670)], "lav", "lấy định nghĩa, bài học, token, CPU" if i == 1 else ""))
    return dict(width=1560, height=850, boxes=boxes, nodes=nodes, arrows=arrows)


def esc(s):
    return html.escape(str(s), quote=True)


def table(head, rows):
    return ("<table><thead><tr>" + "".join(f"<th>{esc(h)}</th>" for h in head) + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table>")


def diagram(svg):
    return f'<div class="diagram">{svg}</div>'


def board():
    cols = ["Read", "Tests", "Plan", "Build", "Verify", "Integrate", "QAS", "Done"]
    cards = {
        "Done": [("F1", "Customer master CRUD", "7/7 units", "ok", "41k / 60k tok")],
        "QAS": [("F2", "Credit limit check", "6/6 units", "ok", "QAS run 2/3")],
        "Integrate": [("F3", "Sales order block", "5/6 units", "amber", "rebase after F2")],
        "Verify": [("F4", "Approval workflow", "3/8 units", "ok", "Reviewer on U4")],
        "Build": [("F5", "Price conditions", "2/9 units", "red", "BLOCKED U3: same failure 2x, escalated"),
                  ("F6", "Export to S/4", "1/5 units", "ok", "Builder-backend on U2")],
        "Plan": [("F7", "Audit log", "graph 0/4", "ok", "Planner")],
        "Tests": [("F8", "Reports", "12 tests", "ok", "Test Author")],
        "Read": [("F9", "Archiving", "digest 2/2", "amber", "readers disagree on rule 4.2")],
    }
    color = {"ok": "#5eead4", "amber": "#fde68a", "red": "#f9a8c4"}
    out = ['<div class="board">']
    for c in cols:
        out.append(f'<div class="bcol"><div class="bhead">{esc(c)}</div>')
        for fid, name, prog, st, now in cards.get(c, []):
            out.append(f'<div class="bcard" style="border-color:{color[st]}"><div class="bid" style="color:'
                       f'{color[st]}">{esc(fid)}</div><b>{esc(name)}</b><div class="dim">{esc(prog)}</div>'
                       f'<div class="bnow">{esc(now)}</div></div>')
        out.append("</div>")
    out.append("</div>")
    return "".join(out)


def sec(sid, title, lead, body):
    return f'<section id="{sid}"><h2>{esc(title)}</h2><p class="lead">{lead}</p>{body}</section>'


KIND_COL = {"CODE": "#fdba74", "LLM": "#5eead4", "NGƯỜI": "#67e8f9"}


def internals(nodes=None, titles=None):
    """Cards explaining how each node works; nodes carry kind/who/steps/rules/example/fail/harden (+ title)."""
    nodes = nodes or NODES
    titles = titles or {x["id"]: x["title"] for x in LINE_VI}
    out = ['<div class="ncards">']
    for n in nodes:
        col = next((c for k, c in KIND_COL.items() if n["kind"].startswith(k)), "#c4b5fd")
        out.append(f'<div class="ncard" id="n-{n["id"]}" style="border-color:{col}">'
                   f'<div class="nh"><b style="color:{col}">{n["id"]}</b> {esc(n.get("title") or titles[n["id"]])}'
                   f'<span class="nk" style="color:{col};border-color:{col}">{esc(n["kind"])}</span></div>'
                   f'<div class="nr"><span>Ai quyết định</span>{esc(n["who"])}</div>'
                   f'<div class="nr"><span>Cơ chế</span><ol>' + "".join(f"<li>{x}</li>" for x in n["steps"]) + "</ol></div>"
                   f'<div class="nr"><span>Luật / công thức</span><ul>' + "".join(f"<li>{esc(x)}</li>" for x in n["rules"])
                   + "</ul></div>"
                   f'<div class="nr ex"><span>Ví dụ</span>{esc(n["example"])}</div>'
                   f'<div class="nr"><span>Khi sai</span>{esc(n["fail"])}</div>'
                   + (f'<div class="nr hd"><span>Tăng cứng (report Issues)</span>{esc(n["harden"])}</div>' if n["harden"] else "")
                   + (('<div class="nr hk"><span>Tăng cứng đã đưa vào design</span><ol>'
                       + "".join(f"<li>{x}</li>" for x in n.get("hsteps", []))
                       + "".join(f"<li>{esc(x)}</li>" for x in n.get("hrules", [])) + "</ol></div>")
                      if n.get("hsteps") or n.get("hrules") else "")
                   + "</div>")
    out.append("</div>")
    return "".join(out)


def tip_of(n):
    return {"Làm gì": n["do"], "Đầu vào": n["inp"], "Đầu ra": n["out"], "Ai / cái gì chạy": n["who"],
            "Khi hỏng": n.get("fail_tip") or n["fail"]}


def steps_vi(nodes):
    """Vietnamese node data (nodes_vi_*) -> swimlane steps with hover details."""
    out = []
    for n in nodes:
        d = S(n["id"], n["title"], n["lane"], n["phase"], n["sub"], n["tag"], n["rework"], n["mark"])
        d["detail"] = tip_of(n)
        out.append(d)
    return out


def node_details(nodes):
    return (f'<details class="nd"><summary>Bên trong từng node ({len(nodes)}): ai quyết định, cơ chế, luật, ví dụ. '
            f'Bấm một node trên hình để mở đúng thẻ.</summary>{internals(nodes)}</details>')

def page():
    L = LANES
    for nodes, group in ((LINE_VI, "line"), (READ_VI, "read"), (DRIFT_VI, "drift"), (LEARN_VI, "learn"),
                         (AGENT_VI, "agent"), (NEW_SYS_VI, "new"), (ENH_VI, "enh"), (BUG_VI, "bug"), (DAG_VI, "dag"),
                         (TIER_VI, "tier")):
        friendly(nodes, group)
    dag_nodes = [(n["id"], n["title"], n["sub"], n["tag"], *ACC[n["lane"]]) for n in DAG_VI]
    by_id = {n["id"]: n for lst in (NODES, READ_VI, DRIFT_VI, LEARN_VI, AGENT_VI, NEW_SYS_VI, ENH_VI, BUG_VI, DAG_VI,
                                     TIER_VI, MIG_VI) for n in lst}
    for mod in (hardening_a, hardening_b):
        for nid, add in mod.ADD.items():
            assert nid in by_id, nid
            by_id[nid].setdefault("hsteps", []).extend(add.get("steps", []))
            by_id[nid].setdefault("hrules", []).extend(add.get("rules", []))
        STATUS.update(mod.STATUS_UPDATE)
    parts = []
    parts.append(sec("s0", "0. Bộ máy trong một hình",
                     "Con người dừng ở <b>Spec Pack đã đóng băng</b>. Từ đó một <b>control plane không dùng LLM</b> "
                     "(state machine, scheduler, ngân sách, watchdog) điều khiển các <b>agent là worker</b>; mọi cổng "
                     "của người cũ được thay bằng cổng tự động (viền vàng TỰ ĐỘNG); người chỉ quay lại khi bị escalate "
                     "hoặc khi QAS xanh. Rê chuột lên node để xem nhanh, <b>bấm vào node</b> để mở chi tiết (ai quyết định, cơ chế, luật, ví dụ).",
                     diagram(render_swimlane(LINE_VI, "d0", LANES_VI, "cổng tự động (thay cổng người)", lang=VI))
                     + '<p class="dim">Rê chuột (hoặc Tab) lên một node để xem chi tiết.</p>'
                     + table(["Nguyên tắc", "Vì sao"], [
                         ["Control plane là code, agent là worker", "Thứ tự, lease, ngân sách, kill không được phụ thuộc vào một model có thể lặp hay bịa (MAST: lỗi thiết kế hệ thống là nhóm lớn nhất)."],
                         ["Spec thành test chạy được TRƯỚC khi code", "Hiểu sai lộ ra thành test đỏ/xanh sai, không phải thành tranh luận."],
                         ["Mọi thứ đi qua event", "Board, watchdog, học ngược đều đọc cùng một dòng event; không ai phải đọc log."],
                         ["Ngân sách cứng ở mọi tầng", "Không agent nào có thể đốt quá phần của unit nó đang làm."],
                         ["Hỏng một unit không dừng dây chuyền", "Unit hỏng bị cô lập (worktree), unit phụ thuộc chờ, phần còn lại chạy tiếp."]])))

    parts.append(sec("s1", "1. Chạy tự động từ Spec Pack tới QAS xanh",
                     "Mỗi cổng là một cổng máy có tiêu chí đo được, kèm một điều kiện "
                     "escalate rõ ràng. Không có cổng nào 'chờ người' trên đường chính.",
                     table(["Cổng tự động (máy kiểm)", "Gọi người khi"], [
                         ["Graph validator: không vòng, unit ≤ 1 phiên và ≤ 8 file, contract trước, mỗi F-item có test", "Graph không hợp lệ sau 2 lần re-plan"],
                         ["Verifier do server chạy + scope guard + drift checks + reviewer sạch", "Không gọi người: hết thang sửa thì model phán xét quyết (§6); người chỉ thấy thẻ đỏ khi chọn lại 3 lần vẫn sai"],
                         ["Pipeline deploy khi integration xanh, đặt slot QAS", "Deploy fail sau rollback + 1 retry"],
                         ["Bộ acceptance (spec chạy được) + regression trên QAS, chạy 3 lần", "Test chập chờn (fail 1/3) quá 2 test, hoặc QAS down quá 30 phút"],
                         ["Board tự cập nhật từ event; ETA từ ngân sách còn lại", "Theo bảng đích escalate (mục 13): spec → người §3, lệch / bài học → model phán xét, hạ tầng → INFRA"]])))

    parts.append(sec("s2", "2. Con người theo dõi ở mức feature, không ở mức code",
                     "Board là một <b>projection của event</b>: mỗi F-item là một thẻ, cột là giai đoạn, màu là sức "
                     "khỏe. Người xem biết feature nào đang ở đâu, agent vai trò gì đang giữ nó, còn bao nhiêu ngân "
                     "sách; chỉ thẻ đỏ mới có nút 'xem evidence pack'.",
                     board() + table(["Trường trên thẻ", "Lấy từ đâu"], [
                         ["Giai đoạn", "event cuối cùng của F-item (state machine)"],
                         ["Units x/y", "work graph: units done / total"],
                         ["Ai đang giữ", "lease hiện tại: vai trò + phiên bản agent (không phải tên model)"],
                         ["Màu", "xanh = chạy; vàng = chờ phụ thuộc hoặc đang tự sửa; đỏ = escalated hoặc vượt ngân sách"],
                         ["Token / ETA", "sổ ngân sách; ETA = tốc độ tiêu hiện tại so với phần còn lại"]])
                     + '<p class="dim">Thông báo chỉ khi: thẻ chuyển đỏ, escalate, F-item xanh trên QAS, cả run xanh. '
                       'Không gửi log, không gửi diff.</p>'))

    parts.append(sec("s3", "3. Agent hiểu đúng tài liệu, và chia tài nguyên khi tải cao",
                     "Tài liệu đúng không có nghĩa agent đọc đúng. Ba lớp chặn: <b>hai người đọc độc lập</b> (model "
                     "hoặc prompt khác nhau) phải ra cùng digest; <b>mỗi khẳng định phải trích đúng đoạn gốc</b>; "
                     "và digest được <b>biến thành test chạy được</b> trước khi có code. Khi sau này phát hiện đọc sai, "
                     "RAG System ghi bài học gắn với loại tài liệu và mục, rồi đưa lại cho người đọc lần sau.",
                     diagram(render_swimlane(steps_vi(READ_VI), "d3", LANES_VI, "-", lang=VI))
                     + "<h3>Yêu cầu trái ngược: với hệ thống đang chạy, và trong chính spec mới</h3>"
                     + '<p class="lead">Con người có thể vô tình chốt hai yêu cầu ngược nhau trên cùng một sản phẩm: '
                       'yêu cầu mới làm hỏng logic đang chạy mà không ai quyết định là sẽ thay thế, hoặc hai đoạn của '
                       'spec mới tự trái nhau. Hai lần đọc vẫn có thể hiểu giống nhau, nên bước so hai bản tóm tắt không '
                       'bắt được. Vì vậy <b>lần đọc 1</b> có thêm bước <b>dò chỗ trái ngược</b>, dùng một model vừa '
                       'nhưng đủ sức tách entity và một graph của hệ thống đang chạy. <b>Lần đọc lại</b> chỉ xác nhận '
                       'cách hiểu của lần 1 nên không gắn khả năng này.</p>'
                     + table(["Thành phần", "Làm gì"], [
                         ["Graph hệ thống đang chạy", "Entity, quy tắc, contract và test đã khóa của các run trước; "
                          "mỗi run xong ghi thêm quy tắc mới và đánh dấu quy tắc đã bị thay thế. Graph thiếu thì không "
                          "dò được, nên việc ghi này là bắt buộc."],
                         ["Tách entity (model vừa)", "Mỗi quy tắc thành bộ (entity, thuộc tính, điều kiện, kết quả, "
                          "câu trích)."],
                         ["Dò cặp nghi vấn (code)", "Truy vấn graph tối đa 3 bước từ entity bị chạm; lấy các quy tắc "
                          "cũ và các đoạn khác trong spec mới cùng chạm một thuộc tính, điều kiện chồng nhau. Chỉ các "
                          "cặp này tới model, nên chi phí nhỏ."],
                         ["Phán xét (model vừa)", "Trái ngược / tương thích / chỉ làm rõ thêm."],
                         ["Có câu thay thế rõ ràng", "Ghi quyết định; quy tắc cũ đánh dấu hết hiệu lực; liệt kê test "
                          "cũ phải đổi. Không hỏi người."],
                         ["Không có câu thay thế", "Dừng riêng F-item đó; gom thành một lượt hỏi người, kèm hai câu "
                          "trích, phần bị ảnh hưởng và 2-4 phương án; câu trả lời thành phụ lục spec."],
                         ["Lưới an toàn nếu vẫn lọt", "Test cũ của hệ thống được chạy lại ở mọi bước kiểm; quy tắc cũ "
                          "bị phá sẽ hiện ra thành test cũ đỏ."]])
                     + '<p class="dim">Ví dụ: hệ thống đang chạy có "đơn vượt hạn mức → chặn". CR mới viết "đơn của '
                       'khách VIP → tự duyệt" mà không nhắc quy tắc cũ. Graph: Đơn hàng → kiểm tín dụng → chặn; VIP '
                       'là một phần của mọi khách → trái ngược, không có câu thay thế → hỏi người với 3 phương án.</p>'
                     + "<h3>Tích lũy kinh nghiệm đọc tài liệu (RAG)</h3>"
                     + table(["Bước", "Làm gì"], [
                         ["Bắt lỗi đọc", "Mã lỗi spec-misread khi: hai digest lệch, test acceptance sai so với đoạn trích, reviewer báo lệch spec, QAS fail mà nguyên nhân truy về digest"],
                         ["Ghi đúng chỗ", "Event mang: loại template, mục, câu gốc, cách hiểu sai, cách hiểu đúng"],
                         ["Thành bài học", "Distiller đề xuất lesson khóa theo (đọc spec, template + mục); chỉ active khi eval chứng minh có lợi"],
                         ["Đưa lại", "Reader nạp lesson theo khóa của mục đang đọc, không tốn lượt model"],
                         ["Giữ chuẩn", "Bộ 'golden specs' (spec cũ + digest đã xác nhận) dùng để eval mỗi phiên bản Reader mới"]])
                     + "<h3>Chia tài nguyên cho xử lý tài liệu</h3>"
                     + table(["Cơ chế", "Hiệu quả"], [
                         ["Cache theo hash nội dung (file, trang)", "Một tài liệu không bao giờ bị xử lý lại; enhancement chỉ xử lý phần đổi"],
                         ["Pool ingest riêng (parse, OCR, bảng) không dùng LLM", "Phần nặng nhất chạy trên CPU/GPU worker, autoscale theo độ dài hàng đợi"],
                         ["Model theo tầng", "Model nhỏ tách cấu trúc; model mạnh chỉ cho diễn giải, và chỉ ở mục bị gắn 'phức tạp'"],
                         ["Hàng đợi ưu tiên + chia đều theo project", "Bug critical > enhancement > new system; mỗi project có trần ingest đồng thời"],
                         ["Bắt đầu sớm", "Ingest chạy ngay khi upload, trước khi run được nhận; pack lớn chạy ngoài giờ cao điểm"]])))

    parts.append(sec("s4", "4. Agent nào làm gì, theo thứ tự nào",
                     "Planner biến Spec Graph thành <b>work graph</b>: unit nhỏ (≤ 1 phiên, ≤ 8 file), có phụ thuộc, "
                     "có claim file, và <b>contract đi trước</b> để các builder song song không ra quyết định ngầm "
                     "mâu thuẫn. Control plane (không phải LLM) chỉ phát unit nào đã đủ phụ thuộc, ưu tiên đường găng.",
                     diagram(render_dag(dag_nodes, DAG_EDGES, "d4", tips={n["id"]: tip_of(n) for n in DAG_VI}))
                     + '<p class="dim">Ví dụ F2 "Credit limit check": wave 0 chốt contract, wave 1 chạy song song DB / '
                       'UI, backend chờ schema, test tích hợp chờ cả hai.</p>'
                     + table(["Agent", "Làm gì", "Vào → ra", "Model", "Song song"], [
                         ["Reader (x2)", "Digest spec có trích dẫn", "Spec Pack → digest", "mạnh, khác nhau", "theo mục"],
                         ["Test Author", "Acceptance + regression test (+ bộ holdout do provider khác viết)", "câu gốc đã trích → test đỏ", "mạnh", "theo F-item"],
                         ["Architect", "Skeleton, contract, schema", "digest → contracts", "mạnh", "1 / run"],
                         ["Planner", "Work graph + claim", "spec + contracts → graph", "mạnh", "1 / run"],
                         ["Builder-backend / frontend / db / config", "Làm một unit", "unit → diff", "trung bình", "theo unit"],
                         ["Fixer", "Sửa theo evidence", "test đỏ + diff → diff", "mạnh", "theo unit"],
                         ["Reviewer", "Đọc lại không ngữ cảnh tác giả", "diff + spec → findings", "khác Builder", "theo unit"],
                         ["Integrator", "Merge, giải xung đột", "branches → main", "mạnh", "1 / repo (hàng đợi)"],
                         ["Deployer, QAS Runner, Verifier", "Pipeline, test, kiểm tra", "—", "không LLM", "theo slot"],
                         ["Distiller", "Biến event thành lesson", "events → lessons", "trung bình", "nền"],
                         ["Model phán xét", "Quyết thay người khi hết thang sửa (§6) và khi chốt bài học / luật cứng (§8)",
                          "gói bằng chứng + lịch sử quyết định → quyết định có kết quả kỳ vọng", "mạnh nhất, khác model "
                          "đã làm", "theo ca"]])
                     + table(["Quy tắc của scheduler", "Tác dụng"], [
                         ["Chỉ phát unit có mọi phụ thuộc xanh", "Không gãy vì làm trước khi đủ đầu vào"],
                         ["Unit phụ thuộc vào unit hỏng: trạng thái 'chờ', không phải 'fail'", "Một unit hỏng không đổ dây chuyền"],
                         ["Đường găng ưu tiên, rồi tới unit mở khóa nhiều unit khác", "Run kết thúc sớm nhất"],
                         ["Contract đổi → các unit dùng nó bị đánh dấu stale và chạy lại verifier", "Không ai làm tiếp trên contract cũ"]])))

    parts.append(sec("s6", "6. Agent lệch mục tiêu hoặc làm sai mà không crash",
                     "Không crash là trường hợp nguy hiểm nhất. Mỗi unit mang theo <b>ý định + test acceptance</b> "
                     "của nó; lệch được phát hiện bằng tín hiệu máy, không bằng lời agent. Phát hiện xong thì leo một "
                     "thang cố định, và chỉ unit đó dừng. Hết thang thì <b>không gọi người</b>: model mạnh nhất phán "
                     "xét, và lần chạy sau chấm quyết định đó (luật ở mục 8). Tài liệu đã chốt, nên khi agent làm khác "
                     "spec (ví dụ tự thêm popup sau khi login), model đọc spec từ graph và tự phân định đúng sai. Chỉ khi "
                     "spec thật sự thiếu (lọt khỏi mục 3) thì ca đó quay về mục 3 cho người chốt.",
                     diagram(render_swimlane(steps_vi(DRIFT_VI), "d6", LANES_VI, "-", lang=VI))
                     + table(["Tín hiệu", "Cách đo", "Bắt được (MAST)"], [
                         ["Test của unit không đỏ→xanh", "Verifier do server chạy", "làm sai spec, kiểm tra thiếu"],
                         ["Diff ra ngoài claim / sửa test có sẵn", "So diff với claim và danh sách test", "lệch nhiệm vụ, 'hăng quá'"],
                         ["Plan-vs-diff", "Reviewer sạch so tóm tắt diff với ý định unit", "lệch mục tiêu"],
                         ["Nói-vs-làm", "So kế hoạch agent tự khai với tool call thật", "reasoning-action mismatch (13,2%)"],
                         ["Không tiến triển", "Số test xanh không tăng sau N lượt", "lặp bước (15,7%)"],
                         ["Báo xong sớm", "Còn test đỏ hoặc mục acceptance chưa có test", "kết thúc sớm"]])))

    parts.append(sec("s7", "7. Hai tầng: nhiều agent trên một resource, nhiều project dùng chung định nghĩa agent",
                     "Tầng 1 là các agent của một run cùng sửa một repo; tầng 2 là nhiều run của nhiều project dùng "
                     "chung định nghĩa agent, lesson, model gateway và pool máy. Chỉ phần dùng chung là chỉ-đọc hoặc "
                     "có quota; mọi thứ có thể ghi đều nằm trong project.",
                     diagram(render_blocks(tiers_spec(), "d7", tips={n["title"]: {"_id": n["id"], **tip_of(n)} for n in TIER_VI}))
                     + table(["Vấn đề", "Tầng 1 (cùng resource)", "Tầng 2 (nhiều project)", "Mặc định đề xuất"], [
                         ["Xung đột đọc/ghi", "Worktree riêng mỗi unit; claim file/symbol; If-Match trên artifact; merge qua hàng đợi", "Không chia sẻ gì có thể ghi; định nghĩa agent chỉ-đọc, có version; lesson chỉ thêm qua cổng", "claim hết hạn 30 phút nếu không gia hạn"],
                         ["Đồng bộ thông tin", "Event bus theo resource đã claim; contract đổi → unit liên quan stale; kiểm version trước commit", "Run gắn version định nghĩa + lesson lúc bắt đầu; thay đổi áp dụng ở phiên kế", "không đổi giữa phiên"],
                         ["Token", "Cây ngân sách run → F-item → unit → phiên; model rẻ cho việc máy móc; cache prompt; context có trần", "Quota theo project; chia đều; cảnh báo 80%, dừng cứng 100%", "unit: trần token và trần lượt"],
                         ["Máy chủ", "Pool theo loại (LLM, CI, ingest); trần song song mỗi run", "Weighted fair queuing; bulkhead mỗi project; dành sẵn capacity cho bug critical; autoscale theo hàng đợi", "≥ 20% CI giữ cho hotfix"],
                         ["Agent bị kẹt", "Heartbeat 60 s; lease 5 phút; watchdog kill, trả unit về hàng đợi, chạy tiếp từ checkpoint", "Watchdog dùng chung, quarantine unit sau 3 lần", "3 lần → người"],
                         ["Agent lặp vô hạn", "Ngắt khi: cùng tool call + tham số ≥ 3 lần, cùng fingerprint lỗi ≥ 2, sửa qua lại A→B→A, không tiến triển N lượt, chạm trần token/lượt", "Theo dõi tốc độ đốt token của project so với nền; vượt → throttle", "ngắt = snapshot + event FM-1.3"]])
                     + "<h3>Deploy theo chuyến: QAS không bị deploy liên tục</h3>"
                     + '<p class="lead">Khi máy đủ mạnh để chạy nhiều pool song song, mỗi pool xong một phần lại kích '
                       'hoạt CD; nếu deploy ngay mỗi lần gộp code thì service trên QAS bị deploy lại liên tục, không '
                       'lúc nào đứng yên đủ lâu để test, và có thể không bao giờ live. Cách xử lý: <b>gộp code</b> vẫn '
                       'chạy liên tục, nhưng <b>deploy lên QAS chỉ theo khung giờ cố định</b>, trừ khi người ra lệnh hoặc '
                       'task urgent; có khóa, và không làm tắt bản đang chạy.</p>'
                     + table(["Cơ chế", "Làm gì", "Ngưỡng mặc định"], [
                         ["Tách gộp code khỏi deploy", "Pool gộp vào nhánh chính bất cứ lúc nào; CD không tự deploy "
                          "QAS sau mỗi lần gộp", "-"],
                         ["Môi trường preview cho từng pool", "Mỗi pool test trên môi trường tạm riêng (container, "
                          "namespace riêng, dữ liệu seed riêng) trên máy chủ; chỉ chuyến đã tích hợp mới lên QAS",
                          "xóa sau 24 giờ không dùng"],
                         ["Chỉ deploy theo khung giờ cố định", "Tới giờ, gom mọi thứ đã xanh trên nhánh chính thành "
                          "một chuyến; không có gì mới xanh thì bỏ qua chuyến đó. Ngoài khung giờ không có deploy tự "
                          "động nào", "10:00, 13:00, 16:00, 22:00; mỗi project cấu hình riêng"],
                         ["Ngoại lệ 1: người ra lệnh", "Người có quyền (dev lead, QA lead) bấm deploy ngoài giờ; lệnh "
                          "ghi lại ai, lúc nào, lý do. Vẫn đi qua pipeline, blue/green, và đợi lần test đang chạy tới "
                          "điểm dừng, trừ khi người đó chọn cắt ngang", "mọi lệnh đều có log"],
                         ["Ngoại lệ 2: task urgent", "Chỉ ticket có mức urgent do người gắn mới được chen; agent không "
                          "được tự nâng mức ưu tiên. Chuyến urgent chỉ chở đúng thay đổi đó, trên nền bản đang chạy",
                          "chen trong ≤ 15 phút"],
                         ["Gộp yêu cầu đang chờ", "Có 5 yêu cầu deploy đang chờ thì chỉ deploy bản mới nhất, vì nó "
                          "đã chứa 4 bản trước", "luôn bật"],
                         ["Khóa QAS trong lúc test", "Deploy xong, QAS đứng yên tới khi acceptance + hồi quy (3 lần) "
                          "chạy xong; yêu cầu mới phải xếp hàng", "≥ thời gian chạy test, tối thiểu 45 phút"],
                         ["Blue / green", "Dựng bản mới bên cạnh bản đang chạy; smoke qua mới chuyển traffic; lỗi "
                          "thì giữ bản cũ, service không lúc nào tắt", "smoke trong 5 phút"],
                         ["Đo", "Thời gian QAS live liên tục, số deploy / ngày, thời gian chờ chuyến",
                          "cảnh báo khi QAS live < 80% giờ làm việc"]])))

    parts.append(sec("s8", "8. Bộ máy tự học từ chính lỗi của nó",
                     "Học có bốn nấc và không nhảy cóc: <b>đếm bằng code</b> → <b>đề xuất bài học</b> → "
                     "<b>chứng minh bằng eval</b> → <b>đưa lại theo khóa</b>; bài học không làm lỗi giảm thì bị "
                     "nâng cấp thành luật cứng hoặc phiên bản agent mới, qua canary. <b>Không có người trong vòng "
                     "này</b>: chỗ trước đây cần người quyết thì nay model mạnh nhất quyết, và mọi quyết định được các "
                     "run sau chứng thực bằng kết quả thật.",
                     diagram(render_swimlane(steps_vi(LEARN_VI), "d8", LANES_VI, "-", lang=VI))
                     + "<h3>Model phán xét thay người (dùng ở mục 6 và mục 8)</h3>"
                     + table(["Luật", "Vì sao"], [
                         ["Dùng model mạnh nhất đang có, khác model đã làm / đã đề xuất", "Không tự chấm bài của mình; "
                          "đợi người vừa chậm vừa chưa chắc tốt hơn"],
                         ["Mỗi quyết định là một giả thuyết có kết quả kỳ vọng đo được và hạn chấm", "Để run sau chấm "
                          "được đúng / sai; không đo được thì không được bật"],
                         ["Run sau chấm; sai thì tự quay lại và ghi 'quyết định sai' vào lịch sử", "Lần sau gặp ca giống, "
                          "model thấy mình đã sai ở đâu; sai vài lần thì tự hội tụ"],
                         ["Không quyết định nào được nới lỏng guard an toàn, sửa test đã khóa, hay đụng credential",
                          "Luật này nằm trong code; một quyết định sai không thể tắt chính cơ chế bắt sai"],
                         ["Quyết mọi chuyện mà spec đã chốt trả lời được (agent làm khác spec, cách làm kỹ thuật, bài "
                          "học); spec thật sự thiếu thì quay về mục 3", "Spec đã chốt là trọng tài; ý định nghiệp vụ mà "
                          "spec chưa nói thì không suy ra được từ dữ liệu chạy"],
                         ["Đo độ chính xác của model phán xét theo tháng (% quyết định được chấm đúng)", "Tụt dưới mức "
                          "nền → đổi model hoặc phiên bản qua canary (mục 9)"]])
                     + table(["Đo", "Ý nghĩa"], [
                         ["Tỉ lệ mỗi mã lỗi trên 100 unit, theo tuần", "Mục tiêu roadmap: lỗi lặp cùng loại -50% sau 3 tháng"],
                         ["% unit qua verifier lần đầu", "Chất lượng build tăng dần"],
                         ["Token trên mỗi unit xanh", "Hiệu quả chi phí"],
                         ["% lesson qua eval", "Distiller có tạo bài học thật hay không"]])))

    parts.append(sec("s9", "9. Thêm agent mới, gỡ agent cũ mà dây chuyền không dừng",
                     "Scheduler giao việc theo <b>năng lực</b>, không theo tên agent; mỗi năng lực có ít nhất hai "
                     "nhà cung cấp (N+1). Agent mới đi qua eval → shadow → canary; agent cũ được drain chứ không bị "
                     "rút đột ngột; run đang chạy giữ phiên bản nó bắt đầu.",
                     diagram(render_swimlane(steps_vi(AGENT_VI), "d9", LANES_VI, "-", lang=VI))
                     + table(["Blast radius", "Cách giữ"], [
                         ["Năng lực còn 0 nhà cung cấp", "Gỡ bị chặn; nếu bắt buộc, unit của năng lực đó vào hàng người"],
                         ["Unit đang chạy của agent bị gỡ", "Drain: hoàn tất, hoặc checkpoint rồi lease hết hạn để agent khác nhận"],
                         ["Phiên bản mới làm hỏng", "SLO vượt → tự quay về phiên bản trước; run cũ không bị ảnh hưởng"],
                         ["Thay đổi hợp đồng vào/ra của agent", "Version mới của schema; agent cũ và mới chạy song song tới khi không còn run dùng bản cũ"]])))

    parts.append(sec("flows", "4 flow: implementation + testing, và migration",
                     "Cùng một bộ máy, khác nhau ở đầu vào và ở những gì được kiểm thêm.", ""))
    for cid, title, steps, lead, rows in (
        ("f-new", "Flow 1 — New system", NEW_SYS_VI,
         "Toàn bộ F-item; có bước <b>walking skeleton + contracts</b> trước khi chia việc, và chạy theo wave.",
         [["Thêm skeleton + contract", "Builder song song không quyết định ngầm khác nhau"],
          ["Chạy theo wave", "Core domain xong trước mới làm feature dùng nó"],
          ["Full acceptance + regression trên QAS", "QAS xanh = mọi F-item xanh"]]),
        ("f-enh", "Flow 2 — Enhancement", ENH_VI,
         "Chỉ phần delta; thêm <b>impact phải resolve được trong repo</b>, <b>overlap check</b> với các run khác, "
         "và integration rebase + chạy hợp hai bộ test.",
         [["Ingest delta", "Không xử lý lại tài liệu cũ"],
          ["Test: mới đỏ, cũ xanh", "Không phá chức năng đang chạy"],
          ["Overlap check (claim)", "Hai CR không cùng sửa một chỗ mà không biết"]]),
        ("f-bug", "Flow 3 — Bug fix", BUG_VI,
         "Bắt đầu bằng <b>repro chạy được</b>; nguyên nhân phải có bằng chứng; fix tối thiểu; ưu tiên tài nguyên.",
         [["Repro fail đúng lý do", "Không sửa nhầm lỗi khác"],
          ["Bằng chứng nguyên nhân", "Không sửa triệu chứng"],
          ["Capacity giữ sẵn + slot QAS ưu tiên", "Bug critical không chờ feature"]]),
        ("f-mig", "Flow 4 — Feature migration (v1 → v2 viết lại)", MIG_VI,
         "Khách đang dùng v1 chuyển sang v2 viết lại hoàn toàn nhưng cùng tính năng nghiệp vụ. Migrate theo "
         "<b>tính năng</b>, không theo source: kiểm kê hai bên, ma trận parity 4 loại, quyết định khi trái nhau, "
         "blast radius, rồi build phần thiếu như một Enhancement trên v2 và kiểm không hồi quy. "
         "<b>Trạng thái:</b> đã code, dry e2e xanh (một repo và nhiều repo), board có tab Migrations; "
         "chưa chạy với model thật trên dự án thật.",
         [["Scan từng repo rồi gộp", "Estate nhiều repo (vd 48 repo của SMDG V1.7) không bao giờ scan một lần"],
          ["Vòng xác nhận trước khi gọi là thiếu", "Diff thô báo thừa (lần scan tay trước: +26% entity)"],
          ["Ma trận 4 loại + cờ custom", "v1_only migrate · v2_only bảo vệ · both_same kiểm · both_conflict quyết định"],
          ["ask dừng trước khi sửa · decide giữ v2 + backup + log", "Người chọn khi trái nhau, hoặc tự động có đối chiếu"],
          ["Blast radius: UNKNOWN = có ảnh hưởng, gate, merge rủi ro cao", "Không làm hỏng tính năng đang sống của v2"],
          ["Baseline + PARITY_REGRESSION", "Test v2 xanh trước mà đỏ sau là lỗi"],
          ["Ngân sách riêng (50 USD, 3 USD mỗi repo) + chờ nhiều giờ", "Dừng chờ câu hỏi không giữ flow; resume sau khi nâng trần"]])):
        parts.append(sec(cid, title, lead, diagram(render_swimlane(steps_vi(steps), cid, LANES_VI, "cổng tự động (thay cổng người)", lang=VI))
                         + table(["Khác biệt", "Để làm gì"], rows)))

    parts.append(sec("s16", "16. Target stack: không chỉ Python",
                     "Dây chuyền build và test theo stack của repo đích, tự nhận theo package.json / ui5.yaml "
                     "(LINE_STACK=auto). Python giữ nguyên như trước.",
                     table(["Stack", "Nhận diện", "Chạy test", "Trạng thái"], [
                         ["python-unittest", "mặc định", "python -m unittest", "chạy thật, như cũ"],
                         ["node-cap", "@sap/cds", "jest / mocha qua node_modules của repo, kết quả từng test",
                          "test chạy thật trên repo CAP mẫu xanh"],
                         ["node-ui5-ts", "ui5.yaml, @ui5/*", "runner của repo (jest / vitest / mocha)",
                          "chưa có test UI trình duyệt (OPA5 / wdi5)"],
                         ["react", "react", "jest / vitest", "như trên"]])
                     + '<p class="dim">Stack được dùng ở test author, kiểm test (đỏ khi rỗng), verifier, merge queue, QAS, '
                       'quyền tool của builder, và baseline / verify của Flow 4. New system trên Node phải đặt LINE_STACK vì '
                       'repo rỗng được nhận là Python. Mỗi worktree cài npm ci --prefer-offline; lần đầu cần mạng.</p>'))

    parts.append(sec("s17", "17. Seal không chặn + scan theo phần thay đổi",
                     "Khi lưu lượng cao, mọi hệ thống seal liên tục. Seal giữ agent làm đúng nhưng không được thành nút "
                     "cổ chai, và source không được scan lại toàn bộ sau mỗi seal.",
                     "<h3>Seal (sổ chỉ ghi thêm)</h3>"
                     + table(["Luật", "Để làm gì"], [
                         ["Gate đóng băng trước khi build, do người khác builder duyệt", "Không đổi luật giữa chừng"],
                         ["Người chấm khác builder; điểm = Purpose × Evidence × Love (nhân, có số 0 là 0), seal khi ≥ 90, "
                          "bắt buộc mục docked", "Không tự chấm, không che điểm yếu"],
                         ["Bằng chứng = lệnh thật có output và exit code", "Lỗi số 1 là sửa mà không kiểm"],
                         ["Đã seal không sửa; sai thì thêm entry mới (correction / void), chuỗi có hash",
                          "Không rollback âm thầm"],
                         ["L0 tự động · L1 xem sau, không chặn · L2 người ký, chỉ chặn đúng item đó; không rõ ảnh hưởng = L2",
                          "Chỉ chặn chỗ thật sự rủi ro"]])
                     + "<h3>Tài nguyên chưa seal (kiểu MVCC)</h3>"
                     + table(["Luật", "Để làm gì"], [
                         ["Mỗi resource 1 người ghi, lease có fencing", "Không hai agent sửa cùng chỗ"],
                         ["Đọc mặc định bản đã seal", "Không bị ảnh hưởng bởi thứ đang dở"],
                         ["Đọc bản pending phải khai báo; chỉ seal sau khi nguồn đã seal", "Đầu cơ có kiểm soát"],
                         ["Gắn vào contract đã đóng băng thì không tạo phụ thuộc", "Sửa implementation không kéo dây chuyền"],
                         ["Seal trượt: mọi thứ dựng trên nó bị tainted và làm lại; độ sâu đầu cơ tối đa 2",
                          "Hỏng có giới hạn, không lọt vào bản đã seal"],
                         ["Governor tắt đầu cơ khi tỉ lệ seal trượt gần đây > 20%", "Không đốt công build khi seal hay trượt"]])
                     + "<h3>Scan theo phần thay đổi</h3>"
                     + '<p>Cache theo hash nội dung từng file (cùng nội dung chỉ trích xuất 1 lần cho mọi repo và mọi người '
                       'đọc); graph = snapshot gốc + 1 lớp mỗi commit, trả lời "tại commit X"; mỗi batch chỉ đọc lại file nó '
                       'đụng đã đổi; scan lại được gộp, mỗi repo 1 lần tại một thời điểm. Builder giao cho người chấm rồi đi '
                       'tiếp; chấm theo đường găng trước.</p>'
                     + "<h3>Đo bằng mô phỏng (5 seed) và git thật</h3>"
                     + table(["Tình huống", "Cũ: xong / chờ p95", "Mới: xong / chờ p95", "File phải scan"], [
                         ["Tải cao, 0% seal trượt", "443 / 174", "247 / 36", "12000 → 160"],
                         ["Tải cao, 30% seal trượt", "580 / 323", "304 / 106", "12000 → 160"],
                         ["Tải rất cao, 30% seal trượt", "537 / 392", "261 / 152", "12000 → 161"],
                         ["Git thật, 1500 file, 10 commit", "14984 file / 1,86 s", "28 file / 0,31 s",
                          "kết quả tại từng commit khớp 100%"]])
                     + '<p class="dim">Bất biến giữ ở mọi lần chạy: không seal nào dựa trên seal trượt, không hai người ghi '
                       'một chỗ, đã seal không sửa. Scan theo phần thay đổi + seal không đồng bộ là lợi rõ; đầu cơ là đánh đổi: '
                       'seal ít trượt thì nhanh thêm 36%, seal trượt 30-50% thì vẫn xong sớm hơn 11-21% nhưng tốn thêm 28-42% '
                       'công build (governor lấy lại). <b>Trạng thái:</b> đã nối vào dây chuyền sau cờ LINE_SEAL / '
                       'LINE_SCAN_CACHE (mặc định tắt); dry e2e seal và seal_taint xanh; chưa chạy với model thật; người chấm '
                       'là reviewer hoặc bộ chấm theo kết quả gate, chưa có model riêng chấm Purpose.</p>'))

    parts.append(sec("s10", "Thứ tự xây",
                     "Làm theo thứ tự mà mỗi bước đo được bước sau.",
                     table(["#", "Việc", "Điểm", "Dựa trên"], [
                         ["1", "Event schema có mã lỗi + board projection", "§2 §8", "kho event của RAG System"],
                         ["2", "Watchdog + cây ngân sách + loop breaker", "§7", "lease của RAG System"],
                         ["3", "Reader x2 + quote check + acceptance test trước code", "§3", "tra theo bước, theo khóa"],
                         ["4", "Planner + validator + scheduler + claim", "§4", "registry claim, hàng tích hợp"],
                         ["5", "Drift checks + thang xử lý", "§6", "verifier, reviewer sạch (report guards)"],
                         ["6", "Agent registry + shadow + canary", "§9", "danh tính agent của RAG System"],
                         ["7", "Eval golden tasks cho lesson và phiên bản agent", "§8", "bộ đo eval"]])))
    est_rows = [  # (#, block, size class, hours, in MVP); hours = measured standard days x 8
        ("1", "Event schema + mã lỗi + API cho board", "vừa, schema mới", 10.4, True),
        ("2", "State machine run/unit, cây ngân sách, đếm token qua gateway, hàng đợi + quota", "tooling + feature", 26.4, True),
        ("3", "Lease + fencing epoch + heartbeat + watchdog + ngắt vòng lặp", "feature", 16, True),
        ("4", "Reconciler + bộ chaos test", "tooling", 16, False),
        ("5", "Phân loại input (parse / OCR / bảng, cache theo hash, gỡ chữ ẩn)", "tooling", 16, True),
        ("6", "Đọc lần 1 / đọc lại + kiểm trích dẫn + so hai bản", "feature", 16, True),
        ("7", "Checklist khe trống + Sổ giả định + hỏi người một lượt + phụ lục có version", "feature", 10.4, False),
        ("8", "Dò chỗ trái ngược (tách entity, graph hệ thống, truy vấn nhiều bước)", "LLM mới + graph", 24, False),
        ("9", "Viết test trước + kiểm test (đỏ khi rỗng, burn-in, holdout)", "feature", 16, True),
        ("10", "Chia việc + soát graph + scheduler (wave, đường găng)", "feature", 26.4, True),
        ("11", "Sandbox / worktree cho builder + proxy công cụ + lối thoát BLOCKED", "tooling", 16, True),
        ("12", "Verifier mở rộng (build/test, scope, toàn vẹn test, SAST/SCA/dependency/secret/trùng lặp)", "tooling + feature", 21.6, True),
        ("13", "Reviewer ngữ cảnh sạch + lọc nhiễu", "vừa", 5.2, False),
        ("14", "Tín hiệu lệch + thang xử lý + model phán xét (sổ quyết định, run sau chấm, rollback)", "LLM mới", 20.8, False),
        ("15", "Hàng gộp code (rebase, chạy mọi acceptance, lô + chia đôi)", "feature", 10.4, True),
        ("16", "Deploy theo khung giờ, làn urgent, lệnh người, blue/green, khóa QAS, preview env", "tooling + feature", 26.4, True),
        ("17", "Chạy test QAS 3 lần + xử lý test chập chờn + tạo unit Fixer", "feature", 10.4, True),
        ("18", "Vòng học: Distiller, eval / holdout (dùng lại bộ đo eval sẵn có), model phán xét, canary", "LLM mới", 20.8, False),
        ("19", "Danh bạ agent + chạy thử song song / canary + theo dõi SLO", "feature", 16, False),
        ("20", "Trường quan sát + chi phí theo F-item + chỉ số kết quả", "vừa", 5.2, False),
    ]
    total_h = sum(r[3] for r in est_rows)
    mvp_h = sum(r[3] for r in est_rows if r[4])

    def hrs(h):
        return f'<span class="hh" data-h="{h}">{h:g} giờ</span>'.replace(".", ",")

    def hd(h, h2=None):  # hours + a day figure that follows the 8h / 24h switch
        lo = f'<span class="hday" data-h="{h}"></span>'
        if h2 is None:
            return f'{hrs(h)} <span class="dim">(≈ {lo})</span>'
        hi = f'<span class="hday" data-h="{h2}"></span>'
        return f'{h:g}-{h2:g} giờ <span class="dim">(≈ {lo} - {hi})</span>'.replace(".", ",")

    switch = ('<p class="hswitch">Quy đổi giờ sang ngày theo: '
              '<label><input type="radio" name="hpd" value="8" checked> 8 giờ / ngày (người làm, người duyệt)</label> '
              '<label><input type="radio" name="hpd" value="24"> 24 giờ / ngày (agent chạy liên tục)</label></p>'
              '<script>(function(){function upd(){var r=document.querySelector(\'input[name="hpd"]:checked\');'
              'var d=r?+r.value:8;document.querySelectorAll(".hday").forEach(function(e){var v=+e.getAttribute("data-h")/d;'
              'e.textContent=(Math.round(v*10)/10).toString().replace(".",",")+" ngày"})}'
              'document.addEventListener("change",function(e){if(e.target.name==="hpd")upd()});'
              'document.addEventListener("DOMContentLoaded",upd);upd()})();</script>')
    # Mode B (fully autonomous) per the measured standard v2.1: base minutes per planned hour, then buffers.
    FOUND = {"1", "2", "3"}                       # shared foundation blocks: 0.6 min / planned h
    F_ORCH, F_NET, F_RISK = 1.25, 1.30, 1.20      # orchestration + review, network lag, other risks
    FACTOR = F_ORCH * F_NET * F_RISK
    FACTOR_S = str(round(FACTOR, 2)).replace('.', ',')
    PAR = 3                                       # independent modules running at once
    PILOT = (40, 80)                              # planned hours of real-environment integration (pilot)

    def base_min(rows):
        found = sum(h for n, _, _, h, _ in rows if n in FOUND) * 0.6
        code = sum(h for n, _, _, h, _ in rows if n not in FOUND) * 1.0
        return found, code

    def mode_b(rows, pilot_h):
        found, code = base_min(rows)
        integ = pilot_h * 4.0
        agent_h = (found + code + integ) * FACTOR / 60
        wall_h = (found + code / PAR + integ) * FACTOR / 60
        return round(agent_h, 1), round(wall_h, 1)

    mvp_rows = [r for r in est_rows if r[4]]
    all_lo, all_hi = mode_b(est_rows, PILOT[0]), mode_b(est_rows, PILOT[1])
    mvp_lo, mvp_hi = mode_b(mvp_rows, PILOT[0]), mode_b(mvp_rows, PILOT[1])
    upg = round(65 * 1.0 * FACTOR / 60, 1)

    def rng(lo, hi):
        txt = f"{lo:g}-{hi:g}".replace(".", ",")
        return (f'{txt} giờ <span class="dim">(≈ <span class="hday" data-h="{lo}"></span> - '
                f'<span class="hday" data-h="{hi}"></span>)</span>')

    parts.append(sec("s11", "11. Ước lượng thời gian build (không tính frontend)",
                     "Dây chuyền này được build theo <b>chế độ hoàn toàn tự động</b>: thiết kế đã chốt, không có cổng chờ "
                     "người, nhiều agent chạy song song trên các khối độc lập, agent tự viết test và tự chạy trên môi "
                     "trường thật. Ước lượng theo <b>chuẩn đo thực tế</b> (2026-10-11, đo trên một hệ thống cùng loại: kế "
                     "hoạch 178 giờ, làm thật 3,9 giờ agent): <b>code ≈ 1 phút agent cho mỗi giờ kế hoạch</b> (khối nền "
                     "dùng chung 0,6 phút), <b>tích hợp trên môi trường thật + test end-to-end ≈ 4 phút cho mỗi giờ kế "
                     "hoạch</b>. Sau đó nhân dự phòng: × 1,25 điều phối và review, <b>× 1,30 mạng lag</b>, × 1,20 rủi ro "
                     f"khác (API bị giới hạn tốc độ hoặc sập, Docker / DB khởi động lại, test chập chờn chạy lại, agent "
                     f"song song đụng nhau phải sửa khi ghép) = <b>× {FACTOR_S}</b>. Cột 'giờ kế hoạch' là kế hoạch kiểu "
                     "thông thường (chuẩn tương tác, ngày × 8), chỉ dùng làm đầu vào. Board UI (frontend) do người khác "
                     "làm nên không tính.",
                     switch
                     + table(["#", "Khối", "Cỡ", "Giờ kế hoạch (đầu vào)", "Phút agent (chưa dự phòng)", "Bản MVP"],
                             [[n, esc(b_), esc(c_), hrs(h), f"{h * (0.6 if n in FOUND else 1.0):.1f}".replace(".", ","),
                               "MVP" if m else ""] for n, b_, c_, h, m in est_rows]
                             + [["", "<b>Tổng</b>", "", f"<b>{hrs(round(total_h))}</b>",
                                 f"<b>{sum(base_min(est_rows)):.0f}</b>", f"MVP: {hrs(round(mvp_h))}"]])
                     + table(["Kịch bản (chế độ tự động, đã gồm dự phòng)", "Giờ agent cộng lại",
                              "Thời gian đồng hồ (3 luồng song song)", "Ghi chú"], [
                         ["Toàn bộ 20 khối + pilot tích hợp trên môi trường thật", rng(*[x[0] for x in (all_lo, all_hi)]),
                          f"<b>{rng(all_lo[1], all_hi[1])}</b>",
                          "Pilot 40-80 giờ kế hoạch: deploy, chạy trên DB thật, giả lập end-to-end và sửa lỗi phát sinh "
                          "(phần chiếm nhiều thời gian nhất)"],
                         ["MVP (khối 1-3, 5, 6, 9-12, 15-17; khối 16 bản đơn giản) + pilot",
                          rng(mvp_lo[0], mvp_hi[0]), f"<b>{rng(mvp_lo[1], mvp_hi[1])}</b>",
                          "Đủ để chạy run tự động đầu tiên"],
                         ["Thêm 12 nâng cấp (report Issues, mục 7)", f"+ {hrs(upg)}", "chạy song song cùng các khối",
                          "65 giờ kế hoạch × 1 phút × dự phòng"],
                         ["Tham chiếu: chế độ tương tác (một luồng, người duyệt từng bước)", "-", "330-440 giờ lịch làm việc",
                          "Chuẩn cũ; 'ngày' của nó là ngày lịch có chờ người, không dùng cho chế độ tự động"]])
                     + "<h3>Không nằm trong số trên (tính riêng, thường quyết định lịch)</h3>"
                     + table(["Hạng mục", "Vì sao tính riêng"], [
                         ["Người review code", "Chế độ tự động không có người trong vòng; review sau cùng tùy người"],
                         ["Rollout lên prod", "Chu kỳ cố định: release identity provider, push lên cloud, load test nhiều "
                          "instance"],
                         ["Chạy end-to-end với LLM thật", "Đi theo tốc độ của model (mỗi lượt eval / bench 1-3 giờ), không "
                          "theo tốc độ viết code"],
                         ["Vòng tự học + model phán xét", "Cần đủ run để chấm đúng / sai (≥ 30 unit mỗi nhánh mỗi bài học)"],
                         ["Quyết định thiết kế còn mở", "Chờ người hoặc chờ dữ liệu"]])
                     + '<p class="dim">Giả định: các phần event, lease, If-Match, idempotency phía RAG System đã có '
                       '(xem mục 14). Hệ số đo trên một hệ thống backend cùng loại; dây chuyền này có nhiều bước gọi LLM '
                       'thật hơn, nên phần pilot dùng khoảng 40-80 giờ kế hoạch. Chế độ 24 giờ / ngày là cách đọc đúng '
                       'cho agent chạy liên tục.</p>'))
    from collections import Counter as _C
    cnt = _C(STATUS[i["id"]][0] for i in ISSUES)
    gname = dict(ISSUE_GROUPS)
    prio_col = {"P0": "#f9a8c4", "P1": "#fde68a", "P2": "#a7b0bf"}
    rows12 = []
    for i in ISSUES:
        code, where = STATUS[i["id"]]
        lbl, col = LABEL[code]
        src = " ".join(f'<a href="{esc(u)}">[{k + 1}]</a>' for k, u in enumerate(i["src"]))
        rows12.append([f'<b>{i["id"]}</b>', esc(gname[i["group"]]), esc(i["name"]), esc(i["evidence"]) + (" " + src if src else ""),
                       f'<span class="chip" style="color:{col};border-color:{col}">{esc(lbl)}</span>', esc(where),
                       f'<span style="color:{prio_col[i["prio"]]};font-weight:800">{i["prio"]}</span>'])
    parts.append(sec("s12", f"12. {len(ISSUES)} vấn đề thực tế dùng để đánh giá design này",
                     f"Danh sách vấn đề mà các quy trình phát triển phần mềm (kiểu cũ và có agent AI) thường gặp, gom từ "
                     f"nghiên cứu trên mạng (DORA, CHAOS, NaPiRE, Google, Uber, Meta, MAST, METR, Replit, Cognition, "
                     f"Anthropic, Veracode...) cộng với các vấn đề tìm ra khi phản biện và do anh nêu (N1-N7). Cột "
                     f"<b>Trạng thái</b>: lần chấm độc lập thứ 2 cho ra 5 có / 24 một phần / 16 đề xuất; sau đó các bản vá "
                     f"đã được đưa vào design (mục 13), nên trạng thái dưới đây là <b>tự đánh giá sau tăng cứng, chưa chấm "
                     f"độc lập lần 3</b>. Chỉ tính 'Có trong design' khi phần Cơ chế / Luật / Tăng cứng của node thật sự mô "
                     f"tả cách xử lý có ngưỡng. Hiện: <b>{cnt['IN']} có trong "
                     f"design</b>, <b>{cnt['PA']} một phần</b>, <b>{cnt['PR']} mới là đề xuất</b>, {cnt['NA']} không cần. "
                     f"Chi tiết tranh luận từng vấn đề và 12 nâng cấp: report AI-SDLC-Issues-Debate-Report.html.",
                     '<div class="wide12">' + table(["#", "Nhóm", "Vấn đề", "Bằng chứng ngoài ngành", "Trạng thái",
                                                     "Chỗ trong design / còn thiếu", "Ưu tiên"], rows12) + "</div>"))
    htables = "".join(f"<h3>{esc(t)}</h3>" + table(head, [[esc(c) for c in r] for r in rows])
                      for mod in (hardening_a, hardening_b) for t, head, rows in mod.TABLES)
    hsrc = sorted(set(hardening_a.SOURCES) | set(hardening_b.SOURCES))
    n_nodes = len({k for mod in (hardening_a, hardening_b) for k in mod.ADD})
    parts.append(sec("s13", "13. Gói tăng cứng đã đưa vào design",
                     f"Các vấn đề ở mục 12 còn 'một phần' hoặc 'mới là đề xuất' đã được nghiên cứu thêm và đưa thẳng vào "
                     f"design: <b>{n_nodes} node</b> có thêm bước / luật (mở modal của node, khối viền vàng 'Tăng cứng đã "
                     f"đưa vào design'). Bảng dưới gom các cơ chế dùng chung. Vẫn giữ ba quyết định đã chốt: mục 3 do "
                     f"người; mục 6 và 8 do model phán xét, run sau chấm; deploy theo khung giờ cố định.",
                     htables + '<h3>Nguồn đã đọc khi nghiên cứu</h3><ol class="srcs">'
                     + "".join(f'<li><a href="{esc(u)}">{esc(u)}</a></li>' for u in hsrc) + "</ol>"))
    rag_rows = [
        ("1", "Kho event có cấu trúc, chỉ ghi thêm", "Board, watchdog, vòng học, đo chi phí",
         "Mỗi event có mã lỗi và trường bắt buộc: run, unit, phiên, lần thử, epoch, phiên bản agent, snapshot model, id "
         "bài học, hash spec. Event thiếu trường bị từ chối.", "P0"),
        ("2", "Lease + fencing epoch + If-Match trên mọi lần ghi", "Giao việc, hàng gộp code, kho code",
         "Mỗi lần cấp lease tăng epoch; mọi lần ghi mang epoch, server từ chối epoch cũ; tài liệu ghi theo phiên bản (rev).",
         "P0"),
        ("3", "Khóa idempotency cho thao tác ghi và tác động ra ngoài", "Deploy, seed dữ liệu, thông báo",
         "Ghi trùng khóa → trả lại kết quả cũ, không làm lại; tác động ra ngoài đi qua outbox có khóa.", "P1"),
        ("4", "Graph quy tắc của hệ thống đang chạy", "Dò chỗ trái ngược (mục 3), flow Enhancement",
         "Lưu (entity, thuộc tính, điều kiện, kết quả, câu trích nguồn, trạng thái hiệu lực). Truy vấn nhiều bước (≤ 3). "
         "Báo độ phủ entity mỗi lần dò. Ghi lại sau mỗi run là cổng hoàn tất. Bootstrap từ test / code cũ, đánh dấu "
         "'chưa xác minh'.", "P0"),
        ("5", "Kho Spec Pack có version", "Mục 3, mọi bước trích dẫn",
         "Version + hash; phụ lục vN.k cho câu trả lời của người; Sổ giả định (ASSUMED-n); id đoạn ổn định "
         "(file#trang#offset) để trích dẫn; tìm câu hỏi trùng trước khi hỏi người.", "P0"),
        ("6", "Sổ quyết định của model phán xét", "Mục 6 (hết thang sửa), mục 8 (chốt nguyên nhân)",
         "Bản ghi có cấu trúc do code ghi: đặc điểm ca, phương án, model + phiên bản phán xét, kết quả kỳ vọng, kết quả "
         "chấm, cờ quy được. Không lưu chữ tự do từ bằng chứng. Truy theo loại ca; bản ghi cũ giảm trọng số.", "P0"),
        ("7", "Kho bài học có vòng đời", "Mục 8, mọi agent",
         "Khóa theo vai trò + bước + stack; nguồn gốc (run, event); trạng thái: chưa chứng minh / đang dùng / đã gỡ; "
         "TTL; phạm vi mở rộng theo nấc (một project → liên project khi ≥ 3 project ủng hộ); lint câu mệnh lệnh và tên "
         "guard; tự rollback khi chỉ số xấu đi.", "P0"),
        ("8", "Truy xuất theo bước, theo khóa", "Mọi agent trước mỗi bước",
         "Trả đúng bài học / kiến thức cho (vai trò, bước, stack) đang chạy, có trần số ký tự, không tốn lượt model; "
         "ghi lại id bài học đã phục vụ vào event.", "P0"),
        ("9", "Vùng holdout tách riêng", "Chấm test, chấm model phán xét, eval bài học",
         "Agent không đọc được; chỉ bộ chấm truy cập; có chuỗi canary để phát hiện rò rỉ; làm mới định kỳ từ dự án mới.",
         "P0"),
        ("10", "Danh tính agent + phân quyền theo vai trò", "Danh bạ agent (mục 9), registry guard",
         "Mỗi agent có danh tính riêng, quyền theo vai trò; registry guard chỉ đọc với agent, model phán xét và bộ soạn "
         "bài học.", "P1"),
        ("11", "Che secret / dữ liệu cá nhân trước khi lưu", "Mọi lần ghi transcript, event, bài học",
         "Quét và che secret / PII trước khi ghi; dùng cùng bộ quét với cổng bảo mật ở verifier.", "P0"),
        ("12", "Kho chỉ số kết quả + mức nền", "Đo hiệu quả dây chuyền (mục 8, 11)",
         "Thời gian từ chốt spec tới QAS xanh, lỗi lọt UAT, việc làm lại, chi phí theo F-item; lưu mức nền đo khi còn "
         "làm có người để so.", "P1"),
    ]
    parts.append(sec("s14", "14. Các mục cần thêm ở phía RAG System",
                     "Dây chuyền này dựa vào một RAG System để nhớ, tra cứu và tự học. Bảng dưới là những gì phía RAG "
                     "System cần có để dây chuyền chạy được như thiết kế. Danh sách được cập nhật mỗi khi design dây "
                     "chuyền thay đổi; khi design chốt, đây là đầu bài để nâng cấp RAG System.",
                     table(["#", "Cần thêm", "Dây chuyền dùng ở đâu", "Mô tả / luật", "Ưu tiên"],
                           [[a, f"<b>{esc(b)}</b>", esc(c), esc(d),
                             f'<span style="color:{prio_col[e]};font-weight:800">{e}</span>']
                            for a, b, c, d, e in rag_rows])))
    acc_rows = [
        ("Bài học theo khóa", "Triệu chứng / nguyên nhân / cách sửa, khóa (vai trò, bước, stack), nguồn gốc (dự án, ai xác "
         "nhận, có người đỡ hay không)", "Mọi agent, tra theo bước", "≥ 10 bài học đã qua eval cho mỗi vai trò chính "
         "(Đọc, Viết test, Chia việc, Builder, Fixer)"),
        ("Lịch sử quyết định kèm kết quả", "Bản ghi có cấu trúc: loại ca, các phương án, lựa chọn, kết quả kỳ vọng, kết quả "
         "thật (đúng / sai), có quy được nguyên nhân không", "Model phán xét (mục 6, mục 8): không phải bắt đầu từ 0",
         "≥ 50 bản ghi có kết quả, phủ các loại ca hay gặp"),
        ("Bài mẫu (golden) + bộ holdout", "Spec đã chốt + bản tóm tắt đã xác nhận + test đúng, lấy từ dự án thật. Holdout "
         "lưu ở vùng tách riêng, agent không đọc được", "Eval bài học, eval phiên bản agent, chấm model phán xét",
         "≥ 20 bài mẫu và ≥ 10 bài holdout cho mỗi stack"),
        ("Mức nền (khi còn làm có người)", "Thời gian từ chốt spec tới QAS xanh, lỗi lọt UAT, tỉ lệ làm lại, giờ công và chi "
         "phí mỗi F-item", "So hiệu quả khi dây chuyền tự chạy (mục 8, 11)", "≥ 3 dự án hoặc ≥ 30 F-item"),
        ("Graph quy tắc của hệ thống đang chạy", "Nạp từ test và code cũ, đánh dấu 'chưa xác minh'; xác minh dần khi làm "
         "dự án thật", "Dò chỗ trái ngược (mục 3), flow Enhancement", "Độ phủ ≥ 80% entity của hệ thống sắp đưa vào dây chuyền"),
        ("Bộ quy ước theo stack", "Đơn vị, múi giờ, tiền tệ, định dạng lỗi, quy ước UI (toast, spinner, thông báo lỗi), "
         "đặt tên", "Contract (ns7), phân loại 'không có trong spec'", "Mỗi stack có một bộ được người duyệt"),
        ("Lỗi đọc spec theo template", "Loại template + mục + câu gốc + cách hiểu sai + cách hiểu đúng",
         "Đọc lần 1, checklist khe trống", "Mỗi template đang dùng có ≥ 5 ca"),
        ("Hạ tầng và môi trường", "Danh sách test chập chờn đã biết, công thức dựng preview giống QAS, runbook sự cố INFRA",
         "Cổng sẵn sàng môi trường, preview, trực INFRA", "Preview dựng lại được bằng một lệnh; runbook cho 6 kịch bản chaos"),
    ]
    gate_rows = [
        ("Chạy bóng (shadow) trên dự án thật", "Dây chuyền chạy song song với người, không gộp code, so kết quả từng bước",
         "≥ 2 dự án, ≥ 30 F-item"),
        ("Cách hiểu spec khớp với người", "Bản tóm tắt + test của dây chuyền so với kết quả người chốt", "≥ 90% F-item khớp"),
        ("Model phán xét đủ tin", "Chấm lại các quyết định trong lịch sử đã có kết quả", "≥ 80% đúng, trên ≥ 50 ca"),
        ("Bộ holdout qua được", "Code của dây chuyền chạy trên holdout", "≥ 90% pass, 0 cờ gian lận"),
        ("Không còn rủi ro P0 mở", "Theo mục 12 / 13", "0 mục P0 ở trạng thái 'một phần' hoặc 'đề xuất'"),
        ("RAG System sẵn sàng", "Theo mục 14", "Mọi mục P0 đã có"),
    ]
    parts.append(sec("s15", "15. Giai đoạn tích lũy trước vận hành",
                     "Dây chuyền chỉ có agent tự chạy nên lúc mới vận hành sẽ chưa đạt hết sức. Lợi thế của nó là RAG "
                     "System: kinh nghiệm được nhớ và dùng lại qua các dự án. Vì vậy trước khi cho chạy thật, cần một giai "
                     "đoạn <b>tích lũy kinh nghiệm thực chiến</b>, ghi đúng dạng để dây chuyền dùng được ngay. Nguyên tắc: "
                     "kinh nghiệm có từ lúc còn người đỡ phải qua eval rồi mới dùng rộng, vì chưa chắc còn đúng khi agent "
                     "tự chạy; và mọi thứ phải có nguồn gốc.",
                     "<h3>Ghi những gì, ghi thế nào</h3>"
                     + table(["Loại kinh nghiệm", "Ghi thế nào", "Dây chuyền dùng ở đâu", "Đủ dùng khi"],
                             [[f"<b>{esc(a)}</b>", esc(b), esc(c), esc(d)] for a, b, c, d in acc_rows])
                     + "<h3>Cách tích lũy hiệu quả nhất: chạy bóng</h3>"
                     + '<p class="lead">Cho dây chuyền chạy <b>song song với người</b> trên dự án thật: nó đọc spec, viết '
                       'test, chia việc, viết code trên nhánh riêng, nhưng không gộp vào nhánh chính. Mỗi bước được so với '
                       'kết quả người làm. Chỗ lệch thành bài học hoặc bản ghi quyết định có kết quả thật, đúng loại dữ liệu '
                       'mà vòng tự học và model phán xét cần. Cách này cũng cho luôn mức nền để so.</p>'
                     + "<h3>Cổng chuyển sang vận hành</h3>"
                     + table(["Điều kiện", "Đo thế nào", "Ngưỡng"], [[esc(a), esc(b), esc(c)] for a, b, c in gate_rows])
                     + '<p class="dim">Khả năng tự học mạnh tới đâu phụ thuộc vào tín hiệu chấm có sạch không. Vì vậy gói '
                       'toàn vẹn test (holdout, khóa fixture / mock, test bị cách ly không tính xanh) nên có ngay từ giai '
                       'đoạn tích lũy, để kinh nghiệm ghi vào là kinh nghiệm làm đúng chứ không phải kinh nghiệm qua test.</p>'))
    store = "".join(internals(n) for n in (NODES, READ_VI, DAG_VI, DRIFT_VI, TIER_VI, LEARN_VI, AGENT_VI, NEW_SYS_VI,
                                             ENH_VI, BUG_VI, MIG_VI))
    parts.append(f'<div id="ncard-store" hidden>{store}</div>')
    return TEMPLATE.format(body="".join(parts))


TEMPLATE = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI SDLC Autonomous Build</title>
<style>
:root{{--bg:#0a0f1a;--panel:#101928;--line:#263650;--text:#f3f6fb;--dim:#a7b0bf;--teal:#5eead4;--pink:#f9a8c4;
--cyan:#67e8f9;--lav:#c4b5fd;--yellow:#fde68a;--orange:#fdba74}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);background-image:linear-gradient(rgba(148,170,210,.035) 1px,transparent 1px),
linear-gradient(90deg,rgba(148,170,210,.035) 1px,transparent 1px);background-size:40px 40px;color:var(--text);
font:15px/1.6 "JetBrains Mono","Cascadia Mono",Consolas,ui-monospace,monospace}}
main{{max-width:1200px;margin:0 auto;padding:32px 16px 80px}}
h1{{font-size:27px;margin:0 0 4px}} h2{{font-size:21px;margin:52px 0 8px;color:var(--teal)}}
h3{{font-size:16px;margin:24px 0 8px;color:var(--cyan)}}
.byline{{color:var(--dim);font-size:13px}} .lead{{max-width:960px}} .dim{{color:var(--dim);font-size:13px}}
a{{color:var(--cyan)}}
table{{width:100%;border-collapse:collapse;margin:10px 0 16px;font-size:13px}}
th,td{{border-bottom:1px solid var(--line);padding:8px 10px;vertical-align:top;text-align:left}}
th{{color:var(--dim);font-weight:700;background:var(--panel)}}
.diagram{{width:max-content;margin:12px 0 12px calc(50% - 50vw + 16px);border:2px dashed var(--line);border-radius:14px;background:var(--bg)}}
.diagram svg{{display:block}}
.assume{{border:2.5px solid var(--cyan);border-radius:8px;background:#0c2b37;padding:12px 16px;margin:16px 0;
box-shadow:0 0 10px -2px rgba(103,232,249,.45)}}
.board{{display:grid;grid-template-columns:repeat(8,minmax(130px,1fr));gap:8px;margin:14px 0;border:2px dashed var(--line);
border-radius:14px;padding:10px;background:#0b1220}}
.bhead{{font-size:12px;color:var(--dim);font-weight:800;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:8px}}
.bcard{{border:2px solid;border-radius:8px;background:#101928;padding:8px;margin-bottom:8px;font-size:12px;line-height:1.4}}
.bid{{font-weight:800;font-size:11px}} .bnow{{color:var(--dim);font-size:11px;margin-top:4px}}
nav a{{margin-right:12px;font-size:13px}}
@media (max-width:900px){{.board{{grid-template-columns:repeat(2,1fr)}}}}
#tip{{position:fixed;z-index:50;max-width:420px;pointer-events:none;display:none;background:#0b1220;border:2px solid var(--cyan);
border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 0 14px -2px rgba(103,232,249,.5)}}
#tip .th{{font-weight:800;font-size:13.5px;margin-bottom:6px}} #tip .tk{{color:var(--dim);font-weight:700;margin-top:5px}}
g.tipnode:focus{{outline:none}} g.tipnode:hover rect,g.tipnode:focus rect{{filter:brightness(1.35)}}
.ncards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:14px;margin:12px 0}}
.ncard{{border:2px solid;border-radius:10px;background:var(--panel);padding:12px 14px;font-size:13px;line-height:1.5;scroll-margin-top:16px}}
.ncard:target{{box-shadow:0 0 16px -2px rgba(253,230,138,.6);border-color:var(--yellow)!important}}
.nh{{font-size:14.5px;font-weight:800;margin-bottom:8px}} .nk{{float:right;border:1.6px solid;border-radius:5px;padding:0 6px;font-size:11.5px}}
.nr{{margin:6px 0;padding-left:10px;border-left:3px solid var(--line)}} .nr span{{display:block;font-size:11.5px;font-weight:800;
text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}} .nr ol,.nr ul{{margin:2px 0;padding-left:20px}}
.nr.hk{{border-color:var(--yellow);background:rgba(253,230,138,.05)}} .nr.hk span{{color:var(--yellow)}}
.srcs{{font-size:12.5px}} .srcs a{{word-break:break-all}}
.nr.ex{{border-color:var(--yellow)}} .nr.ex span{{color:var(--yellow)}} .nr.hd{{border-color:var(--pink)}} .nr.hd span{{color:var(--pink)}}
g.tipnode{{cursor:pointer!important}}
#nmodal{{position:fixed;inset:0;z-index:60;background:rgba(5,8,15,.72);display:flex;align-items:center;justify-content:center;padding:16px}}
#nmodal[hidden]{{display:none}}
.nm-box{{position:relative;width:min(820px,100%);max-height:88vh;overflow:auto;border-radius:12px;background:var(--panel);
box-shadow:0 0 30px -4px rgba(94,234,212,.35)}}
.nm-box .ncard{{border-radius:12px;margin:0;font-size:13.5px;padding:18px 20px}}
.nm-box .nh{{padding-right:46px}}
.wide12 table{{font-size:12.5px}} .wide12 td:nth-child(4){{min-width:260px}} .wide12 td:nth-child(6){{min-width:240px}}
.chip{{display:inline-block;border:1.6px solid;border-radius:5px;padding:0 6px;font-size:12px;font-weight:800;white-space:nowrap}}
.hswitch{{font-size:13px;color:var(--dim)}} .hswitch label{{margin-right:14px;cursor:pointer;color:var(--text)}}
.nm-x{{position:sticky;top:8px;float:right;margin:8px 10px 0 0;z-index:2;background:#0b1220;color:var(--text);border:1.6px solid var(--line);
border-radius:6px;font:700 16px/1 inherit;padding:4px 10px;cursor:pointer}}
@media (max-width:600px){{.ncards{{grid-template-columns:1fr}}}}
</style></head><body><main>
<h1>AI SDLC — dây chuyền implementation + testing tự động</h1>
<p class="byline">2026-10-10 · Rowan · tiếp theo report Guards (AI-SDLC-Guards-Report.html) và thiết kế hệ thống RAG có cấu trúc</p>
<div class="assume"><b>Giả định:</b> mọi requirement và tài liệu đã được con người chuẩn bị, đúng và đủ. Phạm vi: từ lúc
Spec Pack được đóng băng tới khi deploy và test xanh trên môi trường test (QAS). Con người chỉ xuất hiện khi bị escalate
hoặc khi QAS xanh. Đánh số theo câu hỏi (1, 2, 3, 4, 6, 7, 8, 9).</div>
<nav><a href="#s0">0 Tổng quan</a><a href="#s1">1 Tự động</a><a href="#s2">2 Theo dõi</a><a href="#s3">3 Hiểu đúng</a>
<a href="#s4">4 Ai làm gì</a><a href="#s6">6 Lệch / sai</a><a href="#s7">7 Hai tầng</a><a href="#s8">8 Tự học</a>
<a href="#s9">9 Plug-in/out</a><a href="#f-new">New system</a><a href="#f-enh">Enhancement</a><a href="#f-bug">Bug fix</a><a href="#f-mig">Migration</a><a href="#s16">Stack</a><a href="#s17">Seal</a>
<a href="#s10">Thứ tự xây</a><a href="#s11">Ước lượng</a><a href="#s12">Vấn đề thực tế</a><a href="#s13">Tăng cứng</a><a href="#s14">RAG System</a><a href="#s15">Tích lũy</a></nav>
{body}
<p class="dim">Generated by docs/design/source/make_autonomous_report.py (renderer swimlane.py). Nguồn ngành: xem
AI-SDLC-Guards-Report.html mục Nguồn (MAST, Spotify, Meta, GitHub, Cognition, Anthropic, Airbnb, Google, OpenAI, AWS, Uber).</p>
<div id="nmodal" hidden role="dialog" aria-modal="true"><div class="nm-box"><button class="nm-x" aria-label="Đóng">×</button><div class="nm-body"></div></div></div>
<div id="tip"></div>
<script>
(function(){{var tip=document.getElementById('tip');
function show(g,x,y){{var d;try{{d=JSON.parse(g.getAttribute('data-tip'))}}catch(e){{return}}
tip.textContent='';tip.style.borderColor=d.accent;var h=document.createElement('div');h.className='th';h.style.color=d.accent;
h.textContent=d.id.toUpperCase()+' · '+d.title;tip.appendChild(h);
Object.keys(d).forEach(function(k){{if(k==='id'||k==='title'||k==='accent')return;var t=document.createElement('div');t.className='tk';
t.textContent=k;var v=document.createElement('div');v.textContent=d[k];tip.appendChild(t);tip.appendChild(v)}});
if(document.getElementById('n-'+d.id)){{var f=document.createElement('div');f.className='tk';f.textContent='Bấm để mở chi tiết';tip.appendChild(f)}}tip.style.display='block';place(x,y)}}
function place(x,y){{var w=tip.offsetWidth,h=tip.offsetHeight,X=x+16,Y=y+16;
if(X+w>innerWidth-8)X=Math.max(8,x-w-16);if(Y+h>innerHeight-8)Y=Math.max(8,y-h-16);tip.style.left=X+'px';tip.style.top=Y+'px'}}
document.addEventListener('mouseover',function(e){{var g=e.target.closest&&e.target.closest('g.tipnode');if(g)show(g,e.clientX,e.clientY)}});
document.addEventListener('mousemove',function(e){{if(tip.style.display==='block'&&e.target.closest&&e.target.closest('g.tipnode'))place(e.clientX,e.clientY)}});
document.addEventListener('mouseout',function(e){{var g=e.target.closest&&e.target.closest('g.tipnode');if(g&&!g.contains(e.relatedTarget))tip.style.display='none'}});
document.addEventListener('focusin',function(e){{var g=e.target.closest&&e.target.closest('g.tipnode');if(g){{var r=g.getBoundingClientRect();show(g,r.right,r.top)}}}});
document.addEventListener('click',function(e){{var m=document.getElementById('nmodal');if(m&&!m.hidden&&(e.target===m||e.target.closest('.nm-x'))){{m.hidden=true;return}}var g=e.target.closest&&e.target.closest('g.tipnode');if(!g||!m)return;var d=JSON.parse(g.getAttribute('data-tip'));var c=document.getElementById('n-'+d.id);if(!c)return;tip.style.display='none';var b=m.querySelector('.nm-body');b.innerHTML='';var k=c.cloneNode(true);k.removeAttribute('id');b.appendChild(k);m.hidden=false;m.querySelector('.nm-box').scrollTop=0;m.querySelector('.nm-x').focus()}});
document.addEventListener('keydown',function(e){{var m=document.getElementById('nmodal');if(e.key==='Escape'&&m&&!m.hidden)m.hidden=true}});
document.addEventListener('keydown',function(e){{if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('tipnode'))e.target.dispatchEvent(new MouseEvent('click',{{bubbles:true}}))}});
document.addEventListener('focusout',function(){{tip.style.display='none'}});
}})();
</script>
</main></body></html>"""


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                                               "AI-SDLC-Autonomous-Build-Report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page())
    print("wrote", os.path.abspath(out))
