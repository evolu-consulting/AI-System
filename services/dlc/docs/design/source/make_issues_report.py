"""AI SDLC - common SDLC issues debated against the current line (local HTML report, neon blueprint style).

    python make_issues_report.py [OUT]   default OUT = ../AI-SDLC-Issues-Debate-Report.html
"""
import os
import re
import sys
from collections import Counter

import make_autonomous_report as base
from friendly_titles import apply as friendly
from issue_debate_data import GROUPS, ISSUES, STAGES, TOP10, WEAK3
from swimlane import VI, render_swimlane

esc, table, diagram, sec = base.esc, base.table, base.diagram, base.sec

VERD = {"C": ("Đã che", "#5eead4"), "P": ("Một phần", "#fde68a"), "G": ("Thiếu", "#f9a8c4"), "-": ("Mới", "#c4b5fd")}
PRIO = {"P0": "#f9a8c4", "P1": "#fde68a", "P2": "#a7b0bf"}
NEW, CHG = "MỚI", "ĐỔI"


def chip(code, small=False):
    lbl, col = VERD[code]
    return f'<span class="chip{" sm" if small else ""}" style="color:{col};border-color:{col}">{esc(lbl)}</span>'


def pchip(p):
    return f'<span class="chip" style="color:{PRIO[p]};border-color:{PRIO[p]}">{p}</span>'


# ── line v2: the line after the fixes, new / changed steps marked, hover for details ─────────────────────
def T(id, title, lane, phase, sub, tag, change, issues, rule, prio, rework=None, mark=None):
    d = base.S(id, title, lane, phase, sub, tag, rework, mark)
    if change:
        d["detail"] = {"Thay đổi": change, "Chặn vấn đề": issues, "Ngưỡng / luật": rule, "Ưu tiên": prio}
    return d


