import { describe, expect, it } from "vitest";
import { fmtMs, fmtSize, inspectBase, logAppend, logClear, logInspect, logLines, parseReqs } from "./logs";

describe("dela ログ", () => {
  it("出力を行にして、色コードと書き直しの表示を整える", () => {
    logAppend(1, "\u001b[32mdela\u001b[0m · try\r\n\u001b[2K\r⠋ 接続中");
    logAppend(1, "\r⠙ 接続中\r\n✔ https://app-ab12.try.lapius7.si\r\n  🔍  inspect: http://127.0.0.1:4041\r\n");
    expect(logLines(1)).toEqual(["dela · try", "⠙ 接続中", "✔ https://app-ab12.try.lapius7.si", "  🔍  inspect: http://127.0.0.1:4041"]);
    expect(logInspect(1)).toBe("http://127.0.0.1:4041");
  });
  it("書き終えていない行も見え、端末の準備確認は除く", () => {
    logAppend(2, "echo $((7*123456))\r\n864192\r\nrunning");
    expect(logLines(2)).toEqual(["running"]);
    logClear(2);
    expect(logLines(2)).toEqual([]);
  });
  it("500 行を超えたら古いものから捨てる", () => {
    logAppend(3, Array.from({ length: 520 }, (_, i) => `l${i}`).join("\n") + "\n");
    expect(logLines(3)).toHaveLength(500);
    expect(logLines(3)[0]).toBe("l20");
  });
  it("リクエストの一覧を読み、壊れた入力は null にする", () => {
    const r = parseReqs('[{"id":1,"time":"2026-11-14T01:02:03Z","method":"GET","path":"/a?b=1","remote":"1.2.3.4","status":200,"durationMs":12,"reqSize":0,"respSize":2048},{"x":1}]');
    expect(r).toHaveLength(1);
    expect(r![0]).toMatchObject({ id: 1, method: "GET", status: 200, respSize: 2048 });
    expect(parseReqs("curl: (7) Failed")).toBeNull();
    expect(parseReqs("{}")).toBeNull();
  });
  it("inspect の場所は自分の PC のものだけ、表示の整形", () => {
    expect(inspectBase("http://127.0.0.1:4040")).toBe("http://127.0.0.1:4040");
    expect(["http://evil.com:4040", "http://127.0.0.1:4040/x", "https://127.0.0.1:4040", undefined, "http://127.0.0.1:4040'; rm"].map(inspectBase)).toEqual([null, null, null, null, null]);
    expect([fmtMs(12), fmtMs(1500), fmtSize(10), fmtSize(2048), fmtSize(3 << 20)]).toEqual(["12 ms", "1.5 s", "10 B", "2.0 KB", "3.0 MB"]);
  });
});
