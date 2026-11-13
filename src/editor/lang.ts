import { LanguageDescription } from "@codemirror/language";
import { languages as base } from "@codemirror/language-data";
import i18next from 'i18next'

// SQL は、キーワードの補完を大文字(SELECT)で出す。標準のままだと小文字(select)になる
const SQL_DIALECT: Record<string, string> = {
  "SQL": "StandardSQL", "MS SQL": "MSSQL", "MariaDB SQL": "MariaSQL", "MySQL": "MySQL",
  "PLSQL": "PLSQL", "PostgreSQL": "PostgreSQL", "SQLite": "SQLite", "Cassandra": "Cassandra",
};
const withUpperSql = (d: LanguageDescription) => {
  const dialect = SQL_DIALECT[d.name];
  if (!dialect) return d;
  return LanguageDescription.of({
    name: d.name, alias: d.alias, extensions: d.extensions, filename: d.filename,
    load: () => import("@codemirror/lang-sql").then((m) => m.sql({ dialect: (m as unknown as Record<string, never>)[dialect], upperCaseKeywords: true })),
  });
};

// 標準の一覧に無い言語(Mermaid)を足したもの
export const languages: LanguageDescription[] = [
  ...base.map(withUpperSql),
  LanguageDescription.of({ name: "Mermaid", alias: ["mermaid", "mmd"], extensions: ["mmd", "mermaid"], load: () => import("codemirror-lang-mermaid").then((m) => m.mermaid()) }),
];

export const langName = (file: string) => LanguageDescription.matchFilename(languages, file)?.name ?? i18next.t("テキスト");
