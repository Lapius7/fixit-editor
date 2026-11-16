// 拡張機能の設定で選んだ画像の置き場(IndexedDB)。kv(1 キー 1 ファイルを全部書き直す)に大きな画像を入れないため、画像だけここに置く。
const DB = "fixit-ext", ST = "blobs";
export const MAX_BLOB_BYTES = 12 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const r = f(db.transaction(ST, mode).objectStore(ST)); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => { db.close(); rej(r.error); }; });
}
export const putBlob = (key: string, b: Blob) => tx("readwrite", (s) => s.put(b, key));
export const getBlob = (key: string) => tx<Blob | undefined>("readonly", (s) => s.get(key));
export const delBlob = (key: string) => tx("readwrite", (s) => s.delete(key));
/** 拡張を消すとき、その拡張の画像をすべて消す */
export async function delBlobsOf(extId: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res) => {
    const s = db.transaction(ST, "readwrite").objectStore(ST), r = s.openCursor(IDBKeyRange.bound(`${extId}/`, `${extId}/￿`));
    r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } else { db.close(); res(); } };
    r.onerror = () => { db.close(); res(); };
  });
}
