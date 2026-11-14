import { isMap, isSeq, parseDocument, type Document } from "yaml";

// ワークフロー YAML を、図に必要な形へ読み取る。書き戻しは yaml の Document を直接変え、コメントや書式を残す
export type JobNode = { id: string; name: string; runsOn: string; needs: string[]; steps: number; cond: string };
export type Step = { name: string; uses: string; run: string; withN: number; i: number };
export type Model = { err: string; jobs: JobNode[]; triggers: Record<string, unknown>; name: string; dispatch: boolean };

const asStr = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const asList = (v: unknown): string[] => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

export function read(text: string): Model {
  const doc = parseDocument(text);
  const err = doc.errors[0]?.message ?? "";
  const js = (doc.toJS() ?? {}) as Record<string, unknown>;
  const jobsRaw = js.jobs && typeof js.jobs === "object" ? (js.jobs as Record<string, Record<string, unknown>>) : {};
  const jobs = Object.entries(jobsRaw).map(([id, j]) => ({
    id, name: asStr(j?.name), runsOn: asStr(j?.["runs-on"]), needs: asList(j?.needs),
    steps: Array.isArray(j?.steps) ? j.steps.length : 0, cond: asStr(j?.if),
  }));
  const on = js.on;
  const triggers: Record<string, unknown> = Array.isArray(on) ? Object.fromEntries(on.map((k) => [String(k), null]))
    : typeof on === "string" ? { [on]: null } : on && typeof on === "object" ? (on as Record<string, unknown>) : {};
  return { err, jobs, triggers, name: asStr(js.name), dispatch: "workflow_dispatch" in triggers };
}

export function steps(text: string, id: string): Step[] {
  const js = (parseDocument(text).toJS() ?? {}) as { jobs?: Record<string, { steps?: Record<string, unknown>[] }> };
  return (js.jobs?.[id]?.steps ?? []).map((s, i) => ({
    name: asStr(s?.name), uses: asStr(s?.uses), run: asStr(s?.run), i,
    withN: s?.with && typeof s.with === "object" ? Object.keys(s.with).length : 0,
  }));
}

// 図の配置。needs の最も長い鎖の深さを列にし、列の中では書かれた順に並べる
export const NODE_W = 208;
export const NODE_H = 68;
const GX = 72, GY = 20, PAD = 24;
export function layout(jobs: JobNode[]) {
  const by = new Map(jobs.map((j) => [j.id, j]));
  const lv = new Map<string, number>();
  const depth = (id: string, st: Set<string>): number => {
    const known = lv.get(id);
    if (known !== undefined) return known;
    if (st.has(id)) return 0;
    st.add(id);
    let l = 0;
    for (const d of by.get(id)?.needs ?? []) if (by.has(d)) l = Math.max(l, depth(d, st) + 1);
    st.delete(id);
    lv.set(id, l);
    return l;
  };
  jobs.forEach((j) => depth(j.id, new Set()));
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const j of jobs) {
    const l = lv.get(j.id) ?? 0, r = rows.get(l) ?? 0;
    rows.set(l, r + 1);
    pos.set(j.id, { x: PAD + l * (NODE_W + GX), y: PAD + r * (NODE_H + GY) });
  }
  const cols = Math.max(0, ...[...lv.values()]) + 1, maxRows = Math.max(1, ...[...rows.values()]);
  return { pos, w: PAD * 2 + cols * NODE_W + (cols - 1) * GX, h: PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GY };
}

// needs をたどって、from から to へ行ける(= to の依存に from を足すと輪になる)か
export function reaches(jobs: JobNode[], from: string, to: string): boolean {
  const by = new Map(jobs.map((j) => [j.id, j]));
  const seen = new Set<string>();
  const go = (id: string): boolean => {
    if (id === to) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return jobs.filter((j) => j.needs.includes(id)).some((j) => go(j.id)) && by.has(id);
  };
  return go(from);
}

// ---- 書き換え。どれも Document を直接変える ----
export const edit = (text: string, fn: (d: Document) => void): string => {
  const d = parseDocument(text);
  if (d.errors.length) return text;
  fn(d);
  return d.toString({ lineWidth: 0 });
};

const put = (d: Document, path: (string | number)[], v: unknown) => {
  if (v === "" || v === undefined || v === null || v === false) d.deleteIn(path);
  else d.setIn(path, v);
};
export const setJobField = (d: Document, id: string, key: string, v: string | number | undefined) => put(d, ["jobs", id, key], v);

