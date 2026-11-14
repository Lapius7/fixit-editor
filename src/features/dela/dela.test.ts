import { describe, expect, it } from "vitest";
import { findUrl, installAndPublish, publishCmd, shortUrl, stripAnsi, validPort } from "./dela";

describe("dela", () => {
  it("色コードを除いて URL を拾う", () => {
    expect(findUrl("\u001b[32m✔\u001b[0m https://app-ab12.try.lapius7.si\r\n")).toBe("https://app-ab12.try.lapius7.si");
    expect(findUrl("see https://app-ab12.try.lapius7.si.")).toBe("https://app-ab12.try.lapius7.si");
  });
  it("関係ない URL は拾わない", () => {
    expect(findUrl("https://example.com and http://app-x.try.lapius7.si")).toBeNull();
    expect(findUrl("https://try.lapius7.si/docs")).toBeNull();
  });
  it("ポートの検査と、コマンドの組み立て", () => {
    expect(["3000", " 80 ", "65535"].every(validPort)).toBe(true);
    expect(["", "0", "65536", "3000; rm", "abc", "-1"].some(validPort)).toBe(false);
    expect(publishCmd("03000")).toBe("dela 3000 --inspect");
    expect(installAndPublish("5173")).toBe("pnpm add -g @lapius/dela-cli && dela 5173 --inspect");
    expect(stripAnsi("\u001b[1mA\u001b[0m")).toBe("A");
    expect(publishCmd("3000", { temp: true })).toBe("dela 3000 --inspect --temp");
    expect(shortUrl("https://app-ab12.try.lapius7.si")).toBe("app-ab12");
    expect(shortUrl("https://app-ab12.try.lapius7.si/x")).toBe("app-ab12/x");
  });
});
