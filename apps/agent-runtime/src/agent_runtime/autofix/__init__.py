"""P-c1 · WRK-FR-28 · WRK-FR-29 · HUB-BR-32/33 · Stage tự-sửa (ADR-0011, plan-runtime §5).

`rules` (thuần: argv container, kiểm đường dẫn/kích thước/bí mật, che log, git cứng), `oci`
(`OciCli` gọi docker/podman bằng mảng đối số + tự kiểm lúc khởi động), `fake_oci` (chỉ test).
`workspace` (bản sao + git cứng), `check` (PC-R08), `report` (POST Hub) — R2; `ws_tools` (tool
`ws` trong job host), `prep` (pha trước agent), `host` (`AutofixHost`), `sweeper` (container mồ
côi) — R3.
"""