LINE2 = [
    T("h0", "Spec Pack + Change Request", "human", "Đầu vào", "vN, phụ lục vN.k", "I02 N3",
      "Thêm đường Change Request: pack vN+1 diff theo điều khoản; câu trả lời của người thành phụ lục vN.k.",
      "I02 spec đổi giữa run; N3 câu trả lời không quay lại spec.",
      "Ảnh hưởng > 30% F-item → lập lại kế hoạch; còn lại chỉ đánh dấu stale đúng phần đổi.", "P0", mark=CHG),
    T("c0", "Cổng testability", "ctrl", "Đầu vào", "tiêu chí đo được, từ mơ hồ", "N2",
      "Code kiểm mỗi F-item có ≥ 1 tiêu chí chấp nhận đo được; gắn cờ từ mơ hồ không có con số.",
      "N2 spec sai / mơ hồ không có trọng tài.", "> 10% F-item rớt → trả pack về người nộp.", "P0", mark=NEW),
    T("p0", "Cổng sẵn sàng môi trường", "plat", "Đầu vào", "image pin, build + test mẫu", "I29 I38",
      "Build image dev đã pin; phải qua build sạch, bộ test hiện có và một test đỏ mẫu. Chaos suite của control plane "
      "phải xanh.",
      "I29 agent không build được; I38 control plane chưa được test.",
      "Không qua → run bị chặn mã INFRA, không agent nào khởi động.", "P0", mark=NEW),
    T("c1", "Nhận việc + ngân sách", "ctrl", "Đầu vào", "token bucket theo provider", "I17",
      "Thêm token bucket theo provider; lỗi provider phân loại INFRA, không tốn ngân sách sửa.",
      "I17 rate limit / trần chi tiêu.", "Cảnh báo khi chi tiêu dự kiến của run chạm 80%.", "P0", mark=CHG),
    T("p1", "Ingest + gỡ chữ ẩn", "plat", "Hiểu", "Unicode ẩn, câu nói với agent", "I12",
      "Gỡ chữ ẩn, comment, metadata, ký tự tag/bidi; gắn cờ câu nói với agent.",
      "I12 prompt injection qua tài liệu.", "Yêu cầu nhạy cảm (auth, endpoint, egress, admin) → người xác nhận.", "P0",
      mark=CHG),
    T("a1", "Đọc lần 1 + đọc lại để xác nhận", "agent", "Hiểu", "trích câu gốc, k = 2 mẫu", "I30", "", "", "", ""),
    T("g1", "Đối chiếu + khe trống", "guard", "Hiểu", "Sổ giả định ASSUMED-n", "I01",
      "Checklist khe trống bằng code: input, output, lỗi, giới hạn, đơn vị/múi giờ/làm tròn, quyền, lưu trữ.",
      "I01 spec im lặng, hai reader đồng ý cùng một mặc định.",
      "Khe không có câu trích → ASSUMED-n; giả định về tiền / quyền / xóa / giao diện ngoài → hỏi người.", "P0",
      rework=("a1", "lệch -> đọc lại"), mark=CHG),
    T("h1", "Hỏi người một lần", "human", "Hiểu", "gom câu hỏi, có phương án", "I01 I07",
      "Một lượt hỏi duy nhất trước khi lập kế hoạch, theo schema gói escalate (một quyết định, 2-4 phương án).",
      "I01 giả định rủi ro; I07 quá tải escalate.", "≤ 3 escalate mở mỗi project; câu trả lời thành phụ lục vN.k.",
      "P0", mark=NEW),
    T("a3", "Test từ câu gốc + holdout", "agent", "Hiểu", "provider khác viết holdout", "N4 I23",
      "Test Author đọc câu gốc, không đọc tóm tắt reader; bộ holdout do provider khác viết, Builder không thấy.",
      "N4 lỗi tương quan; I23 gian lận test.", "Mỗi assertion trỏ về câu trích hoặc ASSUMED-n.", "P0", mark=CHG),
    T("g2", "Kiểm test + burn-in", "guard", "Hiểu", "đỏ khi rỗng, 10/10 ổn định", "I04",
      "Test mới phải ổn định 10/10 trước khi được dùng làm cổng.", "I04 test flaky do agent viết.",
      "Test không ổn định → trả Test Author.", "P0", rework=("a3", "flaky / không truy vết"), mark=CHG),
    T("a4", "Planner + claim đặc biệt", "agent", "Kế hoạch", "migrations, lockfile, tiện ích chung", "I19 I09 I39",
      "Claim một-chủ cho migrations và lockfile; unit tiện ích chung đi trước; cứ 10 unit có 1 unit refactor.",
      "I19 migration song song; I09 trùng lặp; I39 nâng dependency lan.", "Graph validator kiểm thêm các claim này.",
      "P0 / P1", mark=CHG),
    T("c3", "Điều phối + fencing epoch", "ctrl", "Xây", "epoch trên mọi lần ghi", "I15 I27",
      "Mỗi lần cấp claim tăng epoch; push, verify, hàng merge, ghi RAG System mang epoch; server từ chối epoch cũ. Tối đa 3 thế hệ "
      "Fixer mỗi F-item.", "I15 người giữ lease cũ vẫn ghi; I27 ping-pong giữa Fixer.",
      "Test đổi xanh/đỏ > 2 lần qua các merge → đóng băng run.", "P0", mark=CHG),
    T("a5", "Builder + BLOCKED", "agent", "Xây", "timebox 2x, decision record", "I28 I26",
      "Tool BLOCKED (MISSING_INFO / IMPOSSIBLE / ENV) kết thúc phiên không tính thất bại; builder phát decision record "
      "cho lựa chọn spec không nói tới.", "I28 đâm vào ngõ cụt; I26 quyết định ngầm lệch nhau.",
      "Timebox = 2 lần ước lượng unit; BLOCKED trùng lý do gộp một escalate.", "P0 / P1", mark=CHG),
    T("g3", "Verifier mở rộng", "guard", "Kiểm", "an ninh, dependency, toàn vẹn test", "I10 I14 I11 I23 I24 I09",
      "Thêm SAST + SCA, kiểm dependency tồn tại, gitleaks, clone detector, khóa đường hạ tầng test, kiểm số test / skip, "
      "mutation trên dòng đổi, holdout.",
      "I10 code không an toàn; I14 package bịa; I11 lộ secret; I23 gian lận; I24 báo xong giả; I09 trùng lặp.",
      "High/critical mới → chặn; trùng ≥ 25 dòng → fail; mutation ≥ 60%; coverage dòng đổi ≥ 70%.", "P0",
      rework=("a5", "sửa <= N, rồi đổi agent / tách"), mark=CHG),
    T("g4", "Review ngữ cảnh sạch", "guard", "Kiểm", "không thấy lịch sử tác giả", "§6", "", "", "", "",
      rework=("a5", "có lỗi -> sửa")),
    T("c4", "Hàng merge: mọi acceptance", "ctrl", "Tích hợp", "lô + chia đôi, Fixer riêng", "I03",
      "Mỗi lần merge chạy tất cả test acceptance; chặn khi test đã xanh bị đỏ. Xung đột sinh Fixer riêng claim cả hai phía.",
      "I03 xung đột ngữ nghĩa; 'unit sau sửa' không có chủ.", "Hàng đợi > 5 → merge theo lô, fail thì chia đôi.", "P1",
      mark=CHG),
    T("p2", "Skeleton lên QAS sớm", "plat", "Tích hợp", "smoke mỗi 5 merge / 24 h", "I08",
      "Deploy walking skeleton ngay merge đầu; smoke + acceptance F-item đã xong theo nhịp.", "I08 big bang cuối run.",
      "Mỗi 5 merge hoặc 24 giờ, cái nào tới trước.", "P0", mark=NEW),
    T("p3", "Deploy QAS an toàn", "plat", "Test", "namespace, snapshot, khóa deploy", "I05 I20 I16 I35",
      "Namespace riêng mỗi run, snapshot trước deploy, deploy có khóa (run, digest), config trong artifact, health gate.",
      "I05 bẩn dữ liệu; I20 mất dữ liệu; I16 deploy chạy hai lần; I35 config ngoài artifact.",
      "Health/smoke không qua trong 5 phút → tự rollback (code + config + DB).", "P0 / P1", mark=CHG),
    T("g5", "QAS: quarantine không tính", "guard", "Test", "checksum dữ liệu, DAST nền", "I04 I10",
      "Test acceptance bị cách ly không tính xanh; checksum dữ liệu trước mỗi lần chạy; DAST nền.",
      "I04 race thật lọt qua quarantine; I10 lỗ hổng runtime.", "Trần cách ly ≤ 2% bộ test và 0 test acceptance.", "P0",
      rework=("c3", "F-item đỏ -> unit sửa"), mark=CHG),
    T("h2", "Demo theo F-item", "human", "Test", "ASSUMED list, phản hồi 48 h", "I37",
      "F-item xanh trên QAS → báo chủ nghiệp vụ kèm link demo và danh sách giả định.", "I37 UAT lệch nhịp.",
      "Phản hồi trong 48 giờ đi vào đường Change Request.", "P1", mark=NEW),
    T("c5", "Reconciler 5 phút", "ctrl", "Test", "git, lease, hàng merge, QAS", "N1",
      "So git ref, lease, hàng merge, trạng thái QAS với trạng thái chiếu; watchdog chạy tiến trình riêng.",
      "N1 control plane sập / lệch trạng thái.", "Lệch → đóng băng run đó và cảnh báo.", "P0", mark=NEW),
    T("l1", "Học theo kết quả", "learn", "Học", "nguồn gốc, holdout, canary", "I22 I32 N5 I31",
      "Lesson có nguồn gốc, chấm bằng kết quả (QAS xanh lần đầu, lỗi lọt), không bằng số mã lỗi; holdout riêng; eval "
      "canary hằng đêm cho model.", "I22 đầu độc lesson; I32 eval rò rỉ; N5 Goodhart; I31 model trôi.",
      "Liên project khi ≥ 3 project ủng hộ; model tụt > 5% → đóng băng phiên mới.", "P1", mark=CHG),
]


