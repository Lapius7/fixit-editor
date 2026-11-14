// GitHub の REST API を呼ぶ小さなクライアント。トークンはこの PC のこのアプリの保存領域に置く(AI の API キーと同じ扱い)。
// 画面側は、ここの関数だけを使う。型は、画面で使う項目だけを書いてある。
import i18next from "i18next";
import { useSyncExternalStore } from "react";
import { kvDel, kvGet, kvSet } from "@/platform/appdata";

const KEY = "fixit:gh:v1";
const API = "https://api.github.com";
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const ghToken = (): string => kvGet(KEY) ?? "";
export function setGhToken(t: string) {
  const v = t.trim();
  if (v !== ghToken()) clearGhCache();
  if (v) kvSet(KEY, v); else kvDel(KEY);
  emit();
}
export const useGhToken = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), ghToken);

export class GhError extends Error {
  constructor(msg: string, public status: number, public scopes = "") { super(msg); }
}

export type Slug = { owner: string; repo: string };
export const slugOf = (s: Slug) => `${s.owner}/${s.repo}`;

// `git remote -v` の出力から、GitHub のリモートだけを取り出す。同じ名前の fetch / push は 1 つにまとめる
export type Remote = { name: string; url: string; owner: string; repo: string };
export function parseGhUrl(url: string): Slug | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}
export function parseRemotes(raw: string): Remote[] {
  const seen = new Set<string>(), out: Remote[] = [];
  for (const line of raw.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/.exec(line.trim());
    if (!m || seen.has(m[1])) continue;
    const s = parseGhUrl(m[2]);
    if (!s) continue;
    seen.add(m[1]);
    out.push({ name: m[1], url: m[2], ...s });
  }
  return out;
}

// GET の結果を ETag つきで覚える。次は If-None-Match を付けて聞き、変わっていなければ 304 で済ませる(304 はレート制限に数えられない)。
// 非公開リポジトリの中身も入るので、トークンと同じアプリの保存領域に置き、トークンが変わる・消えるときは全部捨てる。
// 壊れていたり読めなかったりしたときは、使わないだけで、通常どおり取得する。
const CKEY = "fixit:ghc:v1";
const C_MAX_ENTRIES = 150, C_MAX_CHARS = 1_500_000, C_MAX_ONE = 200_000;
type CEnt = { etag: string; text: string; at: number };
let cmem: Map<string, CEnt> | null = null;
let csave = 0;
function cache(): Map<string, CEnt> {
  if (cmem) return cmem;
  cmem = new Map();
  try {
    const raw = JSON.parse(kvGet(CKEY) ?? "null") as { v?: number; tok?: string; e?: [string, CEnt][] } | null;
    // 保存したときのトークンと違えば、別のアカウントの結果なので使わない
    if (raw?.v === 1 && raw.tok === tokTag(ghToken()) && Array.isArray(raw.e))
      for (const [k, e] of raw.e) if (typeof k === "string" && typeof e?.etag === "string" && typeof e.text === "string") cmem.set(k, e);
  } catch { /* 読めなければ空から */ }
  return cmem;
}
// トークンそのものは書かず、見分けるための短い印だけを残す
const tokTag = (t: string) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return t ? String(h >>> 0) : ""; };
function cacheSave() {
  clearTimeout(csave);
  csave = window.setTimeout(() => {
    try {
      const c = cache();
      // 古いものから、件数と全体の大きさが上限に入るまで捨てる
      let size = 0; for (const e of c.values()) size += e.text.length;
      for (const k of [...c.keys()]) { if (c.size <= C_MAX_ENTRIES && size <= C_MAX_CHARS) break; size -= c.get(k)!.text.length; c.delete(k); }
      kvSet(CKEY, JSON.stringify({ v: 1, tok: tokTag(ghToken()), e: [...c] }));
    } catch { /* 保存できなくても動作に影響しない */ }
  }, 800);
}
export function clearGhCache() { cmem = new Map(); clearTimeout(csave); kvDel(CKEY); }

