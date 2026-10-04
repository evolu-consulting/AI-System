"""WRK-NFR-06 · test sanity của khung Python."""

import sys

import agent_runtime


def test_wrk_nfr_06_package_importable() -> None:
    assert agent_runtime.__version__ == "0.0.0"


def test_wrk_nfr_06_runs_on_python_312_plus() -> None:
    assert sys.version_info >= (3, 12)
