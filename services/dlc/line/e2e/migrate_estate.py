"""The estate sample of the feature migration flow (line/samples/migrate-estate) as git repositories.

make_estate(workdir) -> {"v1": folder of 3 repositories, "v1_base": "vanilla", "v2": repo}
  v1/shop_db_order, v1/shop_srv_order: the vanilla order object split by layer (tag "vanilla")
  v1/shop_srv_export: a repository only the customer has (no "vanilla" tag -> everything in it is custom)
  v2: the rewrite of samples/migrate-pair/v2 on branch main
"""

from __future__ import annotations

import os

from ..config import LINE_DIR
from .migrate_pair import PAIR, _commit, _copy, _repo
from ..ship._util import git

ESTATE = os.path.join(LINE_DIR, "samples", "migrate-estate")
REPOS = ("shop_db_order", "shop_srv_order", "shop_srv_export")
VANILLA = ("shop_db_order", "shop_srv_order")


def make_estate(workdir: str) -> dict:
    v1, v2 = os.path.join(workdir, "v1"), os.path.join(workdir, "v2")
    for name in REPOS:
        path = os.path.join(v1, name)
        _repo(path)
        _copy(os.path.join(ESTATE, "v1", name), path)
        _commit(path, "%s (v1.7)" % name)
        if name in VANILLA:
            git(path, "tag", "vanilla")
    _repo(v2)
    _copy(os.path.join(PAIR, "v2"), v2)
    _commit(v2, "store v2")
    return {"v1": v1, "v1_base": "vanilla", "v2": v2}


__all__ = ["make_estate", "ESTATE", "REPOS"]