type Q = Record<string, string | number | boolean | undefined>;
const qs = (q?: Q) => {
  const e = Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== "");
  return e.length ? "?" + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
};

async function call<T>(method: string, path: string, body?: unknown, q?: Q, token = ghToken()): Promise<T> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  let r: Response;
  const url = API + path + qs(q);
  const useCache = method === "GET" && !!token && token === ghToken();
  const hit = useCache ? cache().get(url) : undefined;
  if (hit) h["If-None-Match"] = hit.etag;
  try { r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new GhError(i18next.t("GitHub に接続できません"), 0); }
  if (r.status === 204) return undefined as T;
  // 変わっていない: 覚えている本文をそのまま使う(新しい順に並べ直すため、いったん消して入れ直す)
  const fresh = r.status === 304 && hit;
  if (fresh) { const c = cache(); c.delete(url); c.set(url, { ...hit, at: Date.now() }); }
  const text = fresh ? hit.text : await r.text();
  let j: unknown = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* 本文が JSON でなければ、そのまま扱う */ }
  if (!r.ok && !fresh) {
    const o = (j ?? {}) as { message?: string; errors?: { message?: string; code?: string; field?: string }[] };
    const detail = o.errors?.map((x) => x.message ?? [x.field, x.code].filter(Boolean).join(" ")).filter(Boolean).join(" / ");
    throw new GhError([o.message ?? text.slice(0, 200), detail].filter(Boolean).join(": ") || `HTTP ${r.status}`, r.status, r.headers.get("x-oauth-scopes") ?? "");
  }
  const etag = r.headers.get("etag");
  if (useCache && etag && !fresh && text.length <= C_MAX_ONE) { const c = cache(); c.delete(url); c.set(url, { etag, text, at: Date.now() }); cacheSave(); }
  return (j ?? (text as unknown)) as T;
}
// 一覧。per_page=100 の 1 ページ分を、上限 pages まで連ねて返す
async function list<T>(path: string, q: Q = {}, pages = 1, key?: string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p <= pages; p++) {
    const r = await call<T[] | Record<string, unknown>>("GET", path, undefined, { per_page: 100, ...q, page: p });
    const a = (key ? (r as Record<string, T[]>)[key] : (r as T[])) ?? [];
    out.push(...a);
    if (a.length < 100) break;
  }
  return out;
}

