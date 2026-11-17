# Assertions Reference

Assertions define what must be true for a task to pass. They fall into two categories:

- **Process assertions** — check *how* the agent behaved (tool calls, counts, arguments). Run only in the with-tools arm.
- **Outcome assertions** — check the final answer or server state. Run in *both* arms, generating the lift metric.

A task passes when **all** assertions pass.

---

## `tool_called`

The agent must have called the specified tool at least once (or within a specified range).

**Type:** Process

```yaml
# Basic: tool must be called at least once
- type: tool_called
  tool: create_note

# With call count range
- type: tool_called
  tool: search_notes
  min_times: 1
  max_times: 3

# With argument matching
- type: tool_called
  tool: update_note
  args_contains:
    id: "note-42"
    title: "Updated title"
```

| Field | Required | Default | Description |
|---|---|---|---|
| `tool` | ✅ | — | Exact tool name |
| `min_times` | — | `1` | Minimum number of calls |
| `max_times` | — | `∞` | Maximum number of calls |
| `args_contains` | — | — | Each key-value pair must appear in at least one call |

**`args_contains` matching:** Each provided key must be present in the call arguments, and the value must match either exactly (for strings, numbers, booleans) or be contained within (for strings). This checks that *at least one* call has these arguments — not necessarily the same call for each key.

---

## `tool_not_called`

The agent must not have called the specified tool at all.

**Type:** Process

```yaml
- type: tool_not_called
  tool: delete_all_notes    # must never be called
```

| Field | Required | Description |
|---|---|---|
| `tool` | ✅ | Tool that must not be called |

**Use case:** Restraint tasks — verify the agent doesn't call destructive or unnecessary tools when it shouldn't.

```yaml
- id: restraint-no-delete
  prompt: "List all my notes sorted by date."
  assert:
    - type: tool_called
      tool: list_notes
    - type: tool_not_called
      tool: delete_note     # agent should never delete while listing
```

---

## `max_tool_calls`

The total number of tool calls across all tools must not exceed the threshold.

**Type:** Process

```yaml
- type: max_tool_calls
  value: 5    # agent must complete the task in 5 or fewer tool calls
```

| Field | Required | Description |
|---|---|---|
| `value` | ✅ | Maximum total tool calls allowed |

**Use case:** Efficiency — prevent agents from making excessive, redundant, or exploratory calls that waste tokens and latency.

---

## `output_contains`

The agent's final answer must contain the specified string(s).

**Type:** Outcome

```yaml
# Simple: answer must contain this string
- type: output_contains
  value: "successfully deleted"

# Multiple strings: answer must contain all of them
- type: output_contains
  value: ["note created", "Shopping list"]
  mode: all       # all strings must be present (default)

# Any: at least one must be present
- type: output_contains
  value: ["created", "added", "saved"]
  mode: any

# Case-sensitive matching
- type: output_contains
  value: "ERROR"
  case_sensitive: true

# Negated: answer must NOT contain this string
- type: output_contains
  value: "I cannot"
  negate: true
```

| Field | Required | Default | Description |
|---|---|---|---|
| `value` | ✅ | — | String or array of strings to look for |
| `mode` | — | `all` | `all` (all strings required) or `any` (at least one) |
| `case_sensitive` | — | `false` | Whether matching is case-sensitive |
| `negate` | — | `false` | Flip the assertion (must NOT contain) |

---

## `output_regex`

The agent's final answer must match the specified regular expression.

**Type:** Outcome

```yaml
# Match a pattern
- type: output_regex
  pattern: "\\d+ notes? (?:found|deleted)"

# Negated: answer must NOT match
- type: output_regex
  pattern: "(?i)error|failed|could not"
  negate: true
```

| Field | Required | Default | Description |
|---|---|---|---|
| `pattern` | ✅ | — | Regular expression (JavaScript syntax) |
| `negate` | — | `false` | Flip the assertion (must NOT match) |

**Tip:** Use `(?i)` for case-insensitive matching. Escape backslashes: `\\d+` in YAML represents the regex `\d+`.

---

## `state`

After the agent finishes, calls a tool on your server and checks its response.

**Type:** Outcome