def counts(key):
    return Counter(i[key] for i in ISSUES)


def bars():
    b, a = counts("before"), counts("after")
    total = len(ISSUES)
    out = ['<div class="bars">']
    for title, c in ((f"Tự chấm lần đầu (39 vấn đề + {b['-']} chưa biết)", b), (f"Sau phản biện + bổ sung ({len(ISSUES)} vấn đề)", a)):
        out.append(f'<div class="barrow"><div class="bt">{esc(title)}</div><div class="bar">')
        for code in ("C", "P", "G", "-"):
            n = c.get(code, 0)
            if n:
                lbl, col = VERD[code]
                out.append(f'<div class="seg" style="flex:{n};background:{col}22;border-color:{col};color:{col}">'
                           f'{esc(lbl)} {n}</div>')
        out.append("</div></div>")
    out.append(f'<p class="dim">Tổng {total} vấn đề. "Mới" = vấn đề danh sách ban đầu không có: N1-N5 do phản biện tìm ra, N6-N7 do anh nêu.</p>')
    out.append("</div>")
    return "".join(out)


def cover_map():
    out = ['<div class="cmap">']
    for g, gname in GROUPS:
        items = [i for i in ISSUES if i["group"] == g]
        out.append(f'<div class="cg"><div class="cgh">{g}. {esc(gname)} <span class="dim">({len(items)})</span></div>')
        for i in items:
            col = VERD[i["after"]][1]
            out.append(f'<a class="ci" href="#{i["id"]}" style="border-color:{col}"><b style="color:{col}">{i["id"]}</b> '
                       f'{esc(i["name"])} <span style="color:{PRIO[i["prio"]]}">{i["prio"]}</span></a>')
        out.append("</div>")
    out.append("</div>")
    return "".join(out)


