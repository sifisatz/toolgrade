# Using Ollama Locally

ToolGrade works with any OpenAI-compatible API endpoint — including [Ollama](https://ollama.ai), which lets you run open-source models on your own machine at zero per-token cost.

This is useful when:
- You're developing and iterating on a suite and don't want to burn API credits
- You want CI on a self-hosted runner with no external API dependency
- You're evaluating cost-sensitive use cases

---

## Setup

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh
```

### 2. Start the server

```bash
ollama serve
```

Ollama listens on `http://localhost:11434` by default.

### 3. Pull a model

```bash
# A capable mid-size model (~5GB)
ollama pull qwen3:8b

# Smaller, faster option (~2GB)
ollama pull qwen3:4b

# Larger, more capable option (~15GB)
ollama pull llama3.3:70b
```

---

## Running ToolGrade with Ollama

```bash
npx toolgrade run toolgrade.yaml \
  --provider openai \
  --base-url http://localhost:11434/v1 \
  --model qwen3:8b \
  --local-model \
  --concurrency 2
```

**Flag notes:**
- `--provider openai` — uses the OpenAI-compatible client instead of the Anthropic SDK
- `--base-url` — points to Ollama's OpenAI-compatible endpoint
- `--model` — the Ollama model name (must match what you pulled)
- `--local-model` — tells ToolGrade to report $0 cost (no pricing lookup)
- `--concurrency 2` — lower concurrency is safer with local models; Ollama processes requests sequentially

---

## Suite configuration for Ollama

You can embed the provider configuration directly in your suite file:

```yaml
name: my-server

server:
  command: node
  args: [dist/server.js]

agent:
  model: qwen3:8b
  max_turns: 10

run:
  trials: 3
  concurrency: 2

# No gate needed during local development
# gate:
#   min_pass_rate: 0.8
```

Then run:

```bash
npx toolgrade run toolgrade.yaml --provider openai --local-model
```

---

## Using a different judge model

By default the judge model matches the agent model. For LLM judge assertions (`type: llm`), you might want a stronger judge than your agent:

```bash
# Run agent on small local model, judge on larger one
npx toolgrade run toolgrade.yaml \
  --provider openai \
  --model qwen3:4b \
  --judge-model qwen3:8b \
  --local-model
```

---

## In GitHub Actions (self-hosted runner)

If you have a self-hosted GitHub Actions runner, you can run ToolGrade with Ollama in CI for free:

```yaml
jobs:
  eval:
    runs-on: self-hosted   # your runner with Ollama installed
    steps:
      - uses: actions/checkout@v4

      - name: Start Ollama
        run: ollama serve &

      - name: Pull model
        run: ollama pull qwen3:8b

      - uses: toolgrade/toolgrade@v0
        with:
          suite: toolgrade.yaml
          provider: openai
          base-url: http://localhost:11434/v1
          model: qwen3:8b
          local-model: "true"
        env:
          TOOLGRADE_API_KEY: ${{ secrets.TOOLGRADE_API_KEY }}
```

No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` required.

---

## Model quality considerations

Local models generally score lower than frontier models on complex reasoning tasks. What this means in practice:

- Expect lower absolute pass rates — calibrate your gate thresholds accordingly
- Simple tool-use tasks (CRUD operations with clear prompts) work well with 7–8B models
- Complex multi-step reasoning or nuanced evaluation (LLM judge assertions) may require larger models
- Run your suite with both a local model and a frontier model to understand the gap before committing to local-only CI

---

## Other OpenAI-compatible endpoints

The `--provider openai` flag works with any OpenAI-compatible API:

```bash
# OpenAI
npx toolgrade run toolgrade.yaml \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --model gpt-4o

# Groq (fast inference)
npx toolgrade run toolgrade.yaml \
  --provider openai \
  --base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile \
  --api-key-env GROQ_API_KEY

# Google Gemini (via OpenAI-compatible endpoint)
npx toolgrade run toolgrade.yaml \
  --provider openai \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai/ \
  --model gemini-2.5-pro \
  --api-key-env GEMINI_API_KEY
```

The `--api-key-env` flag lets you specify which environment variable holds the key (defaults to `OPENAI_API_KEY`).
