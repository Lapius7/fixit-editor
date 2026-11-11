import { FileWarning, FileX2 } from "lucide-react";
import i18next from "i18next";
import type { View } from "@/platform/load";
import ImageView from "@/workbench/ImageView";

const DOC_CSS = `body{font:15px/1.8 "Inter","Noto Sans JP",system-ui,sans-serif;color:#1f2430;max-width:760px;margin:0 auto;padding:40px 32px}
h1,h2,h3{line-height:1.4}table{border-collapse:collapse}td,th{border:1px solid #d5d9e0;padding:6px 10px}img{max-width:100%}a{color:#3b6fd9}`;

export default function Viewer({ view, name, path, onSaveImage, onForce }: { view: Exclude<View, { kind: "text" }>; name: string; path: string; onSaveImage?: (blob: Blob, outName: string) => Promise<void>; onForce?: () => void }) {
  switch (view.kind) {
    case "image": return <ImageView id={path} url={view.url} name={name} onSave={onSaveImage} />;
    case "pdf": return <iframe className="view-frame" src={view.url} title={name} />;
    case "docx": return <iframe className="view-frame" sandbox="" title={name} srcDoc={`<!doctype html><meta charset="utf-8"><style>${DOC_CSS}</style>${view.html}`} />;
    case "audio": return <div className="view"><audio controls src={view.url} /></div>;
    case "video": return <div className="view"><video controls src={view.url} /></div>;
    case "unsupported":
      return (
        <div className="view unsupported" data-big={view.big || undefined} role={view.big ? "status" : "alert"}>
          {view.big ? <FileWarning /> : <FileX2 />}
          <p className="u-title">{view.reason}</p>
          <p className="u-name">{name}</p>
          {view.hint && <p className="u-hint">{view.hint}</p>}
          {view.big && onForce && <button className="btn u-load" onClick={onForce}>{i18next.t("読み込む")}</button>}
        </div>
      );
  }
}
