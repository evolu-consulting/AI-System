# line/llm/prompts

Prompt templates, one Markdown file per role: `<role>.md` (for example
`reader.md`, `test_author.md`, `planner.md`, `builder.md`, `fixer.md`).

- Load with `line.llm.load_prompt(role, **vars)`; `{name}` placeholders are filled
  with `str.format_map`, unknown placeholders stay as written.
- A prompt for `complete()` asks for JSON only; the caller passes the schema and the
  cost wrapper appends it, validates the answer and asks for one repair.
- A prompt for `agentic()` must tell the agent to end its final message with a last
  line that is exactly `SUBMIT` or `BLOCKED:<reason>`.
- Retrieved context from the RAG System is inserted by the caller, never stored here.
- No secrets, hostnames or product names in these files.

This directory is a placeholder until the role slices add their prompts.
