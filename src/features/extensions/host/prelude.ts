// 拡張機能のスクリプトを動かす Worker の先頭に付ける前半。fixit オブジェクト(本体との RPC)を作ってから、拡張のコードを呼ぶ。
// 拡張のコードは、この関数の「引数」として渡す(前半の変数は見えない)。Worker には window も DOM も無く、通信は本体から渡された MessagePort だけ。
// ここは文字列として Worker に渡すので、TypeScript ではなく素の JavaScript で書く。
export const PRELUDE = String.raw`(function (__def) {
  "use strict";
  // 入れ子の Worker で見張りを逃れないように、先に外す
  try { delete self.Worker; delete self.SharedWorker; } catch (e) {}
  var port = null, seq = 0, pend = new Map(), cmds = new Map(), subs = [], cache = {}, evs = { open: [], change: [], save: [] }, provs = {}, pacts = [];
  function call(m, a) { return new Promise(function (res, rej) { var id = ++seq; pend.set(id, [res, rej]); port.postMessage({ id: id, m: m, a: a || [] }); }); }
  function onHost(d) {
    if (d.ev === "ping") { port.postMessage({ id: ++seq, m: "pong", a: [] }); return; }
    if (d.id) { var p = pend.get(d.id); if (!p) return; pend.delete(d.id); if (d.e) p[1](new Error(d.e)); else p[0](d.r); return; }
    if (d.ev === "command") { var f = cmds.get(d.cid); if (f) Promise.resolve().then(function () { return f(d.arg); }).catch(function (e) { call("log", [String(e && e.message || e)]); }); }
    else if (d.ev === "editor") { (evs[d.kind] || []).forEach(function (f) { try { f({ path: d.path, ext: d.ext, text: d.text, truncated: !!d.truncated }); } catch (e) {} }); }
    else if (d.ev === "panel") { pacts.slice().forEach(function (f) { try { f({ panel: d.panel, action: d.action, value: d.value }); } catch (e) {} }); }
    else if (d.ev === "provide") {
      var h = provs[d.key]; var out = Promise.resolve(null);
      if (h) out = Promise.resolve().then(function () { return h(d.payload); }).catch(function () { return null; });
      out.then(function (v) { return call("provide.reply", [d.rid, v === undefined ? null : v]); }).catch(function () {});
    }
    else if (d.ev === "setting") { cache[d.key] = d.value; subs.forEach(function (f) { try { f(d.key, d.value); } catch (e) {} }); }
  }
  function on(kind, f) {
    if (typeof f !== "function") throw new TypeError("handler");
    evs[kind].push(f); call("editor.on", [kind]).catch(function () {});
    return function () { evs[kind] = evs[kind].filter(function (x) { return x !== f; }); };
  }
  function reg(kind, langs, f) {
    if (typeof f !== "function") throw new TypeError("handler");
    provs[kind] = f; return call("editor.provide", [kind, Array.isArray(langs) ? langs : ["*"]]);
  }
  var fixit = Object.freeze({
    commands: Object.freeze({ register: function (id, fn) { if (typeof fn !== "function") throw new TypeError("handler"); cmds.set(String(id), fn); } }),
    settings: Object.freeze({
      get: function (k) { return cache[k]; },
      all: function () { return Object.assign({}, cache); },
      set: function (k, v) { return call("settings.set", [k, v]); },
      onDidChange: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; }
    }),
    storage: Object.freeze({ get: function (k) { return call("storage.get", [k]); }, set: function (k, v) { return call("storage.set", [k, v]); } }),
    statusBar: Object.freeze({ set: function (id, item) { return call("statusBar.set", [id, item === undefined ? null : item]); }, remove: function (id) { return call("statusBar.set", [id, null]); } }),
    window: Object.freeze({
      showQuickPick: function (items, o) {
        var list = Array.isArray(items) ? items : [];
        return call("window.showQuickPick", [list, o || {}]).then(function (i) { return i === null ? undefined : list[i]; });
      },
      showInputBox: function (o) { return call("window.showInputBox", [o || {}]).then(function (v) { return v === null ? undefined : v; }); },
      pickFile: function () { return call("window.pickFile", []).then(function (v) { return v === null ? undefined : v; }); },
      showMessage: function (t, kind) { return call("ui.showMessage", [t, kind]); }
    }),
    editor: Object.freeze({
      activeFile: function () { return call("editor.activeFile"); },
      getText: function () { return call("editor.getText"); },
      selection: function () { return call("editor.selection"); },
      replaceRange: function (from, to, text) { return call("editor.replaceRange", [from, to, text]); },
      onDidOpen: function (f) { return on("open", f); },
      onDidChange: function (f) { return on("change", f); },
      onDidSave: function (f) { return on("save", f); },
      registerCompletionProvider: function (langs, f) { return reg("completion", langs, f); },
      registerHoverProvider: function (langs, f) { return reg("hover", langs, f); },
      registerDiagnosticsProvider: function (langs, f) { return reg("diagnostics", langs, f); },
      registerFormatter: function (langs, f) { return reg("format", langs, f); }
    }),
    panels: Object.freeze({
      set: function (id, panel) { return call("panel.set", [id, panel === undefined ? null : panel]); },
      remove: function (id) { return call("panel.set", [id, null]); },
      reveal: function (id) { return call("panel.reveal", [id]); },
      onAction: function (f) { if (typeof f !== "function") throw new TypeError("handler"); pacts.push(f); return function () { pacts = pacts.filter(function (x) { return x !== f; }); }; }
    }),
    workspace: Object.freeze({
      readFile: function (p) { return call("workspace.readFile", [p]); },
      writeFile: function (p, t) { return call("workspace.writeFile", [p, t]); },
      list: function (p) { return call("workspace.list", [p === undefined ? "/" : p]); }
    }),
    terminal: Object.freeze({ run: function (cmd, args) { return call("terminal.run", [cmd, args || []]); } }),
    net: Object.freeze({ fetch: function (url, o) { return call("net.fetch", [url, o || {}]); } }),
    ui: Object.freeze({
      setBackgroundImage: function (o) { return call("ui.setBackgroundImage", [o]); },
      setCss: function (t) { return call("ui.setCss", [t]); },
      showMessage: function (t, kind) { return call("ui.showMessage", [t, kind]); }
    })
  });
  self.onmessage = function (e) {
    if (!e.data || e.data.t !== "init" || !e.ports[0]) return;
    self.onmessage = null; port = e.ports[0]; port.onmessage = function (m) { onHost(m.data); };
    call("settings.all").then(function (all) {
      cache = all || {};
      var module = { exports: {} };
      __def(module, module.exports, fixit);
      var act = module.exports && module.exports.activate;
      return typeof act === "function" ? act(fixit) : null;
    }).then(function () { return call("ready"); }).catch(function (err) { call("fail", [String(err && err.message || err)]); });
  };
})(function (module, exports, fixit) {
`;
export const POSTLUDE = "\n});";
