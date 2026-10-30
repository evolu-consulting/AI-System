"""Feature graph (phase A of the dependency-ordered build): the spec as features, data, contracts and rules
with their relations, so the line builds in dependency order and stops instead of letting an agent invent
something no feature provides. Off by default (fgraph_enabled / LINE_FGRAPH=1).

  model.py   nodes, edges, check()                         (A1)
  derive.py  multi-hop depends_on, gaps, order, questions  (A3)
"""

from .derive import depth, derive, gap_questions, must_precede, needs_text, topo
from .model import EDGE_KINDS, NODE_KINDS, FEdge, FeatureGraph, FNode, check, depends_adj, find_cycle, from_dict, to_dict

__all__ = ["EDGE_KINDS", "NODE_KINDS", "FEdge", "FNode", "FeatureGraph", "check", "depends_adj", "derive", "depth",
           "find_cycle", "from_dict", "gap_questions", "must_precede", "needs_text", "to_dict", "topo"]
