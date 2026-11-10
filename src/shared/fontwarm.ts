// 日本語フォントは unicode-range で分割されていて、その字が初めて画面に出たときに読み込まれる。
// フォルダを初めて開いた直後に読み込みが重なって引っかかるため、起動後の空き時間に、よく使う字の分だけ先に読み込んでおく。
const COMMON =
  "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー" +
  "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲン" +
  "日本語文字列設定開保存削除名前変更新規作成編集表示検索置換実行戻進閉終了確認取消選択全部分一覧履歴統計外観言語色濃面透明速度大小幅高重要情報接続接続済認証鍵送信受取返答質問説明例資料" +
  "家人時年月火水木金土今前後上下左右中内入出生死使用無有可不能事物理由方法場合点線行列例題結果状態種類名称内容形式用意準備必要場所";

let done = false;
export function warmJaFont() {
  if (done || typeof document === "undefined" || !document.fonts) return;
  done = true;
  const run = () => {
    for (const w of [400, 600]) void document.fonts.load(`${w} 14px "Noto Sans JP Variable"`, COMMON).catch(() => {});
  };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 }); else setTimeout(run, 1500);
}
