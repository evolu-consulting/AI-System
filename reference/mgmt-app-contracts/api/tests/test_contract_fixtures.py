import json
from pathlib import Path

D = Path(__file__).parent / "fixtures" / "contracts"


def test_every_quote_is_verbatim_and_samples_are_marked():
    answers = json.loads((D / "answers.json").read_text(encoding="utf-8"))
    assert len(answers) == 11
    for a in answers:
        md = (D / a["file"]).read_text(encoding="utf-8")
        assert "MẪU – DỮ LIỆU GIẢ LẬP" in md
        for name, f in a["fields"].items():
            if f["value"] is not None:
                assert f["quote"] and f["quote"] in md, (a["file"], name, f["quote"])
        for it in a["items"]:
            assert it["quote"] in md, (a["file"], it["name"])