def stage_map():
    rows = []
    for st in STAGES:
        cells = [st]
        for p in ("P0", "P1", "P2"):
            ids = [i["id"] for i in ISSUES if st in i["stage"] and i["prio"] == p]
            cells.append(" ".join(f'<a href="#{x}">{x}</a>' for x in ids) or '<span class="dim">-</span>')
        rows.append(cells)
    return table(["Bước trong dây chuyền", "P0 (trước run tự động đầu tiên)", "P1 (trước khi mở rộng nhiều project)",
                  "P2 (sau)"], rows)


def short(u):
    return re.sub(r"^https?://(www\.)?", "", u)[:70]


def card(i):
    src = "".join(f'<a href="{esc(u)}">{esc(short(u))}</a>' for u in i["src"])
    return (f'<div class="card" id="{i["id"]}"><div class="ch"><b>{i["id"]}</b> {esc(i["name"])}</div>'
            f'<div class="cv">{chip(i["before"], True)} → {chip(i["after"])} {pchip(i["prio"])} '
            f'<span class="dim">công sức {esc(i["cost"])} · chèn vào: {esc(", ".join(i["stage"]))}</span></div>'
            f'<div class="row ev"><span>Bằng chứng</span>{esc(i["evidence"])}</div>'
            f'<div class="row at"><span>Phản biện: vẫn hỏng khi</span>{esc(i["attack"])}</div>'
            f'<div class="row hv"><span>Flow hiện tại đã có</span>{esc(i["have"])}</div>'
            f'<div class="row fx"><span>Cách cover</span>{esc(i["fix"])}</div>'
            + (f'<div class="src">{src}</div>' if src else "") + "</div>")


def sources():
    seen = []
    for i in ISSUES:
        for u in i["src"]:
            if u not in seen:
                seen.append(u)
    return "<ol class=\"srcs\">" + "".join(f'<li><a href="{esc(u)}">{esc(u)}</a></li>' for u in seen) + "</ol>"


