<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

Use code-review-graph first for codebase exploration, impact analysis, and reviews.

### Default workflow

1. Start with `get_minimal_context(task="<task>")`.
2. Use `query_graph` for callers, callees, imports, tests, and children.
3. Use `get_impact_radius` for blast-radius checks.
4. Use `get_review_context` or `detect_changes` for reviews.
5. Use `detail_level="minimal"` unless you need more detail.

### Token rules

- Prefer graph queries over broad grep/read passes.
- Read the smallest relevant files only when the graph cannot answer.
- Keep review/debug/refactor work under 5 graph calls when possible.
