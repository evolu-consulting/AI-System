from pathlib import Path

from app.contracts.chunk import chunk_contract
from app.ingest.chunk import ENC, MAX_TOK

D = Path(__file__).parent / "fixtures" / "contracts"


def test_one_chunk_per_article_and_preamble():
    parts = chunk_contract((D / "c1.md").read_text(encoding="utf-8"))
    assert [p["clause_no"] for p in parts] == ["0", "1", "2", "3", "4", "5", "6", "7", "8"]
    assert parts[0]["heading"] == "Mở đầu"
    assert parts[3]["heading"] == "Thanh toán"
    assert "30 ngày" in parts[3]["text"]
    assert parts[3]["text"].startswith("Điều 3. Thanh toán\n")


def test_docling_style_variants_are_boundaries():
    md = ("Mở đầu hợp đồng\n\n## ĐIỀU 1: ĐỐI TƯỢNG\nnội dung một\n\n*Điều 2 – Giá*\nnội dung hai\n\n"
          "Article 3. Term\nbody three\n\nPHỤ LỤC 01 BẢNG GIÁ\n| a | b |\n")
    parts = chunk_contract(md)
    assert [p["clause_no"] for p in parts] == ["0", "1", "2", "3", "PL01"]
    assert parts[2]["heading"] == "Giá"


def test_sentence_that_mentions_an_article_is_not_a_boundary():
    md = "**Điều 1. Sửa đổi**\n" + "Điều 5 của Hợp đồng gốc được sửa đổi như sau: " + "chi tiết " * 40 + "\n"
    assert [p["clause_no"] for p in chunk_contract(md)] == ["1"]


def test_long_article_is_split_with_its_heading_on_every_piece():
    md = "**Điều 9. Bảo mật**\n" + ("Bên nhận thông tin phải giữ bí mật tuyệt đối. " * 400)
    parts = chunk_contract(md)
    assert len(parts) > 1
    assert all(p["clause_no"] == "9" and p["text"].startswith("Điều 9. Bảo mật\n") for p in parts)
    assert all(len(ENC.encode(p["text"])) <= MAX_TOK + 5 for p in parts)


def test_chunk_contract_falls_back_without_articles():
    parts = chunk_contract((D / "c8.md").read_text(encoding="utf-8"))
    assert len(parts) >= 1
    assert all(p["clause_no"].isdigit() for p in parts)
    assert any("1.150" in p["text"] for p in parts)