export function setNeeds(d: Document, id: string, list: string[]) {
  if (list.length === 0) d.deleteIn(["jobs", id, "needs"]);
  else d.setIn(["jobs", id, "needs"], list.length === 1 ? list[0] : d.createNode(list));
}
const needsOf = (d: Document, id: string) => asList(d.getIn(["jobs", id, "needs"]) as unknown);
export const addNeed = (d: Document, id: string, dep: string) => { const n = needsOf(d, id); if (!n.includes(dep)) setNeeds(d, id, [...n, dep]); };
export const dropNeed = (d: Document, id: string, dep: string) => setNeeds(d, id, needsOf(d, id).filter((x) => x !== dep));

export function addJob(d: Document, id: string) {
  d.setIn(["jobs", id], d.createNode({ "runs-on": "ubuntu-latest", steps: [{ uses: "actions/checkout@v4" }] }));
}
export function removeJob(d: Document, id: string, all: JobNode[]) {
  d.deleteIn(["jobs", id]);
  for (const j of all) if (j.id !== id && j.needs.includes(id)) dropNeed(d, j.id, id);
}
export function renameJob(d: Document, from: string, to: string, all: JobNode[]) {
  const jobs = d.get("jobs", true);
  if (!isMap(jobs)) return;
  for (const p of jobs.items) if (String((p.key as { value?: unknown }).value ?? p.key) === from) (p.key as { value: string }).value = to;
  for (const j of all) if (j.needs.includes(from)) setNeeds(d, j.id === from ? to : j.id, j.needs.map((x) => (x === from ? to : x)));
}

export const stepPath = (id: string, i: number) => ["jobs", id, "steps", i];
export function setStep(d: Document, id: string, i: number, key: "name" | "uses" | "run", v: string) {
  put(d, [...stepPath(id, i), key], v);
}
export function stepKind(d: Document, id: string, i: number, kind: "uses" | "run") {
  const other = kind === "uses" ? "run" : "uses";
  const cur = d.getIn([...stepPath(id, i), other]);
  d.deleteIn([...stepPath(id, i), other]);
  d.setIn([...stepPath(id, i), kind], kind === "uses" ? (cur ? "" : "actions/checkout@v4") : (cur ? "" : "echo hello"));
}
export const addStep = (d: Document, id: string) => d.addIn(["jobs", id, "steps"], d.createNode({ name: "", run: "echo hello" }));
export const delStep = (d: Document, id: string, i: number) => d.deleteIn(stepPath(id, i));
export function moveStep(d: Document, id: string, i: number, by: -1 | 1) {
  const seq = d.getIn(["jobs", id, "steps"], true);
  if (!isSeq(seq) || i + by < 0 || i + by >= seq.items.length) return;
  [seq.items[i], seq.items[i + by]] = [seq.items[i + by], seq.items[i]];
}

// トリガー(on)。文字列・配列でも書けるので、地図の形に直してから足し引きする
export function setTrigger(d: Document, key: string, on: boolean) {
  const cur = d.get("on", true);
  if (!isMap(cur)) {
    const old = d.get("on");
    const keys = Array.isArray((old as { toJSON?: () => unknown })?.toJSON?.()) ? ((old as { toJSON: () => string[] }).toJSON()) : typeof old === "string" ? [old] : [];
    d.set("on", d.createNode(Object.fromEntries(keys.map((k) => [k, null]))));
  }
  const m = d.get("on", true);
  if (!isMap(m)) return;
  if (on) { if (!m.has(key)) m.set(key, key === "schedule" ? d.createNode([{ cron: "0 0 * * *" }]) : null); }
  else m.delete(key);
}
export function setBranches(d: Document, key: string, list: string[]) {
  if (list.length === 0) { d.deleteIn(["on", key, "branches"]); return; }
  const cur = d.getIn(["on", key]);
  if (cur == null || typeof cur !== "object") d.setIn(["on", key], d.createNode({}));
  d.setIn(["on", key, "branches"], d.createNode(list));
}
export const setCron = (d: Document, cron: string) => d.setIn(["on", "schedule"], d.createNode([{ cron }]));

export const NEW_WORKFLOW = `name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run
        run: echo "hello"
`;