export type User = { login: string; avatar_url: string; html_url: string; name?: string | null };
export type Label = { id: number; name: string; color: string; description?: string | null };
export type Repo = {
  id: number; name: string; full_name: string; description: string | null; homepage: string | null; private: boolean; visibility: string;
  archived: boolean; fork: boolean; default_branch: string; html_url: string; topics?: string[]; license?: { spdx_id: string; name: string } | null;
  stargazers_count: number; forks_count: number; watchers_count: number; open_issues_count: number; size: number; pushed_at: string; updated_at: string;
  has_issues: boolean; has_projects: boolean; has_wiki: boolean; has_discussions?: boolean; is_template?: boolean;
  allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean; allow_auto_merge?: boolean; delete_branch_on_merge?: boolean;
  allow_update_branch?: boolean; web_commit_signoff_required?: boolean; permissions?: { admin: boolean; push: boolean; pull: boolean };
  parent?: { full_name: string; html_url: string }; allow_forking?: boolean; owner?: { login: string; type?: string };
  security_and_analysis?: { secret_scanning?: { status: string }; secret_scanning_push_protection?: { status: string } } | null;
};
export type Issue = {
  number: number; title: string; body: string | null; state: "open" | "closed"; state_reason?: string | null; html_url: string; comments: number; locked: boolean;
  user: User | null; labels: (Label | string)[]; assignees: User[]; milestone: { number: number; title: string } | null; created_at: string; updated_at: string;
  pull_request?: unknown;
};
export type Comment = { id: number; body: string; user: User | null; created_at: string; html_url: string };
export type Pull = Issue & {
  draft: boolean; merged: boolean; mergeable: boolean | null; mergeable_state: string; head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string }; additions: number; deletions: number; changed_files: number; commits: number; merged_at: string | null;
};
export type PullFile = { filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string };
export type Branch = { name: string; protected: boolean; commit: { sha: string } };
export type Release = {
  id: number; tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean; html_url: string; created_at: string;
  published_at: string | null; assets: { id: number; name: string; size: number; download_count: number }[];
};
export type Workflow = { id: number; name: string; path: string; state: string; html_url: string };
export type Run = {
  id: number; name: string | null; display_title: string; status: string; conclusion: string | null; event: string; head_branch: string | null; head_sha: string;
  run_number: number; workflow_id: number; html_url: string; created_at: string; updated_at: string; run_started_at?: string; actor?: User | null;
};
export type Step = { name: string; status: string; conclusion: string | null; number: number };
export type Job = { id: number; name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null; html_url: string; steps?: Step[] };
export type Variable = { name: string; value: string; created_at: string; updated_at: string };
export type SecretName = { name: string; created_at: string; updated_at: string };
export type Collaborator = { login: string; avatar_url: string; html_url: string; role_name?: string; permissions?: { admin: boolean; push: boolean; pull: boolean } };
export type Hook = { id: number; name: string; active: boolean; events: string[]; config: { url?: string; content_type?: string }; last_response?: { code: number | null; status: string } };
export type Protection = {
  required_status_checks?: { strict: boolean; contexts: string[] } | null;
  required_pull_request_reviews?: { required_approving_review_count: number; dismiss_stale_reviews: boolean; require_code_owner_reviews: boolean } | null;
  enforce_admins?: { enabled: boolean };
  required_linear_history?: { enabled: boolean };
  allow_force_pushes?: { enabled: boolean };
  allow_deletions?: { enabled: boolean };
  required_conversation_resolution?: { enabled: boolean };
};

export type Milestone = { number: number; title: string; description: string | null; state: "open" | "closed"; due_on: string | null; open_issues: number; closed_issues: number; html_url: string };
export type DeployKey = { id: number; title: string; key: string; read_only: boolean; created_at: string };
export type CacheEnt = { id: number; key: string; ref: string; size_in_bytes: number; last_accessed_at: string; created_at: string };
export type TagEnt = { name: string; commit: { sha: string } };
export type CommitEnt = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; author: User | null };
export type Tpl = { key: string; name: string; spdx_id?: string };

const R = (s: Slug) => `/repos/${s.owner}/${s.repo}`;
const enc = encodeURIComponent;

