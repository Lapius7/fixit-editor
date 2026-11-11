// 配布する版を署名して、公式サイトのサーバーへ置く。使い方:
//   bun scripts/release.ts --notes "更新内容" --notes-en "..." --notes-ko "..." [--exe dist-win/Fixit-Editor.exe] [--dry]
// 更新内容は 3 つの言語すべてで渡す。アプリは設定の言語のものを出す(notes は 1.0.4 までのアプリ向けで、日本語を入れる)
// 署名の秘密鍵は ~/.config/fixit-release/update-key.pem(リポジトリの外。なければ --keygen で作る)。
// 署名する文字列は src-tauri/fixit-core/src/update.rs の signed_payload と同じ並び。
// サーバー側は DATA_DIR/releases/latest.json を読むだけなので、本体を先に置き、latest.json は最後に置く。
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const KEY = join(homedir(), ".config", "fixit-release", "update-key.pem");
// 置き先(SSH の接続先とサーバー上のフォルダ)は、リポジトリの外の ~/.config/fixit-release/config.json か環境変数で渡す
const CONF = join(homedir(), ".config", "fixit-release", "config.json");
const conf = (existsSync(CONF) ? JSON.parse(readFileSync(CONF, "utf8")) : {}) as { host?: string; dir?: string };
const HOST = process.env.FIXIT_SSH ?? conf.host ?? "";
const DIR = process.env.FIXIT_RELEASES ?? conf.dir ?? "";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1]; };
const has = (n: string) => process.argv.includes(n);
const run = (cmd: string[]) => { const r = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" }); if (r.exitCode !== 0) throw new Error(`失敗: ${cmd.join(" ")}`); };

if (has("--keygen")) {
  if (existsSync(KEY)) throw new Error(`すでにあります: ${KEY}(作り直すと、配布済みのアプリが更新を受け取れなくなります)`);
  mkdirSync(join(homedir(), ".config", "fixit-release"), { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  console.log("公開鍵(update.rs の PUBKEY_B64 に入れる):", publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"));
  process.exit(0);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version: string = pkg.version;
if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error(`版の形が不正です: ${version}`);
const exe = arg("--exe") ?? "dist-win/Fixit-Editor.exe";
const data = readFileSync(exe);
const sha256 = createHash("sha256").update(data).digest("hex");
const size = data.length;
const sig = sign(null, Buffer.from(`fixit-update:v1\n${version}\n${sha256}\n${size}`), createPrivateKey(readFileSync(KEY))).toString("base64");
const file = `Fixit-Editor-${version}.exe`;
const setup = `dist-win/Fixit-Editor-Setup-${version}.exe`; // インストーラーがあれば、サイトのダウンロードボタンはこちらを配る
const installer = existsSync(setup) ? basename(setup) : undefined;
const notes = { ja: arg("--notes") ?? "", en: arg("--notes-en") ?? "", ko: arg("--notes-ko") ?? "" };
const lack = Object.entries(notes).filter(([, v]) => !v.trim()).map(([k]) => k);
if (lack.length && !has("--dry")) throw new Error(`更新内容が足りません(${lack.join(", ")})。--notes(日本語)・--notes-en・--notes-ko をすべて渡してください`);
const manifest = { version, date: new Date().toISOString().slice(0, 10), notes: notes.ja, notes_i18n: notes, file, size, sha256, sig, ...(installer ? { installer } : {}) };
console.log(JSON.stringify({ ...manifest, sig: sig.slice(0, 12) + "…" }, null, 2));
if (has("--dry")) process.exit(0);
if (!HOST || !DIR) throw new Error(`置き先が決まっていません。${CONF} に {"host":"<ssh の接続先>","dir":"<サーバー上の releases フォルダ>"} を書くか、FIXIT_SSH と FIXIT_RELEASES を渡してください`);

const tmp = join(process.env.TMPDIR ?? "/tmp", "fixit-latest.json");
writeFileSync(tmp, JSON.stringify(manifest, null, 2));
run(["ssh", HOST, `mkdir -p '${DIR}'`]);
run(["scp", "-q", exe, `${HOST}:${DIR}/${file}`]);
if (installer) run(["scp", "-q", setup, `${HOST}:${DIR}/${installer}`]);
run(["scp", "-q", tmp, `${HOST}:${DIR}/latest.json`]);
console.log(`公開しました: ${basename(file)} v${version}`);
