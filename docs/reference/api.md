# Platform API Reference

The ToolGrade platform exposes a REST API used by the CLI for uploading run reports and fetching baselines. This reference is primarily for custom integrations; most users will use the CLI or GitHub Action instead.

**Base URL:** `https://app.toolgrade.dev`

---

## Authentication

API requests use project-scoped API keys.

```
Authorization: Bearer tg_<key>
```

API keys are created in your project's **Settings** page. Each key is associated with exactly one project. Keys are shown only once at creation — store them securely.

**Key format:** `tg_` prefix followed by a random string.

---

## Endpoints

### `POST /api/v1/runs`

Ingest a run report from the CLI.

**Request:**
```
POST /api/v1/runs
Authorization: Bearer tg_<key>
Content-Type: application/json

<run report JSON>
```

The request body is the full JSON report produced by `toolgrade run` (the content of `.toolgrade/runs/latest.json`).

**Limits:**
- Maximum request size: 5 MB
- Rate limit: 30 requests per minute per API key

**Success response — `201 Created`:**
```json
{
  "id": "run_01jh5xm4p3kgq9n7abc123",
  "url": "https://app.toolgrade.dev/app/acme/my-project/runs/run_01jh5xm4p3kgq9n7abc123"
}
```

| Field | Description |
|---|---|
| `id` | Unique run ID in the platform |
| `url` | Direct link to the run detail page in the dashboard |

**Error responses:**

| Status | Meaning |
|---|---|
| `400 Bad Request` | Invalid or malformed JSON report |
| `401 Unauthorized` | Missing or invalid API key |
| `402 Payment Required` | Plan's monthly evaluation unit limit exceeded |
| `413 Payload Too Large` | Report exceeds 5 MB |
| `429 Too Many Requests` | Rate limit exceeded |
| `503 Service Unavailable` | Database unavailable |

---

### `GET /api/v1/runs/latest`

Fetch the most recent run matching optional filters. Used by the CLI's `--baseline` flag to fetch the latest run on the target branch for comparison.

**Request:**
```
GET /api/v1/runs/latest?suite=my-server&branch=main
Authorization: Bearer tg_<key>
```

**Query parameters:**

| Parameter | Required | Description |
|---|---|---|
| `suite` | — | Filter by suite name (must match `name` field in report) |
| `branch` | — | Filter by git branch |

If no parameters are given, returns the most recent run for the project regardless of suite or branch.

**Success response — `200 OK`:**

The response body is the full run report JSON (same format as the uploaded report), plus a `platformId` field:

```json
{
  "platformId": "run_01jh5xm4p3kgq9n7abc123",
  "version": 1,
  "suite": "my-server",
  "timestamp": "2026-01-15T14:23:00.000Z",
  ...
}
```

**Error responses:**

| Status | Meaning |
|---|---|
| `401 Unauthorized` | Missing or invalid API key |
| `404 Not Found` | No runs found matching the filters |

---

### `GET /api/health`

Health check endpoint. No authentication required.

```
GET /api/health
```

**Response — `200 OK` (healthy):**
```json
{
  "status": "ok",
  "database": "connected"
}
```

**Response — `503 Service Unavailable` (degraded):**
```json
{
  "status": "degraded",
  "database": "error"
}
```

---

## Usage in the CLI

The CLI's `--upload` and `--baseline` flags use this API:

```bash
# Upload a run
toolgrade run toolgrade.yaml --upload https://app.toolgrade.dev

# Fetch baseline for comparison
toolgrade run toolgrade.yaml --baseline https://app.toolgrade.dev
```

Both require `TOOLGRADE_API_KEY` to be set.

---

## Example: custom upload script

```bash
#!/bin/bash
# Upload a report to ToolGrade and print the dashboard URL

REPORT=".toolgrade/runs/latest.json"
PLATFORM_URL="https://app.toolgrade.dev"

RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer ${TOOLGRADE_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary "@${REPORT}" \
  "${PLATFORM_URL}/api/v1/runs")

DASHBOARD_URL=$(echo "$RESPONSE" | jq -r '.url')
echo "Run uploaded: ${DASHBOARD_URL}"
```

---

## Rate limits

| Limit | Value |
|---|---|
| Uploads per minute per key | 30 |
| Maximum report size | 5 MB |

If you hit rate limits in a high-volume CI environment, spread uploads across multiple API keys (one per project is the intended model).

---

## Plan limits

| Plan | Evaluation units/month | What counts as a unit |
|---|---|---|
| Free | 0 | — |
| Early Access | 1,000 | 1 task × 1 trial × both arms |
| Team | 2,500 | 1 task × 1 trial × both arms |
| Growth | 5,000 | 1 task × 1 trial × both arms (org-wide) |

A run with 10 tasks and 3 trials uses `10 × 3 = 30` evaluation units.

When the monthly limit is exceeded, the `/api/v1/runs` endpoint returns `402 Payment Required`. Existing run data is not affected; only new uploads are blocked.