```yaml
# Server state must contain these strings after the agent ran
- type: state
  tool: get_note
  args:
    title: "Shopping list"
  output_contains: ["milk", "eggs", "bread"]

# Server state must NOT contain these strings
- type: state
  tool: list_notes
  args: {}
  output_contains_not: ["Draft - OLD", "Deleted entry"]

# Both can be combined
- type: state
  tool: get_note
  args: { id: "42" }
  output_contains: ["Updated content"]
  output_contains_not: ["Original content"]
```

| Field | Required | Description |
|---|---|---|
| `tool` | ✅ | Tool to call after the agent finishes |
| `args` | ✅ | Arguments to pass to the tool |
| `output_contains` | — | Strings that must appear in the tool's response |
| `output_contains_not` | — | Strings that must NOT appear in the tool's response |

At least one of `output_contains` or `output_contains_not` must be provided.

**Why `state` assertions matter:**

An agent can claim success without actually doing anything. The `state` assertion bypasses the agent's answer entirely and queries your server directly. An agent that says "I deleted the note" but didn't actually call `delete_note` — or called it with wrong arguments — will fail a `state` assertion.

```yaml
# Weak: trusts what the agent says
- type: output_contains
  value: "note deleted"

# Strong: verifies the note is actually gone
- type: state
  tool: get_note
  args: { id: "note-42" }
  output_contains_not: ["note-42", "Shopping list"]
```

---

## `llm`

An LLM judge evaluates the agent's final answer against a rubric.

**Type:** Outcome

```yaml
- type: llm
  rubric: |
    The agent should have:
    1. Listed all notes tagged 'urgent'
    2. Returned only their titles, not body content
    3. Not made up any note titles that weren't in the system
    4. Responded in a concise, list format
```

| Field | Required | Description |
|---|---|---|
| `rubric` | ✅ | Natural language description of what a passing answer looks like |

**How it works:** The judge model receives the full conversation (task prompt + agent response), the rubric, and is asked to output `{verdict: "pass" | "fail", reason: "..."}`. The reason is included in the report when the assertion fails.

**Injection safety:** Tool calls and agent answers are wrapped in randomly named tags before being shown to the judge, preventing prompt injection attacks from agent outputs that try to manipulate the rubric evaluation.

**When to use `llm` assertions:**
- When the correct answer requires judgment (e.g., "did the agent give a helpful summary?")
- When exact string matching is too brittle (e.g., the answer format may vary)
- When you want to verify stylistic or structural properties of the response

**When NOT to use `llm` assertions:**
- When you can use `state` to verify server state directly
- When exact string matching works fine — `llm` assertions are slower and cost more
- As the only assertion — combine with `tool_called` or `state` for stronger guarantees

---

## Combining assertions

Assertions are ANDed: all must pass. Use this to build layered confidence:

```yaml
- id: create-and-verify
  prompt: "Create a note titled 'Test' with body 'Hello world'"
  assert:
    # Did the agent use the right tool?
    - type: tool_called
      tool: create_note
      args_contains:
        title: "Test"
        body: "Hello world"
    
    # Did the agent use only one tool call?
    - type: max_tool_calls
      value: 2
    
    # Does the server state reflect the creation?
    - type: state
      tool: get_note
      args: { title: "Test" }
      output_contains: ["Hello world"]
    
    # Did the agent give a sensible confirmation?
    - type: output_contains
      value: "created"
      case_sensitive: false
```

---

## Assertion execution in both arms

| Assertion type | With-tools arm | Baseline (no-tools) arm |
|---|---|---|
| `tool_called` | ✅ Evaluated | ⏭ Skipped (recorded as "skipped") |
| `tool_not_called` | ✅ Evaluated | ⏭ Skipped |
| `max_tool_calls` | ✅ Evaluated | ⏭ Skipped |
| `output_contains` | ✅ Evaluated | ✅ Evaluated |
| `output_regex` | ✅ Evaluated | ✅ Evaluated |
| `state` | ✅ Evaluated | ✅ Evaluated |
| `llm` | ✅ Evaluated | ✅ Evaluated |

Outcome assertions in the baseline arm are what generate the **lift** metric: how much better the agent performs with tools than without.
