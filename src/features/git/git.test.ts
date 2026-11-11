import { describe, expect, it } from "vitest";
import { parseChanges, parseLog } from "@/features/git/git";

describe("parseChanges", () => {
  it("ブランチ・追跡先・先行と遅れを読む", () => {
    const st = parseChanges("## main...origin/main [ahead 1, behind 2]\0");
    expect(st).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1, behind: 2, detached: false });
  });
  it("ステージ済み・未ステージ・衝突・名前の変更を分ける", () => {
    const raw = ["## main", "M  a.ts", " M b.ts", "?? c.ts", "UU d.ts", "R  new.ts", "old.ts", ""].join("\0");
    const st = parseChanges(raw);
    expect(st.staged.map((c) => c.path)).toEqual(["a.ts", "new.ts"]);
    expect(st.staged[1].orig).toBe("old.ts");
    expect(st.unstaged.map((c) => c.path)).toEqual(["b.ts", "c.ts"]);
    expect(st.conflicts.map((c) => c.path)).toEqual(["d.ts"]);
  });
  it("ブランチのない HEAD を見分ける", () => {
    expect(parseChanges("## HEAD (no branch)\0")).toMatchObject({ branch: "HEAD", detached: true });
  });
});

describe("parseLog", () => {
  it("区切り文字ごとに項目を読む", () => {
    const rec = ["abc123", "p1 p2", "Lapius", "1700000000", "", "Fix bug"].join("\x1f");
    const [c] = parseLog(rec + "\0");
    expect(c).toMatchObject({ hash: "abc123", parents: ["p1", "p2"], author: "Lapius", at: 1700000000000, subject: "Fix bug" });
  });
});
