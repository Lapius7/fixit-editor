// 拡張機能を動かす隔離ページ(固定の HTML)。拡張のコードはここの Worker の中だけで動き、このページの window には触れない。
// CSP は、通信(connect-src)・読み込み・eval をすべて止め、Worker(blob:)だけ許す。ページ自身のスクリプトは下の起動役だけ。
export const HOST_HTML = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<script>
addEventListener("message", function (e) {
  var d = e.data;
  if (e.source !== parent || !d || d.t !== "boot" || !e.ports[0]) return;
  var url = URL.createObjectURL(new Blob([d.code], { type: "text/javascript" }));
  var w = new Worker(url);
  w.onerror = function (ev) { parent.postMessage({ t: "error", m: String(ev.message || "error") }, "*"); };
  w.postMessage({ t: "init" }, [e.ports[0]]);
});
parent.postMessage({ t: "ready" }, "*");
</script>`;
