// 公開する「名前」(スロット)の記録。名前ごとに URL の元(トークン)が別で、ここには名前と最後に使ったポートだけを残す(トークンは読まない)。
// 接続(PC・WSL・SSH 先)ごとに分ける。トークン自体は接続先の ~/.dela/projects/<名前>.delaconfig にある。
import { kvGet, kvSet } from "@/platform/appdata";
import { DEFAULT_NAME } from "./dela";

const KEY = "fixit:dela:slots:v1";
const MAX = 40; // 接続ごと
export type Slot = { name: string; port?: string; at: number };
type Store = Record<string, Slot[]>;

const read = (): Store => {
  try {
    const j = JSON.parse(kvGet(KEY) ?? "{}") as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      out[k] = v.flatMap((e: { name?: unknown; port?: unknown; at?: unknown } | null) =>
        typeof e?.name === "string" && /^[a-z0-9-]{1,20}$/.test(e.name)
          ? [{ name: e.name, port: typeof e.port === "string" && /^\d{1,5}$/.test(e.port) ? e.port : undefined, at: typeof e.at === "number" ? e.at : 0 }]
          : []);
    }
    return out;
  } catch { return {}; }
};

export const scopeOf = (c?: { kind: string; host?: string }) => `${c?.kind ?? "local"}:${c?.host ?? ""}`;

// 使った順(新しいものが先)。app は記録がなくても先頭に出す
export function loadSlots(scope: string): Slot[] {
  const list = (read()[scope] ?? []).slice().sort((a, b) => b.at - a.at);
  return list.some((s) => s.name === DEFAULT_NAME) ? list : [...list, { name: DEFAULT_NAME, at: 0 }];
}

// 名前を作る(まだ公開していなくても一覧に出す)・URL が出たあとにポートを覚える
export function saveSlot(scope: string, name: string, port?: string): void {
  const all = read();
  const list = (all[scope] ?? []).filter((s) => s.name !== name);
  const prev = (all[scope] ?? []).find((s) => s.name === name);
  const last = Math.max(0, ...(all[scope] ?? []).map((x) => x.at));
  list.push({ name, port: port ?? prev?.port, at: Math.max(Date.now(), last + 1) }); // 同じ時刻でも順番が崩れないように
  all[scope] = list.sort((a, b) => b.at - a.at).slice(0, MAX);
  kvSet(KEY, JSON.stringify(all));
}

// 一覧から外す(接続先のトークンのファイルは消さない。同じ名前で公開すれば同じ URL に戻る)
export function forgetSlot(scope: string, name: string): void {
  const all = read();
  all[scope] = (all[scope] ?? []).filter((s) => s.name !== name);
  kvSet(KEY, JSON.stringify(all));
}

// dela info の URL(app-<id>)から、同じ id の別の名前の URL を作る
export const urlWithName = (u: string, name: string): string | undefined =>
  /^https:\/\/[a-z0-9-]*?-[a-z0-9]{10}\.try\./i.test(u) && /^[a-z0-9-]{1,20}$/.test(name) ? u.replace(/^https:\/\/[a-z0-9-]*?(-[a-z0-9]{10}\.try\.)/i, `https://${name}$1`) : undefined;
// URL の <名前>-<id> から名前を取る
export function nameOfUrl(u: string): string {
  const m = /^https:\/\/([a-z0-9-]*?)-[a-z0-9]{10}\.try\./i.exec(u);
  return m?.[1]?.toLowerCase() ?? "";
}