export const gh = {
  viewer: (token?: string) => call<User>("GET", "/user", undefined, undefined, token),
  repo: (s: Slug) => call<Repo>("GET", R(s)),
  updateRepo: (s: Slug, b: Partial<Repo> & Record<string, unknown>) => call<Repo>("PATCH", R(s), b),
  deleteRepo: (s: Slug) => call<void>("DELETE", R(s)),
  setTopics: (s: Slug, names: string[]) => call<{ names: string[] }>("PUT", `${R(s)}/topics`, { names }),
  languages: (s: Slug) => call<Record<string, number>>("GET", `${R(s)}/languages`),

  issues: (s: Slug, q: Q) => list<Issue>(`${R(s)}/issues`, q, 1),
  issue: (s: Slug, n: number) => call<Issue>("GET", `${R(s)}/issues/${n}`),
  createIssue: (s: Slug, b: { title: string; body?: string; labels?: string[]; assignees?: string[] }) => call<Issue>("POST", `${R(s)}/issues`, b),
  updateIssue: (s: Slug, n: number, b: Record<string, unknown>) => call<Issue>("PATCH", `${R(s)}/issues/${n}`, b),
  comments: (s: Slug, n: number) => list<Comment>(`${R(s)}/issues/${n}/comments`, {}, 3),
  addComment: (s: Slug, n: number, body: string) => call<Comment>("POST", `${R(s)}/issues/${n}/comments`, { body }),
  labels: (s: Slug) => list<Label>(`${R(s)}/labels`, {}, 3),
  createLabel: (s: Slug, b: { name: string; color: string; description?: string }) => call<Label>("POST", `${R(s)}/labels`, b),
  deleteLabel: (s: Slug, name: string) => call<void>("DELETE", `${R(s)}/labels/${enc(name)}`),
  assignees: (s: Slug) => list<User>(`${R(s)}/assignees`, {}, 1),

  pulls: (s: Slug, q: Q) => list<Pull>(`${R(s)}/pulls`, q, 1),
  pull: (s: Slug, n: number) => call<Pull>("GET", `${R(s)}/pulls/${n}`),
  pullFiles: (s: Slug, n: number) => list<PullFile>(`${R(s)}/pulls/${n}/files`, {}, 3),
  createPull: (s: Slug, b: { title: string; head: string; base: string; body?: string; draft?: boolean }) => call<Pull>("POST", `${R(s)}/pulls`, b),
  updatePull: (s: Slug, n: number, b: Record<string, unknown>) => call<Pull>("PATCH", `${R(s)}/pulls/${n}`, b),
  mergePull: (s: Slug, n: number, method: "merge" | "squash" | "rebase", title?: string) => call<{ merged: boolean; message: string }>("PUT", `${R(s)}/pulls/${n}/merge`, { merge_method: method, commit_title: title || undefined }),
  checkRuns: (s: Slug, ref: string) => call<{ check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[] }>("GET", `${R(s)}/commits/${enc(ref)}/check-runs`),

  branches: (s: Slug) => list<Branch>(`${R(s)}/branches`, {}, 3),
  deleteBranch: (s: Slug, name: string) => call<void>("DELETE", `${R(s)}/git/refs/heads/${name.split("/").map(enc).join("/")}`),
  renameBranch: (s: Slug, name: string, to: string) => call<unknown>("POST", `${R(s)}/branches/${name.split("/").map(enc).join("/")}/rename`, { new_name: to }),
  protection: (s: Slug, b: string) => call<Protection>("GET", `${R(s)}/branches/${b.split("/").map(enc).join("/")}/protection`),
  setProtection: (s: Slug, b: string, body: Record<string, unknown>) => call<Protection>("PUT", `${R(s)}/branches/${b.split("/").map(enc).join("/")}/protection`, body),
  removeProtection: (s: Slug, b: string) => call<void>("DELETE", `${R(s)}/branches/${b.split("/").map(enc).join("/")}/protection`),

  releases: (s: Slug) => list<Release>(`${R(s)}/releases`, {}, 1),
  createRelease: (s: Slug, b: Record<string, unknown>) => call<Release>("POST", `${R(s)}/releases`, b),
  updateRelease: (s: Slug, id: number, b: Record<string, unknown>) => call<Release>("PATCH", `${R(s)}/releases/${id}`, b),
  deleteRelease: (s: Slug, id: number) => call<void>("DELETE", `${R(s)}/releases/${id}`),

  workflows: (s: Slug) => list<Workflow>(`${R(s)}/actions/workflows`, {}, 1, "workflows"),
  runs: (s: Slug, q: Q = {}, workflow?: string) => list<Run>(workflow ? `${R(s)}/actions/workflows/${workflow}/runs` : `${R(s)}/actions/runs`, { per_page: 30, ...q }, 1, "workflow_runs"),
  jobs: (s: Slug, runId: number) => list<Job>(`${R(s)}/actions/runs/${runId}/jobs`, {}, 1, "jobs"),
  rerun: (s: Slug, runId: number, failedOnly: boolean) => call<void>("POST", `${R(s)}/actions/runs/${runId}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`),
  cancelRun: (s: Slug, runId: number) => call<void>("POST", `${R(s)}/actions/runs/${runId}/cancel`),
  deleteRun: (s: Slug, runId: number) => call<void>("DELETE", `${R(s)}/actions/runs/${runId}`),
  dispatch: (s: Slug, id: number | string, ref: string, inputs: Record<string, string>) => call<void>("POST", `${R(s)}/actions/workflows/${id}/dispatches`, { ref, inputs }),
  setWorkflowState: (s: Slug, id: number, on: boolean) => call<void>("PUT", `${R(s)}/actions/workflows/${id}/${on ? "enable" : "disable"}`),
  file: async (s: Slug, path: string, ref?: string) => {
    const f = await call<{ content: string; sha: string; encoding: string }>("GET", `${R(s)}/contents/${path.split("/").map(enc).join("/")}`, undefined, { ref });
    const bin = atob(f.content.replace(/\n/g, ""));
    return { text: new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))), sha: f.sha };
  },

  variables: (s: Slug) => list<Variable>(`${R(s)}/actions/variables`, {}, 1, "variables"),
  setVariable: (s: Slug, name: string, value: string, exists: boolean) => exists
    ? call<void>("PATCH", `${R(s)}/actions/variables/${enc(name)}`, { name, value })
    : call<void>("POST", `${R(s)}/actions/variables`, { name, value }),
  deleteVariable: (s: Slug, name: string) => call<void>("DELETE", `${R(s)}/actions/variables/${enc(name)}`),
  secrets: (s: Slug) => list<SecretName>(`${R(s)}/actions/secrets`, {}, 1, "secrets"),
  deleteSecret: (s: Slug, name: string) => call<void>("DELETE", `${R(s)}/actions/secrets/${enc(name)}`),
  secretKey: (s: Slug) => call<{ key_id: string; key: string }>("GET", `${R(s)}/actions/secrets/public-key`),
  putSecret: (s: Slug, name: string, encrypted: string, keyId: string) => call<void>("PUT", `${R(s)}/actions/secrets/${enc(name)}`, { encrypted_value: encrypted, key_id: keyId }),

  collaborators: (s: Slug) => list<Collaborator>(`${R(s)}/collaborators`, {}, 1),
  addCollaborator: (s: Slug, login: string, permission: string) => call<unknown>("PUT", `${R(s)}/collaborators/${enc(login)}`, { permission }),
  removeCollaborator: (s: Slug, login: string) => call<void>("DELETE", `${R(s)}/collaborators/${enc(login)}`),
  hooks: (s: Slug) => list<Hook>(`${R(s)}/hooks`, {}, 1),
  updateHook: (s: Slug, id: number, b: Record<string, unknown>) => call<Hook>("PATCH", `${R(s)}/hooks/${id}`, b),
  deleteHook: (s: Slug, id: number) => call<void>("DELETE", `${R(s)}/hooks/${id}`),
  // owner を渡すと、そのオーガニゼーションに作る(省くと自分のアカウント)
  createRepo: (b: { name: string; description?: string; private: boolean; auto_init?: boolean }, owner?: string) => call<Repo>("POST", owner ? `/orgs/${enc(owner)}/repos` : "/user/repos", b),
  orgs: () => list<{ login: string }>("/user/orgs", {}, 1),

  // ファイルの追加・更新(.gitignore やライセンスなど)。既存のファイルを置き換えるときは sha が要る
  putFile: (s: Slug, path: string, text: string, message: string, sha?: string, branch?: string) => {
    const bytes = new TextEncoder().encode(text);
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    return call<{ commit: { sha: string; html_url: string } }>("PUT", `${R(s)}/contents/${path.split("/").map(enc).join("/")}`, { message, content: btoa(bin), sha, branch });
  },
  // 新しいファイルのひな形(.gitignore・ライセンス)
  gitignoreNames: () => call<string[]>("GET", "/gitignore/templates"),
  gitignoreText: async (name: string) => (await call<{ source: string }>("GET", `/gitignore/templates/${enc(name)}`)).source,
  licenseList: () => list<Tpl>("/licenses", {}, 1),
  licenseText: async (key: string) => (await call<{ body: string }>("GET", `/licenses/${enc(key)}`)).body,

  // ラベルとマイルストーン
  updateLabel: (s: Slug, name: string, b: { new_name?: string; color?: string; description?: string }) => call<Label>("PATCH", `${R(s)}/labels/${enc(name)}`, b),
  milestones: (s: Slug) => list<Milestone>(`${R(s)}/milestones`, { state: "all" }, 1),
  createMilestone: (s: Slug, b: { title: string; description?: string; due_on?: string }) => call<Milestone>("POST", `${R(s)}/milestones`, b),
  updateMilestone: (s: Slug, n: number, b: Record<string, unknown>) => call<Milestone>("PATCH", `${R(s)}/milestones/${n}`, b),
  deleteMilestone: (s: Slug, n: number) => call<void>("DELETE", `${R(s)}/milestones/${n}`),

  // デプロイキー・Actions のキャッシュ・タグ・コミット
  deployKeys: (s: Slug) => list<DeployKey>(`${R(s)}/keys`, {}, 1),
  addDeployKey: (s: Slug, b: { title: string; key: string; read_only: boolean }) => call<DeployKey>("POST", `${R(s)}/keys`, b),
  deleteDeployKey: (s: Slug, id: number) => call<void>("DELETE", `${R(s)}/keys/${id}`),
  caches: (s: Slug) => list<CacheEnt>(`${R(s)}/actions/caches`, {}, 1, "actions_caches"),
  deleteCache: (s: Slug, id: number) => call<void>("DELETE", `${R(s)}/actions/caches/${id}`),
  deleteAllCaches: (s: Slug) => call<unknown>("DELETE", `${R(s)}/actions/caches`),
  tags: (s: Slug) => list<TagEnt>(`${R(s)}/tags`, {}, 1),
  commits: (s: Slug, sha?: string) => list<CommitEnt>(`${R(s)}/commits`, { sha, per_page: 30 }, 1),

  // スター・フォーク・名前の変更・移管
  isStarred: async (s: Slug) => { try { await call<void>("GET", `/user/starred/${s.owner}/${s.repo}`); return true; } catch (e) { if (e instanceof GhError && e.status === 404) return false; throw e; } },
  star: (s: Slug, on: boolean) => call<void>(on ? "PUT" : "DELETE", `/user/starred/${s.owner}/${s.repo}`),
  fork: (s: Slug, org?: string) => call<Repo>("POST", `${R(s)}/forks`, org ? { organization: org } : {}),
  transfer: (s: Slug, newOwner: string) => call<unknown>("POST", `${R(s)}/transfer`, { new_owner: newOwner }),
};

