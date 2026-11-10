// 複数のフォルダを開いているときの、パスの扱い。
// 先頭以外のフォルダのパスには「/@xxxx」が前につく(中身のパスは「/@xxxx/src/a.ts」)。表示するときは、フォルダの名前に置き換える。
let names = new Map<string, string>();
let multi = false;

export const setRootNames = (list: { prefix: string; name: string }[]) => {
  names = new Map(list.map((r) => [r.prefix, r.name]));
  multi = list.length > 1;
};

// パスを、先頭の「/@xxxx」と、フォルダの中の相対パス(/ から始まる)に分ける
export function splitRoot(path: string): { prefix: string; rel: string } {
  for (const p of names.keys()) {
    if (p && (path === p || path.startsWith(p + "/"))) return { prefix: p, rel: path.slice(p.length) };
  }
  return { prefix: "", rel: path };
}

// 画面に出すパス(先頭の / なし)。複数のフォルダを開いているときは、フォルダ名から始める
export function displayPath(path: string): string {
  const { prefix, rel } = splitRoot(path);
  const body = rel.replace(/^\//, "");
  return multi ? `${names.get(prefix) ?? ""}/${body}`.replace(/\/$/, "") : body;
}
// 同じ、ファイルのあるフォルダだけ
export const displayDir = (path: string) => displayPath(path).replace(/\/?[^/]*$/, "");