def page():
    friendly(LINE2, "line2")
    a = counts("after")
    p = Counter(i["prio"] for i in ISSUES)
    parts = []
    parts.append(sec("s0", "0. Kết luận nhanh",
                     f"Tìm được <b>{len(ISSUES)} vấn đề</b> (39 từ nghiên cứu trên mạng, 5 do phản biện tìm ra, 2 do anh nêu: N6, N7). Sau phản "
                     f"biện, flow hiện tại <b>chỉ che kín {a['C']}</b>, che <b>một phần {a['P']}</b>, và <b>thiếu hẳn "
                     f"{a['G']}</b>. Lần tự chấm đầu tiên quá lạc quan: 7 vấn đề tưởng đã che thì 5 vấn đề chỉ che một phần. "
                     f"Cần {p['P0']} bản vá P0 trước run tự động đầu tiên; phần lớn là kiểm tra bằng code, công sức nhỏ.",
                     bars() + table(["Điểm yếu nhất của flow hiện tại", "Vì sao"],
                                    [[f"<b>{esc(n)}</b>", esc(w)] for n, w in WEAK3])))
    parts.append(sec("s1", "1. Cách làm",
                     "Ba luồng nghiên cứu song song, rồi một vòng tự chấm, rồi một agent phản biện độc lập tấn công từng "
                     "kết luận, rồi chốt.",
                     table(["Bước", "Làm gì", "Kết quả"], [
                         ["Nghiên cứu 1", "Vấn đề SDLC kinh điển: Waterfall, Agile, DevOps, SAFe (DORA, CHAOS, NaPiRE, "
                          "Google SRE, Stack Overflow, Atlassian, GitLab)", "18 vấn đề"],
                         ["Nghiên cứu 2", "Lỗi khi agent AI chạy SDLC (MAST, METR, SWE-bench, Replit, Cognition, "
                          "Anthropic, Veracode, GitClear...)", "23 vấn đề"],
                         ["Nghiên cứu 3", "Vận hành nhiều agent + người trên hạ tầng chung (Uber, GitHub, Google, Meta, "
                          "Stripe, Kleppmann, Invariant Labs...)", "19 vấn đề"],
                         ["Gộp", "Bỏ trùng, ghép vấn đề gần nhau", "39 vấn đề"],
                         ["Tự chấm", "So với flow trong report Guards + report Autonomous Build", "7 che / 22 một phần / 10 thiếu"],
                         ["Phản biện", "Agent độc lập: với mỗi vấn đề, tìm kịch bản flow vẫn hỏng, rồi đề xuất bản vá nhỏ "
                          "nhất có ngưỡng đo được; thêm vấn đề bị bỏ sót", f"{a['C']} che / {a['P']} một phần / {a['G']} thiếu; +5 vấn đề; sau đó +2 do anh nêu (N6, N7)"],
                         ["Chốt", "Ưu tiên P0/P1/P2, chèn vào đúng bước của dây chuyền", "Mục 3-5"]])))
    parts.append(sec("s2", "2. Bản đồ che phủ",
                     "Màu = kết luận sau phản biện (xanh ngọc che, vàng một phần, hồng thiếu). Bấm vào một vấn đề để tới "
                     "thẻ tranh luận của nó.", cover_map()))
    parts.append(sec("s3", "3. Dây chuyền sau khi vá",
                     "Cùng dây chuyền ở report Autonomous Build, đã chèn các bản vá. Viền vàng: <b>MỚI</b> là bước mới, "
                     "<b>ĐỔI</b> là bước cũ được tăng cứng. Rê chuột (hoặc Tab) lên node để xem thay đổi, vấn đề được "
                     "chặn và ngưỡng.",
                     diagram(render_swimlane(LINE2, "d1", base.LANES_VI, "bước mới / đổi", lang=VI))
                     + "<h3>Bản vá rơi vào bước nào</h3>" + stage_map()))
    parts.append(sec("s4", "4. Top 10 bản vá theo mức giảm rủi ro trên công sức", "",
                     table(["#", "Vấn đề", "Bản vá", "Công sức", "Vì sao đáng làm trước"],
                           [[str(k + 1), esc(i), esc(f), esc(c), esc(w)] for k, (i, f, c, w) in enumerate(TOP10)])))
    cards = []
    for g, gname in GROUPS:
        cards.append(f'<h3>{g}. {esc(gname)}</h3><div class="cards">'
                     + "".join(card(i) for i in ISSUES if i["group"] == g) + "</div>")
    parts.append(sec("s5", "5. Tranh luận từng vấn đề",
                     "Mỗi thẻ: bằng chứng ngoài ngành, kịch bản phản biện mà flow hiện tại vẫn hỏng, cái flow đã có, và "
                     "cách cover. Kết luận trước → sau phản biện.", "".join(cards)))
    status = [("IN-DESIGN", "Có thật trong design", "5", "N6, N7, I17, I19, I27"),
              ("PARTIAL", "Một phần", "24", "I02, N3, I37, I04, I23, I24, I03, I05, I06, I08, I35, I29, I11, I13, I20, "
               "I15, I18, I26, N1, I22, I32, I31, N5, I07"),
              ("PROPOSED-ONLY", "Mới chỉ là đề xuất (chỉ có nhãn 'Tăng cứng')", "16",
               "I01, N2, N4, I09, I10, I30, I21, I39, I12, I14, I16, I25, I28, I38, I33, I34"),
              ("N/A", "Không cần", "1", "I36")]
    risks = [
        ("R1", "P0", "Model phán xét tự quyết khi nào spec 'thật sự thiếu'", "Model mạnh gần như luôn lập luận được là spec "
         "ngụ ý câu trả lời → âm thầm lấp khoảng trống nghiệp vụ, vượt quyền người ở mục 3",
         "Mọi quyết định phải trích quote_id chứa đúng dữ kiện quyết định (kiểm chuỗi như r7); không trích được → tự chuyển mục 3"),
        ("R2", "P0", "Model phán xét được chấm bằng chính bộ test builder nhắm tới", "Chưa có holdout, fixture / mock chưa "
         "khóa → quyết định 'lách test' được chấm đúng và thành tiền lệ tốt",
         "Chấm quyết định bằng kết quả có cả bộ holdout builder không thấy; hiện xanh mà holdout đỏ = quyết định sai"),
        ("R10", "P0", "Graph dò mâu thuẫn rỗng với hệ thống cũ chưa từng ingest", "CR đầu tiên trên hệ thống cũ báo 'không "
         "mâu thuẫn' vì graph không có quy tắc nào",
         "Mỗi lần dò báo độ phủ entity; < 80% → UNSCANNED, đưa vào lượt hỏi người; bootstrap quy tắc từ test / code cũ"),
        ("R3", "P1", "Khung giờ cố định kéo vòng kiểm lên nhiều ngày", "Fixer đi chuyến 22:00, kiểm lúc 10:00 hôm sau; 3 thế "
         "hệ Fixer + 3 lần chọn lại = 3-6 ngày cho một F-item",
         "Fixer / quyết định phải đỏ → xanh trên preview trước khi lên chuyến; QAS chỉ để xác nhận"),
        ("R4", "P1", "Preview lệch QAS", "Xanh trên preview, đỏ trên QAS mỗi ngày (big bang quay lại)",
         "Preview dựng từ cùng artifact + config-as-code, dữ liệu từ snapshot QAS đã che; cảnh báo khi tỉ lệ lệch > 10%"),
        ("R5", "P1", "Chuyến gộp nhiều thay đổi → không biết lỗi do ai", "Lịch sử của model phán xét bị gán nhãn sai",
         "Chỉ tính khi test fail truy về claim của quyết định; còn lại gắn 'không quy được', loại khỏi lịch sử"),
        ("R6", "P1", "Lịch sử của model phán xét bị đầu độc", "Bằng chứng chứa chữ bị tiêm, kết quả flaky, kết quả của phiên "
         "bản model cũ", "Lịch sử chỉ do code ghi, dạng bản ghi có cấu trúc; version theo model phán xét; bản ghi cũ giảm trọng số"),
        ("R7", "P1", "Hồi quy về trung bình khi chấm bài học", "Cụm lỗi được chọn vì đang tăng, tự giảm sau đó → chấm 'đúng' "
         "cho nguyên nhân sai", "Chia ngẫu nhiên 50/50 có / không có bài học; chấm bằng kết quả (QAS xanh lần đầu, lỗi lọt UAT)"),
        ("R8", "P1", "'Code cấm nới lỏng guard' nhưng guard chưa được xây / liệt kê", "Bài học hay phiên bản agent nới lỏng bằng "
         "lời, không chạm config", "Registry guard (tham số, chiều an toàn); model phán xét / Distiller không ghi được; eval đối kháng ở k3"),
        ("R9", "P1", "Model phán xét chung điểm mù với builder", "'Khác model' vẫn có thể cùng nhà cung cấp",
         "Khác nhà cung cấp với builder và reviewer; model thứ hai kiểm chéo 10% quyết định; bất đồng > 20% / tháng → đổi"),
        ("R11-R12", "P1", "Graph không được dò lại / ghi lại đủ", "Đối chiếu đổi nghĩa nhưng không dò lại; bug fix không ghi "
         "quy tắc vào graph", "Dò lại F-item đổi ở r8; ghi graph là cổng hoàn tất ở cả 3 flow; 0 test khóa 'mồ côi'"),
        ("R13", "P1", "Câu 'thay thế' cẩu thả / bị tiêm tự gỡ quy tắc cũ", "Không qua người",
         "Tự thay thế chỉ ngoài vùng tiền, quyền, xóa dữ liệu, giao diện ngoài; trong vùng đó vào lượt hỏi người"),
        ("R14", "P1", "Câu hỏi người không có hạn", "Thẻ vàng mãi", "Hạn 2 ngày làm việc rồi báo lên cấp trên; không tự chọn mặc định"),
        ("R15", "P1", "Các điểm escalate cũ mâu thuẫn với quyết định mới", "Mục 1 vẫn 'F-item đỏ quá 15 phút → gọi người'; "
         "g4, g1, c2, t10 không nói gọi ai", "Một bảng: mỗi điểm escalate đúng một đích: người-§3, phán xét-§6, hoặc INFRA"),
        ("R16-R21", "P1", "Deploy theo giờ: UAT bị đổi bản dưới chân, migration + blue/green, một thay đổi hỏng chặn cả "
         "chuyến, lạm dụng urgent, QAS dùng chung nhiều project, phát hiện 'làm thêm' quá tay (toast, spinner)", "-",
         "UAT trên môi trường ghim hoặc đóng băng chuyến; migration 'contract' đi chuyến riêng; chia đôi chuyến hỏng trong 30 phút; "
         "urgent chỉ do danh tính người, cảnh báo > 20% deploy / tuần; khung giờ theo QAS; 'không có trong spec' phân 3 loại"),
    ]
    upgrades = [
        ("1", "Cổng trích dẫn cho model phán xét", "d8, e5, bảng phán xét §8", "100% quyết định có quote_id hợp lệ; không → mục 3", "5,2"),
        ("2", "Bảng đích escalate", "§1, g1, g4, c2, g5, t10, bf*", "0 điểm escalate không có đích; bỏ 'đỏ quá 15 phút → người'", "2,4"),
        ("3", "Gói toàn vẹn test", "a3/r9, g2, g3, g5, d8", "holdout khác provider, khóa fixture / mock, đếm test, 0 skip mới, "
         "quarantine không tính xanh, burn-in 10/10", "đã tính trong khối 9, 12"),
        ("4", "Kiểm trên preview trước + preview giống QAS", "§7, p2, g5, d8", "vòng Fixer trung vị < 4 giờ; lệch preview / QAS < 10%", "10,4"),
        ("5", "Cổng độ phủ graph", "r5c, en3, ns3, h1, en16, bf13", "độ phủ ≥ 80% hoặc UNSCANNED; bootstrap; 0 test mồ côi", "10,4"),
        ("6", "Vệ sinh lịch sử phán xét", "d8, e5", "chỉ bản ghi có cấu trúc; kết quả không quy được bị loại", "5,2"),
        ("7", "Chấm bài học ngẫu nhiên hóa", "e5, e7, §8 Đo", "50/50, ≥ 30 unit mỗi nhánh, chấm bằng kết quả", "5,2"),
        ("8", "Khe trống + Sổ giả định", "g1/r8, r5h", "mọi assertion truy về quote hoặc ASSUMED", "đã tính trong khối 7"),
        ("9", "Registry guard + xây guard thật", "g3, e8, k3", "SAST/SCA, allowlist dependency, gitleaks chạy thật", "phần lớn trong khối 12, + 5,2"),
        ("10", "Đa dạng + kiểm chéo model phán xét", "§4, §8", "khác provider; kiểm chéo 10%; đo hằng tuần", "5,2"),
        ("11", "Đường đổi spec giữa run (bản tối thiểu)", "h0, en0, r11, c3", "hủy lease F-item đổi, tái dùng unit xanh; > 30% → lập lại kế hoạch", "10,4"),
        ("12", "Vệ sinh deploy", "p2, h1, bf11, U2", "UAT ghim; migration contract đi riêng; chia đôi chuyến hỏng; urgent chỉ người", "10,4"),
    ]
    parts.append(sec("s7", "7. Đánh giá lại design sau khi chốt (lần 2)",
                     "Một reviewer độc lập (model mạnh) chấm lại <b>design thật</b> (report Autonomous Build sau mọi chỉnh "
                     "sửa) với 46 vấn đề. Cách chấm chặt: dòng 'Tăng cứng (report Issues)' trong thẻ node chỉ là nhãn, "
                     "<b>không tính là đã có trong design</b>; chỉ tính khi phần 'Cơ chế' hoặc 'Luật' thật sự mô tả bản vá. "
                     "Các quyết định đã chốt được giữ nguyên làm ràng buộc: mục 3 do người quyết; mục 6 và 8 do model phán "
                     "xét, run sau chấm; deploy theo khung giờ cố định.",
                     table(["Trạng thái", "Ý nghĩa", "Số", "Vấn đề"], [[esc(a), esc(b), c, esc(d)] for a, b, c, d in status])
                     + "<h3>Rủi ro mới sinh ra từ các quyết định hôm nay</h3>"
                     + table(["#", "Ưu tiên", "Rủi ro", "Vì sao", "Cách giảm (giữ nguyên quyết định)"],
                             [[a, pchip(b), esc(c), esc(d), esc(e)] for a, b, c, d, e in risks])
                     + "<h3>12 nâng cấp nên đưa vào design tiếp theo</h3>"
                     + table(["#", "Nâng cấp", "Chỗ trong design", "Luật đo được", "Công sức thêm (giờ)"],
                             [[a, esc(b), esc(c), esc(d), esc(e)] for a, b, c, d, e in upgrades])
                     + '<div class="assume"><b>Kết luận:</b> Chắc: control plane là code, quyền quyết định rõ theo từng node, '
                       'deploy theo khung giờ + blue/green (N7), dò mâu thuẫn spec có người chốt (N6), ngân sách + lỗi INFRA '
                       '(I17), migration (I19), trần vòng lặp (I27). Yếu: 40 / 46 vấn đề mới che một phần hoặc chỉ là đề '
                       'xuất; design đọc thấy an toàn hơn thực tế. <b>Lỗ lớn nhất:</b> model phán xét và vòng học lấy kết '
                       'quả test làm sự thật duy nhất, nhưng toàn vẹn test chưa được xây (chưa holdout, fixture chưa khóa, '
                       'quarantine vẫn có thể tính xanh, chuyến gộp không quy được lỗi) → lịch sử tự sửa có thể học cách '
                       'qua test thay vì làm đúng. Lỗ thứ hai: model phán xét tự quyết khi nào spec "thiếu", có thể vượt '
                       'quyền người ở mục 3; và dò mâu thuẫn mù với hệ thống cũ chưa có graph. <b>Làm trước:</b> nâng cấp '
                       '1-3 (rẻ, hợp cả ba quyết định, làm cho vòng không có người an toàn để chạy).</div>'))
    parts.append(sec("s6", "8. Nguồn", "Các trang đã được mở trong lúc nghiên cứu. Một số số liệu lấy từ nguồn thứ cấp "
                     "(Google flaky, Perforce 64%, Microsoft review latency); xem chú thích trong thẻ.", sources()))
    return render(parts)


