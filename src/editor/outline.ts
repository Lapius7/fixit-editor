// 構文木から、関数・クラス・見出しなどの一覧(アウトライン)を作る。パンくずとシンボル一覧の元になる。
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type Sym = { name: string; kind: string; from: number; to: number; line: number; depth: number; children: Sym[] };

// ノード名 → 種類。名前は、その子(または自分)の中の「名前」ノードから取る
const KINDS: Record<string, string> = {
  FunctionDeclaration: "function", FunctionDefinition: "function", MethodDeclaration: "method", MethodDefinition: "method", ClassDeclaration: "class", ClassDefinition: "class",
  InterfaceDeclaration: "interface", TypeAliasDeclaration: "type", EnumDeclaration: "enum", NamespaceDeclaration: "namespace", ModuleDeclaration: "namespace",
  StructItem: "class", EnumItem: "enum", FunctionItem: "function", TraitItem: "interface", ImplItem: "class", ModItem: "namespace",
  ATXHeading1: "h1", ATXHeading2: "h2", ATXHeading3: "h3", ATXHeading4: "h4", ATXHeading5: "h5", ATXHeading6: "h6", SetextHeading1: "h1", SetextHeading2: "h2",
  RuleSet: "rule", MediaStatement: "rule", KeyframesStatement: "rule", Element: "tag",
};
const CONTAINER = new Set(["class", "interface", "namespace", "enum", "rule", "tag", "h1", "h2", "h3", "h4", "h5"]);
const NAME_NODES = new Set(["VariableDefinition", "TypeDefinition", "PropertyDefinition", "DefName", "Identifier", "TypeIdentifier", "NamespaceName"]);

function textOf(s: EditorState, n: { from: number; to: number }, max = 60) { const t = s.doc.sliceString(n.from, Math.min(n.to, n.from + max * 3)).replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max) + "…" : t; }

function nameOf(s: EditorState, n: SyntaxNode, kind: string, full = false): string | null {
  if (kind.startsWith("h")) return textOf(s, n).replace(/^#+\s*/, "").replace(/\s*#+$/, "") || null;
  if (kind === "rule") {
    const sel = n.getChild("SelectorList") ?? n.getChild("Selector") ?? n.firstChild;
    if (n.name === "RuleSet") { const b = n.getChild("Block"); return textOf(s, { from: n.from, to: b ? b.from : n.to }).replace(/\s*\{?$/, "") || null; }
    return sel ? textOf(s, { from: n.from, to: sel.to }) : null;
  }
  if (kind === "tag") {
    const open = n.getChild("OpenTag") ?? n.getChild("SelfClosingTag"); const tn = open?.getChild("TagName"); if (!tn) return null;
    const nm = s.doc.sliceString(tn.from, tn.to);
    if (!full && !/^(html|head|body|main|header|footer|nav|section|article|aside|form|table|ul|ol|dialog|template|script|style|h[1-6])$/i.test(nm) && !/\b(id|class)\s*=/.test(s.doc.sliceString(open!.from, open!.to))) return null;
    const id = /\bid\s*=\s*["']([^"']+)/.exec(s.doc.sliceString(open!.from, open!.to));
    const cl = /\bclass\s*=\s*["']([^"']+)/.exec(s.doc.sliceString(open!.from, open!.to));
    return nm + (id ? "#" + id[1] : cl ? "." + cl[1].trim().split(/\s+/)[0] : "");
  }
  for (let c = n.firstChild; c; c = c.nextSibling) if (NAME_NODES.has(c.name) || c.name === "PropertyName") return s.doc.sliceString(c.from, c.to);
  return null;
}

// const f = () => {} / const f = function() {} も関数として拾う
function varFunc(s: EditorState, n: SyntaxNode): { name: string; node: SyntaxNode } | null {
  if (n.name !== "VariableDeclaration" && n.name !== "LexicalDeclaration") return null;
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "VariableDefinition") { const nx = c.nextSibling?.name === "Equals" ? c.nextSibling.nextSibling : c.nextSibling; if (nx && (nx.name === "ArrowFunction" || nx.name === "FunctionExpression" || nx.name === "ClassExpression")) return { name: s.doc.sliceString(c.from, c.to), node: nx }; }
  }
  return null;
}

// full: HTML のタグを、id・class のないものも含めてすべて拾う(パンくずで、いまいる場所までの道筋を正しく出すため)
export function outline(state: EditorState, full = false): Sym[] {
  const root: Sym = { name: "", kind: "", from: 0, to: state.doc.length, line: 1, depth: -1, children: [] };
  let count = 0;
  const walk = (n: SyntaxNode, parent: Sym, depth: number) => {
    for (let c = n.firstChild; c && count < 1500; c = c.nextSibling) {
      let kind = KINDS[c.name], name: string | null = null;
      if (kind) name = nameOf(state, c, kind, full);
      else { const v = varFunc(state, c); if (v) { kind = "function"; name = v.name; } }
      // Markdown の見出しは、階層でなく平らに並んでいるので、あとで組み直す
      if (kind && name) {
        count++;
        const sym: Sym = { name, kind, from: c.from, to: c.to, line: state.doc.lineAt(c.from).number, depth, children: [] };
        parent.children.push(sym);
        if (CONTAINER.has(kind) && !kind.startsWith("h")) walk(c, sym, depth + 1);
        else if (kind === "function" || kind === "method") walk(c, sym, depth + 1);
      } else walk(c, parent, depth);
    }
  };
  walk(syntaxTree(state).topNode, root, 0);
  // 見出しは、レベルに従って入れ子にする
  const heads = root.children.filter((x) => /^h\d$/.test(x.kind));
  if (heads.length) {
    const top: Sym[] = [], stack: Sym[] = [];
    for (const h of heads) {
      const lv = Number(h.kind[1]);
      while (stack.length && Number(stack[stack.length - 1].kind[1]) >= lv) stack.pop();
      (stack.length ? stack[stack.length - 1].children : top).push(h);
      stack.push(h);
    }
    return top;
  }
  return root.children;
}

// カーソルを含む記号の並び(外側 → 内側)
export function trail(syms: Sym[], pos: number): Sym[] {
  const out: Sym[] = [];
  let cur = syms;
  for (;;) {
    const hit = cur.find((s) => pos >= s.from && pos <= s.to);
    if (!hit) break;
    out.push(hit); cur = hit.children;
  }
  return out;
}

export const flat = (syms: Sym[], depth = 0, out: Sym[] = []): Sym[] => { for (const s of syms) { out.push({ ...s, depth }); flat(s.children, depth + 1, out); } return out; };
