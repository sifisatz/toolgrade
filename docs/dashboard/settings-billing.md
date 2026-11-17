# Settings & Billing

Manage API keys, CI configuration, team membership, and your subscription plan.

---

## API keys

**URL:** `/app/[org]/[project]/settings` (requires Owner or Admin role)

API keys authorize the CLI and CI pipeline to upload run reports and fetch baselines for your project.

### Creating a key

1. Go to project **Settings**
2. Under **API Keys**, click **New key**
3. Enter a name (e.g., `github-ci`, `local-dev`)
4. Copy the key — it's shown **only once**

The key starts with `tg_`. Store it immediately in your password manager or as a CI secret.

### Key security

- Keys are stored as SHA-256 hashes — if you lose the key, create a new one
- Each key is scoped to exactly one project
- Key prefixes (the first few characters) are stored for display so you can tell them apart in the list

### Revoking a key

Click **Revoke** next to a key to immediately invalidate it. Any CI jobs using that key will fail on the next run. Create and deploy a replacement key before revoking.

---

## CI setup snippets

The Settings page provides ready-to-copy code snippets so you don't have to remember the exact syntax.

### GitHub Actions snippet

A complete `.github/workflows/toolgrade.yml` pre-filled with your project's upload URL. Copy it directly into your repository.

### Local CLI snippet

The exact `toolgrade run` command with `--upload` and `TOOLGRADE_API_KEY` set, ready to paste in your terminal.

---

## Team management

**URL:** `/app/[org]/members`

### Roles

| Role | Permissions |
|---|---|
| **Owner** | Full access: manage members, billing, API keys, all project data |
| **Admin** | Manage API keys, view all project data; cannot manage billing |
| **Member** | View all project data; cannot create/revoke API keys |

### Changing roles

Owners and Admins can change any member's role (except demoting another Owner). Click the role badge next to a member's name and select a new role.

### Removing members

Click **Remove** next to a member to revoke their access. This does not delete their runs or any data they created.

> **Note:** Invite links are coming soon. Currently, users must create their own account and you can add them from the members page once they've signed up.

---

## Billing

**URL:** `/app/[org]/[project]/settings` → Billing section

### Plans

| Plan | Price | Eval units/month | Run retention | Team | Advanced comparisons |
|---|---|---|---|---|---|
| **Free** | $0 | 0 | None | No | No |
| **Early Access** | $29/mo | 1,000 | 90 days | No | No |
| **Team** | $49/mo | 2,500 | 365 days | Yes | Yes |
| **Growth** | $99/mo | 5,000 | 365 days | Yes | Yes |

**Early Access** and **Team** plans are per-project. **Growth** covers your entire workspace (all projects under one org).

### What counts as an evaluation unit?

One evaluation unit = one task × one trial × evaluated in both arms.

A run with 10 tasks and 3 trials uses `10 × 3 = 30` evaluation units.

**Example monthly budget:**
- 5 pull requests per day × 20 working days = 100 runs/month
- Each run: 10 tasks × 3 trials = 30 units
- Total: 3,000 units/month → Team plan

### Run retention

Runs are stored for the retention period on your plan. After that, the daily cleanup job deletes older runs. The run data is gone — this is not reversible.

If you're on a plan with 90-day retention and want to keep longer history, upgrade before runs age out.

### Usage display

The Settings billing panel shows:
- Current plan name and price
- Evaluation units used this month / monthly limit
- Runs in retention / oldest run timestamp

### Upgrading or changing plans

Click **Manage subscription** in the billing panel to go to the Stripe customer portal, where you can upgrade, downgrade, or cancel your plan.

---

## Account settings

Access account settings from the user menu (top-right corner of the dashboard):

- **Change display name** — your name as shown in the members list and run attribution
- **Change password** — requires your current password
- **Sign out** — ends your session (sessions expire automatically after 7 days of inactivity)

---

## Frequently asked questions

**Can I have multiple projects?**  
Yes. Create as many projects as you need. Each project has its own runs, API keys, and (on project-scoped plans) its own billing.

**What happens if I exceed my evaluation unit limit?**  
New run uploads return `402 Payment Required`. Existing run data is not affected — you can still view all history. Upgrade your plan to restore upload access.

**Can I use the same API key for multiple CI environments?**  
Technically yes, but we recommend creating one key per environment (e.g., `github-ci`, `local-dev`) so you can revoke them independently.

**What's the difference between Early Access and Team plans?**  
Team adds team collaboration (all org members can view runs, not just the key holder) and advanced comparisons (the statistical run-vs-run comparison view).

**Can I self-host the platform?**  
The platform is not currently offered as a self-hosted solution. The CLI and evaluation engine are open source and can be used without the hosted platform.
