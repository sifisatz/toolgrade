import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunReport } from "./runner.js";

const run = promisify(execFile);

export interface RunMeta {
  branch?: string;
  commit?: string;
  commitMessage?: string;
}

export interface UploadResult {
  id: string;
  url: string;
}

/** CI env first (GitHub Actions), then the local git checkout; both optional. */
export async function detectGitMeta(cwd = process.cwd()): Promise<RunMeta> {
  const env = process.env;
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD"));
  const commit = env.GITHUB_SHA || (await git(cwd, "rev-parse", "HEAD"));
  return { ...(branch ? { branch } : {}), ...(commit ? { commit } : {}) };
}

async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function uploadReport(baseUrl: string, apiKey: string, report: RunReport, meta: RunMeta, fetchFn: typeof fetch = fetch, suiteYaml?: string): Promise<UploadResult> {
  const res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/api/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(suiteYaml !== undefined ? { report, meta, suiteYaml } : { report, meta }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as UploadResult;
}

export interface BaselineQuery {
  suite: string;
  /** Match only this branch's runs (e.g. the PR's base branch); omitted matches any branch. */
  branch?: string;
}

/**
 * The most recent run uploaded for this suite (and branch, if given), or undefined when the
 * project has none yet - a new project's first CI run should not be treated as a regression.
 */
export async function fetchBaseline(baseUrl: string, apiKey: string, query: BaselineQuery, fetchFn: typeof fetch = fetch): Promise<RunReport | undefined> {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/v1/runs/latest`);
  url.searchParams.set("suite", query.suite);
  if (query.branch) url.searchParams.set("branch", query.branch);
  const res = await fetchFn(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`baseline fetch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { report: RunReport };
  return body.report;
}
