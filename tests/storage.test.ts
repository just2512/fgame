import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import storyJson from "../src/content/sudden-billionaire.json";
import { startGame } from "../src/engine/engine";
import {
  createNewSave,
  getDefaultSaveContext,
  inspectActiveSave,
  SAVE_DATABASE_NAME
} from "../src/engine/storage";
import type { SaveContext } from "../src/engine/storage";
import type { GameState, StoryDefinition } from "../src/engine/types";

const story = storyJson as StoryDefinition;
const LEGACY_STORE = "legacySaves";
const SAVE_STORE = "saves";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SAVE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("删除测试数据库失败"));
    request.onblocked = () => reject(new Error("测试数据库仍有未关闭的连接"));
  });
}

async function createLegacyV1Database(record: { key: string; state: GameState; savedAt: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(SAVE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SAVE_STORE, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error ?? new Error("创建 v1 测试数据库失败"));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(SAVE_STORE, "readwrite");
      transaction.objectStore(SAVE_STORE).add(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("写入 v1 测试存档失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("写入 v1 测试存档事务中断"));
    };
  });
}

async function readStore<T>(storeName: string, mode: IDBTransactionMode, key?: IDBValidKey): Promise<T> {
  const request = indexedDB.open(SAVE_DATABASE_NAME, 2);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开测试数据库失败"));
  });

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const operation = key === undefined ? store.getAll() : store.get(key);
    let result: T | undefined;
    operation.onsuccess = () => { result = operation.result as T; };
    operation.onerror = () => reject(operation.error ?? new Error("读取测试存档失败"));
    transaction.oncomplete = () => {
      database.close();
      resolve(result as T);
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("读取测试存档事务失败"));
  });
}

async function mutateSave(saveId: string, mutate: (record: Record<string, unknown>) => void): Promise<void> {
  const request = indexedDB.open(SAVE_DATABASE_NAME, 2);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开测试数据库失败"));
  });

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SAVE_STORE, "readwrite");
    const store = transaction.objectStore(SAVE_STORE);
    const getRequest = store.get(saveId);
    getRequest.onsuccess = () => {
      const record = getRequest.result as Record<string, unknown>;
      mutate(record);
      store.put(record);
    };
    getRequest.onerror = () => reject(getRequest.error ?? new Error("读取待修改测试存档失败"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("修改测试存档失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("修改测试存档事务中断"));
  });
}

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(async () => {
  await deleteDatabase();
});