EXTRA_CSS = """
.bars{margin:14px 0}.barrow{margin:8px 0}.bt{font-size:13px;color:var(--dim);margin-bottom:4px}
.bar{display:flex;gap:4px}.seg{border:2px solid;border-radius:6px;padding:4px 8px;font-size:12.5px;font-weight:800;
white-space:nowrap;overflow:hidden}
.chip{display:inline-block;border:1.6px solid;border-radius:5px;padding:0 6px;font-size:12px;font-weight:800}
.chip.sm{opacity:.75}
.cmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;margin:12px 0}
.cg{border:2px dashed var(--line);border-radius:12px;padding:10px;background:#0b1220}
.cgh{font-weight:800;color:var(--cyan);margin-bottom:8px}
.ci{display:block;border-left:3px solid;padding:3px 8px;margin:4px 0;font-size:12.5px;color:var(--text);
text-decoration:none;background:var(--panel);border-radius:0 6px 6px 0}
.ci:hover{filter:brightness(1.3)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px}
.card{border:2px solid var(--line);border-radius:10px;background:var(--panel);padding:12px 14px;font-size:13px;
line-height:1.5;scroll-margin-top:16px}
.card:target{border-color:var(--yellow);box-shadow:0 0 14px -2px rgba(253,230,138,.5)}
.ch{font-size:14.5px;font-weight:800;margin-bottom:4px}.ch b{color:var(--teal)}
.cv{margin-bottom:8px}.row{margin:6px 0;padding-left:10px;border-left:3px solid var(--line)}
.row span{display:block;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
.ev span{color:var(--dim)}.at{border-color:var(--pink)}.at span{color:var(--pink)}
.hv{border-color:var(--teal)}.hv span{color:var(--teal)}.fx{border-color:var(--yellow)}.fx span{color:var(--yellow)}
.src{margin-top:8px;font-size:11.5px}.src a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srcs{font-size:12.5px}.srcs a{word-break:break-all}
@media (max-width:600px){.cards,.cmap{grid-template-columns:1fr}}
"""


