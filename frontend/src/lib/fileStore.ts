/**
 * Browser-side persistent store for the *original* uploaded files.
 *
 * The backend parses/chunks/embeds documents, but the downloadable original is
 * kept here (IndexedDB) so it never disappears when the server's temporary
 * storage is cleared, and so the user can view/download it offline.
 */
const DB_NAME = "helium_files_v1";
const STORE_NAME = "files";
const DB_VERSION = 1;

export interface StoredFile {
  id: string;
  filename: string;
  contentType: string;
  blob: Blob;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export const fileStore = {
  async save(id: string, filename: string, contentType: string, blob: Blob): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const record: StoredFile = {
        id,
        filename,
        contentType: contentType || "application/octet-stream",
        blob,
        savedAt: new Date().toISOString(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save file."));
      tx.onabort = () => reject(tx.error ?? new Error("Save aborted."));
    });
  },

  async get(id: string): Promise<StoredFile | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as StoredFile) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read file."));
    });
  },

  async remove(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete file."));
    });
  },

  async clear(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear files."));
    });
  },

  async has(id: string): Promise<boolean> {
    const f = await this.get(id);
    return f !== null;
  },
};

/**
 * Cache a backend-stored file into IndexedDB so it survives server-side
 * storage wipes. Used for demo documents that were created server-side.
 */
export async function cacheRemoteFile(id: string, filename: string, contentType: string): Promise<void> {
  try {
    const res = await fetch(`/api/documents/${id}/content`);
    if (!res.ok) return;
    const blob = await res.blob();
    await fileStore.save(id, filename, contentType, blob);
  } catch {
    /* ignore — best effort */
  }
}