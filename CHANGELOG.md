# Changelog

## 0.2.0 - 2026-11-20

Additive release - no breaking changes to the suite YAML schema, CLI flags, or library exports. All existing suites and CI configs keep working unchanged.

### Added

**Tool description A/B testing**
- A task's `variants` key lets you override one or more tool descriptions (or hide a tool entirely with `description: null`) and run that version as an extra arm alongside the base one. Variant arms are reported with their own pass rate but never affect the gate.

**Statistics**
- `passAtK(n, c, k)` - the unbiased pass@k estimator from Chen et al. 2021 ("Evaluating Large Language Models Trained on Code"), computed in log space. Convenience `pass1`/`pass3`/`pass5` helpers.
- `toolEngagementRate` and `perToolSuccessRate` trajectory metrics.

**Static analysis in `toolgrade inspect`** (no model calls)
- A 0-100 description quality score per tool (length, leads with an action verb, mentions its parameters, doesn't repeat its own name, ends as a sentence).
- A safety pass: flags tools whose name/description implies a destructive action but declare no `destructiveHint` annotation, write-shaped tools missing `idempotentHint`, and prompt-injection-shaped text in descriptions or output schemas.
- MCP spec compliance scoring: per-tool and suite-wide percentage, based on documented parameters and declared annotations.
- Suite-design validity checks: near-duplicate tasks, and tasks that rely solely on an unfalsifiable LLM-judge assertion with no deterministic backstop.

**`toolgrade import`**
- Scaffolds a suite directly from an MCP server already configured in Claude Desktop, Claude Code, Cursor, or VS Code. `--detect` reports which client configs exist on the machine without writing anything.

**`toolgrade init`**
- Generates a real, editable draft prompt and assertion per tool (derived from its own schema and description) instead of a bare `TODO:` placeholder. Falls back to the placeholder, task by task, when a draft would trip the suite-validity checks above. `run` still refuses a suite that has any placeholder left.

**Run comparison**
- `compareRuns` now diffs cost and latency per task, not just pass-rate significance. New `--gate-cost-regression <pct>` / `--gate-latency-regression <pct>` flags on `run` fail the gate when cost or latency regresses past that threshold against `--compare`/`--baseline`.
- Trials are now classified `pass` / `fail` / `infra`: a 429, a 400 carrying rate-limit/budget/content-filter/quota wording, or a connection-level error is tagged `infra` and excluded from the `no_errors` gate check and pass-rate math entirely, instead of counting against the tools under test like a real failure. Reported separately ("N trials excluded as infra failures").

**Observability**
- `--otel-export <file>` on `run` writes the report as OpenTelemetry GenAI spans in OTLP/JSON wire format, importable into Jaeger, Langfuse, or Phoenix.

**Server reliability**
- HTTP MCP servers now get per-trial isolation: a suite can declare `server.reset`, a tool ToolGrade calls before every trial so a `state` assertion can't see leftovers from an earlier one.

**Public benchmark**
- Added `server-everything`, `excel-mcp-server`, and `mcp-pandoc` to the credential-free reference suites behind the public benchmark.

### Changed
- README now documents every flag and command above (it had fallen behind).

## 0.1.0 - 2026-11-17

Initial release.
