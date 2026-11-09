import type { Node } from "./fs";

const f = (name: string, demo: string): Node => ({ name, path: `/${name}`, kind: "file", demo });

export const DEMO_NAME = "Fixit";
export const DEMO_TREE: Node[] = [
  { name: "src", path: "/src", kind: "dir", children: [
    { name: "main.ts", path: "/src/main.ts", kind: "file", demo: `import { createServer } from "node:http";
import { greet } from "./greet";

type Handler = (req: Request) => Response | Promise<Response>;

const routes: Record<string, Handler> = {
  "/": () => new Response(greet("world")),
  "/health": () => Response.json({ ok: true }),
};

export function start(port = 3000) {
  const server = createServer(async (req, res) => {
    const handler = routes[req.url ?? "/"];
    if (!handler) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const out = await handler(new Request("http://localhost" + req.url));
    res.end(await out.text());
  });
  server.listen(port);
  return server;
}
` },
    { name: "greet.ts", path: "/src/greet.ts", kind: "file", demo: `// あいさつを返す小さな関数
export const greet = (name: string): string => \`Hello, \${name}!\`;
` },
  ] },
  { name: "docs", path: "/docs", kind: "dir", children: [
    { name: "memo.md", path: "/docs/memo.md", kind: "file", demo: `# メモ

- [x] フォルダを開く
- [ ] ファイルを編集して **Ctrl+S** で保存

\`\`\`py
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
\`\`\`
` },
  ] },
  f("package.json", `{
  "name": "fixit-demo",
  "version": "1.0.0",
  "scripts": { "dev": "vite", "build": "vite build" }
}
`),
  f("README.md", `# Fixit Editor

軽くて見た目のいいエディタです。左上の **フォルダを開く** から、手元のフォルダを開けます。
`),
];
