import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, SearchQuery, selectMatches, setSearchQuery } from "@codemirror/search";
import i18next from "i18next";

// 検索・置換のパネル。エディタ右上に浮かぶガラス調のカードにする
const I = {
  chev: '<path d="m9 6 6 6-6 6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  all: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const t = (k: string) => i18next.t(k);
let replaceOpen = true; // 置換の行を開いたままにするか(パネルを開き直しても保つ)
const LIMIT = 999;

function make(view: EditorView): Panel {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const btn = (cls: string, label: string, icon?: string, text?: string) => {
    const b = el("button", `fs-btn ${cls}`, icon ? svg(icon) : text);
    b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.tabIndex = 0;
    return b;
  };
  const input = (ph: string, label: string) => { const i = el("input", "fs-in"); i.placeholder = ph; i.setAttribute("aria-label", label); i.spellcheck = false; i.autocomplete = "off"; return i; };

  const q0 = getSearchQuery(view.state);
  const find = input(t("検索"), t("検索"));
  find.setAttribute("main-field", "true");
  find.value = q0.search;
  const rep = input(t("置換"), t("置換")); rep.value = q0.replace;
  const toggle = (text: string, label: string, on: boolean) => { const b = btn("fs-opt", label, undefined, text); b.setAttribute("aria-pressed", String(on)); return b; };
  const cs = toggle("Aa", t("大文字と小文字を区別"), q0.caseSensitive);
  const word = toggle("ab", t("単語単位"), q0.wholeWord);
  const re = toggle(".*", t("正規表現"), q0.regexp);
  const count = el("span", "fs-count");
  const prev = btn("fs-ic", t("前へ(Shift+Enter)"), I.up);
  const next = btn("fs-ic", t("次へ(Enter)"), I.down);
  const all = btn("fs-ic", t("一致をすべて選択"), I.all);
  const x = btn("fs-ic fs-x", t("閉じる(Esc)"), I.x);
  const fold = btn("fs-ic fs-fold", t("置換を表示"), I.chev);
  const rOne = btn("fs-txt", t("置換"), undefined, t("置換"));
  const rAll = btn("fs-txt", t("すべて置換"), undefined, t("すべて置換"));

  const f1 = el("div", "fs-row"), f2 = el("div", "fs-row fs-rep");
  const box = el("div", "fs-box"); box.append(find, cs, word, re);
  f1.append(box, count, prev, next, all, x);
  f2.append(rep, rOne, rAll);
  const body = el("div", "fs-body"); body.append(f1, f2);
  const dom = el("div", "cm-search fs");
  dom.setAttribute("role", "search");
  dom.append(fold, body);
  dom.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSearchPanel(view); view.focus(); }
    else if (e.key === "Enter" && e.target === find) { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); }
    else if (e.key === "Enter" && e.target === rep) { e.preventDefault(); (e.ctrlKey || e.metaKey ? replaceAll : replaceNext)(view); }
  });

  const commit = () => {
    const q = new SearchQuery({ search: find.value, replace: rep.value, caseSensitive: cs.getAttribute("aria-pressed") === "true", wholeWord: word.getAttribute("aria-pressed") === "true", regexp: re.getAttribute("aria-pressed") === "true" });
    if (!q.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(q) });
  };
  for (const i of [find, rep]) i.addEventListener("input", commit);
  for (const b of [cs, word, re]) b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); commit(); find.focus(); });
  const run = (b: HTMLElement, f: (v: EditorView) => boolean) => b.addEventListener("click", () => { f(view); });
  run(prev, findPrevious); run(next, findNext); run(all, selectMatches); run(rOne, replaceNext); run(rAll, replaceAll);
  x.addEventListener("click", () => { closeSearchPanel(view); view.focus(); });
  const setFold = (open: boolean) => { replaceOpen = open; dom.dataset.rep = String(open); fold.setAttribute("aria-expanded", String(open)); fold.title = fold.ariaLabel = open ? t("置換を隠す") : t("置換を表示"); };
  fold.addEventListener("click", () => setFold(!replaceOpen));
  setFold(replaceOpen);

  const refresh = (state = view.state) => {
    const q = getSearchQuery(state);
    if (!q.search) { count.textContent = ""; find.dataset.miss = "false"; return; }
    if (!q.valid) { count.textContent = t("正規表現が正しくありません"); find.dataset.miss = "true"; return; }
    let n = 0, cur = 0;
    const sel = state.selection.main, c = q.getCursor(state);
    for (let r = c.next(); !r.done; r = c.next()) { n++; if (!cur && r.value.from === sel.from && r.value.to === sel.to) cur = n; if (n >= LIMIT) break; }
    count.textContent = n ? `${cur || "–"} / ${n}${n >= LIMIT ? "+" : ""}` : t("一致なし");
    find.dataset.miss = String(n === 0);
  };
  refresh();

  return {
    dom,
    top: true,
    mount() { find.focus(); find.select(); },
    update(u: ViewUpdate) {
      for (const tr of u.transactions) for (const e of tr.effects) if (e.is(setSearchQuery) && !e.value.eq(new SearchQuery({ search: find.value, replace: rep.value, caseSensitive: cs.getAttribute("aria-pressed") === "true", wholeWord: word.getAttribute("aria-pressed") === "true", regexp: re.getAttribute("aria-pressed") === "true" }))) {
          const q = e.value; find.value = q.search; rep.value = q.replace;
          cs.setAttribute("aria-pressed", String(q.caseSensitive)); word.setAttribute("aria-pressed", String(q.wholeWord)); re.setAttribute("aria-pressed", String(q.regexp));
        }
      if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) refresh(u.state);
    },
  };
}

export const fixitSearch = search({ top: true, createPanel: make });
