// ローカル履歴。保存のたびに、そのファイルの中身を端末内に残す(Git に入れていない変更も戻せるように)。
// 残すのは文字のファイルだけ。大きいファイルは残さず、古いものから消して、全体の量を抑える。
import { kvGet, kvSet, kvDel } from "@/platform/appdata";
import { LOCAL_HISTORY_FILE_CHARS, LOCAL_HISTORY_MAX_PER_FILE, LOCAL_HISTORY_TOTAL_CHARS } from "@/shared/config";

export type Snap = { t: number; text: string };
type Store = Record<string, Snap[]>;

const KEY = "fixit:local-history:v1";

function load(): Store {
  try { const v = JSON.parse(kvGet(KEY) ?? "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

const size = (s: Store) => Object.values(s).reduce((n, l) => n + l.reduce((m, x) => m + x.text.length, 0), 0);

// 保存した中身を足す。最初の保存では、保存前の中身(prev)も一緒に残す。直前と同じ中身なら足さない
export function recordSave(path: string, text: string, prev: string | null, now = Date.now()): void {
  if (text.length > LOCAL_HISTORY_FILE_CHARS) return;
  const s = load();
  const list = s[path] ?? [];
  if (!list.length && prev !== null && prev !== text && prev.length <= LOCAL_HISTORY_FILE_CHARS) list.push({ t: now - 1, text: prev });
  if (list.length && list[list.length - 1].text === text) return;
  list.push({ t: now, text });
  while (list.length > LOCAL_HISTORY_MAX_PER_FILE) list.shift();
  s[path] = list;
  // 全体が大きくなったら、いちばん古い版から消す(各ファイルの最新の版は残す)
  let total = size(s);
  while (total > LOCAL_HISTORY_TOTAL_CHARS) {
    let at: string | null = null;
    for (const [p, l] of Object.entries(s)) if (l.length > 1 && (at === null || l[0].t < s[at][0].t)) at = p;
    if (at === null) break;
    total -= s[at].shift()!.text.length;
  }
  kvSet(KEY, JSON.stringify(s));
}

// 新しい順
export const snapshots = (path: string): Snap[] => [...(load()[path] ?? [])].reverse();

export function clearFile(path: string): void {
  const s = load();
  delete s[path];
  if (Object.keys(s).length) kvSet(KEY, JSON.stringify(s)); else kvDel(KEY);
}

// ファイルを移した・名前を変えたとき、履歴もついていくようにする
export function moveFile(from: string, to: string): void {
  const s = load();
  if (!s[from] || from === to) return;
  s[to] = [...(s[to] ?? []), ...s[from]].sort((a, b) => a.t - b.t).slice(-LOCAL_HISTORY_MAX_PER_FILE);
  delete s[from];
  kvSet(KEY, JSON.stringify(s));
}

// 行ごとの差分。共通の先頭・末尾を除いた真ん中だけ LCS で比べる。大きすぎるときは、全部を消して全部を足した形にする
export type Op = { k: " " | "+" | "-"; s: string };
const lines = (t: string) => { const l = t.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; };

export function diffLines(oldText: string, newText: string): Op[] {
  const a = lines(oldText), b = lines(newText);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - s, m = eb - s;
  const out: Op[] = a.slice(0, s).map((x) => ({ k: " ", s: x }));
  if (n * m > 4_000_000 || Math.max(n, m) > 65000) {
    for (let i = s; i < ea; i++) out.push({ k: "-", s: a[i] });
    for (let j = s; j < eb; j++) out.push({ k: "+", s: b[j] });
  } else {
    const w = m + 1, t = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[s + i] === b[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[s + i] === b[s + j]) { out.push({ k: " ", s: a[s + i] }); i++; j++; }
      else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) { out.push({ k: "+", s: b[s + j] }); j++; }
      else { out.push({ k: "-", s: a[s + i] }); i++; }
    }
  }
  for (let i = ea; i < a.length; i++) out.push({ k: " ", s: a[i] });
  return out;
}