describe("versioned IndexedDB save protection", () => {
  it("migrates the v1 record into a legacy archive without changing its saved state", async () => {
    const context = await getDefaultSaveContext();
    const state = startGame(story, "legacy-v1-seed");
    const legacyRecord = {
      key: "active-story",
      state,
      savedAt: "2026-11-21T00:00:00.000Z"
    };
    const stateBefore = JSON.stringify(legacyRecord.state);

    await createLegacyV1Database(legacyRecord);
    const inspection = await inspectActiveSave(context);

    expect(inspection.status).toBe("incompatible");
    if (inspection.status !== "incompatible") throw new Error("Expected legacy save to be incompatible");
    expect(inspection.reason).toContain("旧格式存档");

    const archived = await readStore<Record<string, unknown>>(LEGACY_STORE, "readonly", "active-story");
    expect(archived).toEqual(legacyRecord);
    expect(JSON.stringify(archived.state)).toBe(stateBefore);
    expect(await readStore<unknown[]>(SAVE_STORE, "readonly")).toEqual([]);
  });

  it("creates multiple save records and never overwrites an older game when starting a new one", async () => {
    const context = await getDefaultSaveContext();
    const firstState = startGame(story, "first-game-seed");
    const secondState = startGame(story, "second-game-seed");

    const firstId = await createNewSave(firstState, context, "save-first");
    const secondId = await createNewSave(secondState, context, "save-second");

    expect(firstId).not.toBe(secondId);
    const records = await readStore<Array<{ saveId: string; state: GameState }>>(SAVE_STORE, "readonly");
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.saveId === firstId)?.state).toEqual(firstState);
    expect(records.find((record) => record.saveId === secondId)?.state).toEqual(secondState);

    const active = await inspectActiveSave(context);
    expect(active.status).toBe("ready");
    if (active.status !== "ready") throw new Error("Expected the second save to be active");
    expect(active.saveId).toBe(secondId);
    expect(active.state.seed).toBe("second-game-seed");
  });

  const compatibilityMismatches: Array<{
    label: string;
    update: (context: SaveContext) => SaveContext;
    reason: string;
  }> = [
    {
      label: "storyId",
      update: (context) => ({ ...context, storyId: "another-story" }),
      reason: "另一个故事"
    },
    {
      label: "storyVersion",
      update: (context) => ({ ...context, storyVersion: "older-story-version" }),
      reason: "故事内容版本已变化"
    },
    {
      label: "contentHash",
      update: (context) => ({ ...context, contentHash: "sha256:changed-content" }),
      reason: "故事内容与存档时不一致"
    },
    {
      label: "engineCompatibilityVersion",
      update: (context) => ({ ...context, engineCompatibilityVersion: context.engineCompatibilityVersion + 1 }),
      reason: "游戏引擎存档兼容版本已变化"
    }
  ];

  it.each(compatibilityMismatches)(
    "marks $label mismatches incompatible without modifying state",
    async ({ update, reason }) => {
      const context = await getDefaultSaveContext();
      const state = startGame(story, "compatibility-mismatch-seed");
      const saveId = await createNewSave(state, context, "compatibility-mismatch-save");

      const incompatible = await inspectActiveSave(update(context));
      expect(incompatible.status).toBe("incompatible");
      if (incompatible.status !== "incompatible") throw new Error("Expected incompatible save");
      expect(incompatible.reason).toContain(reason);

      const stored = await readStore<{ saveId: string; status: string; state: GameState }>(
        SAVE_STORE,
        "readonly",
        saveId
      );
      expect(stored.status).toBe("incompatible");
      expect(stored.state).toEqual(state);
      expect(JSON.stringify(stored.state)).toBe(JSON.stringify(state));
    }
  );

  it("rejects an unsupported saveVersion while preserving the original state", async () => {
    const context = await getDefaultSaveContext();
    const state = startGame(story, "save-format-version-seed");
    const saveId = await createNewSave(state, context, "save-format-version-save");
    await mutateSave(saveId, (record) => { record.saveVersion = 0; });

    const incompatible = await inspectActiveSave(context);
    expect(incompatible.status).toBe("incompatible");
    if (incompatible.status !== "incompatible") throw new Error("Expected incompatible save");
    expect(incompatible.reason).toContain("存档数据结构版本不兼容");

    const stored = await readStore<{ saveId: string; status: string; state: GameState }>(
      SAVE_STORE,
      "readonly",
      saveId
    );
    expect(stored.status).toBe("incompatible");
    expect(stored.state).toEqual(state);
  });

  it("marks corrupt records and keeps the damaged state instead of crashing or replacing it", async () => {
    const context = await getDefaultSaveContext();
    const state = startGame(story, "corrupt-save-seed");
    const saveId = await createNewSave(state, context, "corrupt-save");
    await mutateSave(saveId, (record) => { record.state = null; });

    const inspection = await inspectActiveSave(context);
    expect(inspection.status).toBe("corrupt");
    if (inspection.status !== "corrupt") throw new Error("Expected corrupt save status");
    expect(inspection.reason).toContain("损坏");

    const stored = await readStore<{ status: string; state: unknown }>(SAVE_STORE, "readonly", saveId);
    expect(stored.status).toBe("corrupt");
    expect(stored.state).toBeNull();
  });

  it("aborts a duplicate-ID transaction without switching the active-save pointer", async () => {
    const context = await getDefaultSaveContext();
    const originalState = startGame(story, "atomic-original-seed");
    const attemptedState = startGame(story, "atomic-new-seed");
    const saveId = await createNewSave(originalState, context, "fixed-save-id");

    await expect(createNewSave(attemptedState, context, saveId)).rejects.toThrow();

    const active = await inspectActiveSave(context);
    expect(active.status).toBe("ready");
    if (active.status !== "ready") throw new Error("Expected the original save to remain active");
    expect(active.saveId).toBe(saveId);
    expect(active.state).toEqual(originalState);

    const records = await readStore<unknown[]>(SAVE_STORE, "readonly");
    expect(records).toHaveLength(1);
  });
});
