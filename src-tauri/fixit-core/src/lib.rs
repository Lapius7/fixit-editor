// フィクシットエディタの Rust 側の中身。Tauri に依存しないので、Linux でもテストできる。
// ブラウザ版(開発サーバー)の server/fsapi.ts と server/claude.ts と同じ振る舞いにそろえている。
pub mod claude;
pub mod fs;
pub mod git;
pub mod local;
pub mod run;
pub mod store;
pub mod fonts;
pub mod update;