def render(parts):
    shell = base.TEMPLATE.format(body="@@BODY@@")
    style = re.search(r"<style>(.*?)</style>", shell, re.S).group(1)
    script = re.search(r'(<div id="tip"></div>\s*<script>.*?</script>)', shell, re.S).group(1)
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI SDLC Issues Debate</title>
<style>{style}{EXTRA_CSS}</style></head><body><main>
<h1>AI SDLC — {len(ISSUES)} vấn đề thường gặp, phản biện với flow hiện tại</h1>
<p class="byline">2026-10-10 · Rowan · tiếp theo AI-SDLC-Guards-Report.html và AI-SDLC-Autonomous-Build-Report.html</p>
<div class="assume"><b>Câu hỏi:</b> các quy trình phát triển phần mềm (cả kiểu cũ lẫn có agent AI) thường hỏng ở đâu, và
dây chuyền implementation + testing tự động của mình có chịu được không? Mỗi vấn đề có bằng chứng ngoài ngành, một kịch bản
phản biện cụ thể, và một bản vá có ngưỡng đo được.</div>
<nav><a href="#s0">0 Kết luận</a><a href="#s1">1 Cách làm</a><a href="#s2">2 Bản đồ</a><a href="#s3">3 Dây chuyền mới</a>
<a href="#s4">4 Top 10</a><a href="#s5">5 Tranh luận</a><a href="#s7">7 Đánh giá lần 2</a><a href="#s6">8 Nguồn</a></nav>
{"".join(parts)}
<p class="dim">Generated by docs/design/source/make_issues_report.py (dữ liệu issue_debate_data.py, renderer swimlane.py).
Các bản vá chưa được thử trên run thật.</p>
{script}
</main></body></html>"""


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                                               "AI-SDLC-Issues-Debate-Report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page())
    print("wrote", os.path.abspath(out))
