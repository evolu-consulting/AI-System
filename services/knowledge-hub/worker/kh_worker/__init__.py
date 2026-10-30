"""kh_worker - Knowledge Hub's only LLM process (roadmap item E, design docs/roadmap-e-to-5-design.md 3.2).

It runs outside KH, calls ``/distill/next|submit`` and ``/daily/next|submit`` as the ``kh_people`` principal
``worker``, and keeps every call under hard caps (``budget``). Modules: ``main`` (config, scheduler, CLI),
``khclient`` (KH HTTP), ``llm`` (adapters anthropic | claude_cli | dry), ``budget`` (caps and prices).
Jobs live in ``kh_worker.jobs`` (slice S10).
"""
__version__ = "0.1.0"
