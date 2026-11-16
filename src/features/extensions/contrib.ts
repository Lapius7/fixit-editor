// 拡張機能が宣言したショートカットとメニューを、本体のコマンド(apply.ts の項目)に結びつける。
// 本体のキーは奪えない: 本体が使っている組み合わせは、呼ぶ側(App のキー処理)が先に見て、あれば拡張のものは使わない。
import type { Installed } from "./exports";
import type { ExtMenu } from "./spec";

/** パレットの項目の id(apply.ts の useExtensionCommands と同じ形) */
export const cmdId = (ext: string, command: string) => `ext-${ext}-${command}`;

/** 組み合わせ → パレットの項目 id。同じ組み合わせを 2 つの拡張が宣言したら、先に入れた(一覧の前にある)ほうだけ */
export function contribKeys(list: Installed[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of list) {
    if (!x.active) continue;
    for (const k of x.manifest.keybindings) if (!m.has(k.key)) m.set(k.key, cmdId(x.id, k.command));
  }
  return m;
}

/** メニューに足す項目(拡張の名前つき)。where で出す場所を絞る */
export type MenuEntry = { id: string; ext: string; command: string; script: boolean; label: string; keys: string };
export function contribMenu(list: Installed[], where: ExtMenu["where"]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const x of list) {
    if (!x.active) continue;
    for (const k of x.manifest.menus) {
      if (k.where !== where) continue;
      const script = x.manifest.scriptCommands.some((o) => o.id === k.command);
      const c = x.manifest.commands.find((o) => o.id === k.command) ?? x.manifest.scriptCommands.find((o) => o.id === k.command);
      if (c) out.push({ id: cmdId(x.id, c.id), ext: x.id, command: c.id, script, label: `${x.manifest.name}: ${c.title}`, keys: x.manifest.keybindings.find((b) => b.command === c.id)?.key ?? "" });
    }
  }
  return out;
}