// 失敗の文を、画面に出す文にする(GitHub の英語の文は、あとに添える)
export function ghErr(e: unknown): string {
  if (!(e instanceof GhError)) return e instanceof Error ? e.message : String(e);
  if (e.status === 0) return e.message;
  if (e.status === 401) return i18next.t("トークンが正しくないか、期限が切れています");
  if (e.status === 403) return i18next.t("権限が足りないか、利用の上限です({{msg}})", { msg: e.message });
  if (e.status === 404) return i18next.t("見つかりません。リポジトリがないか、トークンにこの操作の権限がありません");
  if (e.status === 422) return i18next.t("GitHub が受け付けませんでした({{msg}})", { msg: e.message });
  return e.message;
}

export const relTime = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return "";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return i18next.t("たった今");
  if (s < 3600) return i18next.t("{{n}} 分前", { n: Math.floor(s / 60) });
  if (s < 86400) return i18next.t("{{n}} 時間前", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return i18next.t("{{n}} 日前", { n: Math.floor(s / 86400) });
  return new Date(iso).toLocaleDateString();
};

// シークレットは、リポジトリの公開鍵で暗号化(libsodium の sealed box)してから送る。重いので、使うときに読み込む
export async function sealSecret(publicKeyB64: string, value: string): Promise<string> {
  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;
  const key = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const enc = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
}
