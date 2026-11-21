import type { GameState } from "./types";

const DATABASE_NAME = "fgame-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "saves";
const SAVE_KEY = "active-story";

interface StoredSave {
  key: string;
  state: GameState;
  savedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地存档"));
    request.onblocked = () => reject(new Error("本地存档升级被其他页面阻塞，请关闭重复打开的游戏页面后重试"));
  });
}

export async function loadSave(): Promise<GameState | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(SAVE_KEY);
    request.onsuccess = () => {
      const record = request.result as StoredSave | undefined;
      resolve(record?.state ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("读取存档失败"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("读取存档事务失败"));
  });
}

export async function saveGame(state: GameState): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const record: StoredSave = { key: SAVE_KEY, state, savedAt: new Date().toISOString() };
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("保存存档失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("保存存档已中断"));
  });
}

export async function removeSave(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(SAVE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("删除存档失败"));
  });
}
