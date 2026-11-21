import storyJson from "../content/sudden-billionaire.json";
import { sha256Json } from "./content-hash";
import type { GameState, StoryDefinition } from "./types";

export const SAVE_DATABASE_NAME = "fgame-local";
export const SAVE_FORMAT_VERSION = 1;
export const ENGINE_VERSION = "0.1.0";
export const ENGINE_COMPATIBILITY_VERSION = 1;

const DATABASE_VERSION = 2;
const STORE_NAME = "saves";
const LEGACY_STORE_NAME = "legacySaves";
const META_STORE_NAME = "meta";
const ACTIVE_SAVE_KEY = "activeSaveId";
const story = storyJson as StoryDefinition;

type SaveStatus = "in_progress" | "completed" | "incompatible" | "corrupt";

export interface SaveContext {
  storyId: string;
  storyVersion: string;
  contentHash: string;
  engineVersion: string;
  engineCompatibilityVersion: number;
}

export interface SaveRecord {
  saveId: string;
  storyId: string;
  saveVersion: number;
  storyVersion: string;
  contentHash: string;
  engineVersion: string;
  engineCompatibilityVersion: number;
  createdAt: string;
  updatedAt: string;
  status: SaveStatus;
  state: GameState;
}

export type SaveInspection =
  | { status: "none" }
  | { status: "ready"; saveId: string; state: GameState; record: SaveRecord }
  | { status: "incompatible"; saveId: string | null; reason: string }
  | { status: "corrupt"; saveId: string | null; reason: string };

interface MetaRecord {
  key: string;
  value: unknown;
}

interface LegacySaveRecord {
  key: string;
  state?: unknown;
  savedAt?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSaveStatus(value: unknown): value is SaveStatus {
  return value === "in_progress" || value === "completed" || value === "incompatible" || value === "corrupt";
}

function isSaveRecord(value: unknown): value is SaveRecord {
  if (!isObject(value)) return false;
  return typeof value.saveId === "string"
    && value.saveId.length > 0
    && typeof value.storyId === "string"
    && typeof value.saveVersion === "number"
    && typeof value.storyVersion === "string"
    && typeof value.contentHash === "string"
    && typeof value.engineVersion === "string"
    && typeof value.engineCompatibilityVersion === "number"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && isSaveStatus(value.status);
}

function isGameState(value: unknown, record: Pick<SaveRecord, "storyId" | "storyVersion">): value is GameState {
  if (!isObject(value)) return false;
  return value.storyId === record.storyId
    && value.storyVersion === record.storyVersion
    && typeof value.seed === "string"
    && typeof value.rngState === "number"
    && typeof value.turn === "number"
    && isObject(value.time)
    && isObject(value.player)
    && isObject(value.forces)
    && isObject(value.npcs)
    && isObject(value.flags)
    && isObject(value.pressures)
    && Array.isArray(value.trajectory)
    && Array.isArray(value.triggeredPressures)
    && Array.isArray(value.pending)
    && Array.isArray(value.completedEvents)
    && Array.isArray(value.history)
    && (typeof value.currentEventId === "string" || value.currentEventId === null)
    && typeof value.offerRandom === "boolean"
    && typeof value.ended === "boolean"
    && (isObject(value.lastResult) || value.lastResult === null);
}

function compatibilityIssue(record: SaveRecord, context: SaveContext): string | null {
  if (record.saveVersion !== SAVE_FORMAT_VERSION) return "存档数据结构版本不兼容";
  if (record.storyId !== context.storyId) return "该存档属于另一个故事";
  if (record.storyVersion !== context.storyVersion) return "故事内容版本已变化";
  if (record.contentHash !== context.contentHash) return "故事内容与存档时不一致";
  if (record.engineCompatibilityVersion !== context.engineCompatibilityVersion) return "游戏引擎存档兼容版本已变化";
  return null;
}

function randomSaveId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("当前环境无法安全生成本地存档编号");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVE_DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) {
        throw new Error("无法启动存档数据库升级事务");
      }

      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.createObjectStore(LEGACY_STORE_NAME, { keyPath: "key" });
      }
      const metaStore = database.objectStoreNames.contains(META_STORE_NAME)
        ? transaction.objectStore(META_STORE_NAME)
        : database.createObjectStore(META_STORE_NAME, { keyPath: "key" });

      if (event.oldVersion < 2 && database.objectStoreNames.contains(STORE_NAME)) {
        // v1 使用 key="active-story" 的单记录结构。先原样复制到归档库，
        // 等游标读完后才删除旧 store；升级事务失败时整个 schema 变更会回滚。
        const oldStore = transaction.objectStore(STORE_NAME);
        const archiveStore = transaction.objectStore(LEGACY_STORE_NAME);
        const cursorRequest = oldStore.openCursor();
        cursorRequest.onerror = () => transaction.abort();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            archiveStore.put(cursor.value as LegacySaveRecord);
            cursor.continue();
            return;
          }
          database.deleteObjectStore(STORE_NAME);
          database.createObjectStore(STORE_NAME, { keyPath: "saveId" });
          metaStore.put({ key: ACTIVE_SAVE_KEY, value: null } satisfies MetaRecord);
        };
      } else if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "saveId" });
        metaStore.put({ key: ACTIVE_SAVE_KEY, value: null } satisfies MetaRecord);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开本地存档"));
    request.onblocked = () => reject(new Error("本地存档升级被其他页面阻塞，请关闭重复打开的游戏页面后重试"));
  });
}

export async function getDefaultSaveContext(): Promise<SaveContext> {
  return {
    storyId: story.id,
    storyVersion: story.version,
    contentHash: await sha256Json({ "src/content/sudden-billionaire.json": story }),
    engineVersion: ENGINE_VERSION,
    engineCompatibilityVersion: ENGINE_COMPATIBILITY_VERSION
  };
}

function assertStateMatchesContext(state: GameState, context: SaveContext): void {
  if (state.storyId !== context.storyId || state.storyVersion !== context.storyVersion) {
    throw new Error("当前游戏状态与待保存的故事版本不一致");
  }
}

function buildSaveRecord(state: GameState, context: SaveContext, saveId: string, now: string): SaveRecord {
  assertStateMatchesContext(state, context);
  return {
    saveId,
    storyId: context.storyId,
    saveVersion: SAVE_FORMAT_VERSION,
    storyVersion: context.storyVersion,
    contentHash: context.contentHash,
    engineVersion: context.engineVersion,
    engineCompatibilityVersion: context.engineCompatibilityVersion,
    createdAt: now,
    updatedAt: now,
    status: state.ended ? "completed" : "in_progress",
    state
  };
}

export async function createNewSave(
  state: GameState,
  context?: SaveContext,
  requestedSaveId?: string
): Promise<string> {
  const resolvedContext = context ?? await getDefaultSaveContext();
  const saveId = requestedSaveId ?? randomSaveId();
  const record = buildSaveRecord(state, resolvedContext, saveId, new Date().toISOString());
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const saveStore = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE_NAME);
    let failure: Error | null = null;

    saveStore.add(record);
    metaStore.put({ key: ACTIVE_SAVE_KEY, value: saveId } satisfies MetaRecord);

    transaction.oncomplete = () => {
      database.close();
      resolve(saveId);
    };
    transaction.onerror = () => {
      failure = failure ?? transaction.error ?? new Error("创建新存档失败");
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("创建新存档事务已中断；原活动存档保持不变"));
    };
  });
}

export async function inspectActiveSave(
  context?: SaveContext
): Promise<SaveInspection> {
  const resolvedContext = context ?? await getDefaultSaveContext();
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, META_STORE_NAME, LEGACY_STORE_NAME], "readwrite");
    const saveStore = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE_NAME);
    const legacyStore = transaction.objectStore(LEGACY_STORE_NAME);
    let result: SaveInspection = { status: "none" };
    let failure: Error | null = null;

    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      failure = failure ?? transaction.error ?? new Error("检查本地存档失败");
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("检查本地存档事务已中断"));
    };

    const pointerRequest = metaStore.get(ACTIVE_SAVE_KEY);
    pointerRequest.onerror = () => {
      failure = pointerRequest.error ?? new Error("读取活动存档指针失败");
      transaction.abort();
    };
    pointerRequest.onsuccess = () => {
      const pointer = (pointerRequest.result as MetaRecord | undefined)?.value;

      if (pointer === null || pointer === undefined) {
        const legacyRequest = legacyStore.getAll();
        legacyRequest.onerror = () => {
          failure = legacyRequest.error ?? new Error("读取旧版存档归档失败");
          transaction.abort();
        };
        legacyRequest.onsuccess = () => {
          result = legacyRequest.result.length > 0
            ? { status: "incompatible", saveId: null, reason: "发现旧格式存档，已完整保留；该格式不能由当前版本直接继续，请新建存档。" }
            : { status: "none" };
        };
        return;
      }

      if (typeof pointer !== "string" || pointer.length === 0) {
        result = { status: "corrupt", saveId: null, reason: "活动存档指针格式损坏，原存档记录未删除。" };
        return;
      }

      const saveRequest = saveStore.get(pointer);
      saveRequest.onerror = () => {
        failure = saveRequest.error ?? new Error("读取存档记录失败");
        transaction.abort();
      };
      saveRequest.onsuccess = () => {
        const raw = saveRequest.result as unknown;

        if (raw === undefined) {
          result = { status: "corrupt", saveId: pointer, reason: "活动存档指向的记录不存在，未创建替代记录。" };
          return;
        }

        if (!isSaveRecord(raw)) {
          if (isObject(raw) && typeof raw.saveId === "string") {
            saveStore.put({ ...raw, status: "corrupt" });
          }
          result = { status: "corrupt", saveId: pointer, reason: "存档结构损坏，原记录已保留，不能安全继续。" };
          return;
        }

        if (raw.status === "corrupt") {
          result = { status: "corrupt", saveId: raw.saveId, reason: "该存档此前已被标记为损坏，原始状态仍然保留。" };
          return;
        }

        if (!isGameState(raw.state, raw)) {
          saveStore.put({ ...raw, status: "corrupt" });
          result = { status: "corrupt", saveId: raw.saveId, reason: "存档损坏：状态数据不完整或与存档元数据不一致，原始 state 未修改。" };
          return;
        }

        const issue = compatibilityIssue(raw, resolvedContext);
        if (issue) {
          saveStore.put({ ...raw, status: "incompatible" });
          result = { status: "incompatible", saveId: raw.saveId, reason: issue + "。旧存档已保留，不会被新游戏覆盖。" };
          return;
        }

        const normalizedStatus: SaveStatus = raw.state.ended ? "completed" : "in_progress";
        const compatibleRecord: SaveRecord = raw.status === normalizedStatus
          ? raw
          : { ...raw, status: normalizedStatus };
        if (compatibleRecord !== raw) saveStore.put(compatibleRecord);
        result = { status: "ready", saveId: raw.saveId, state: raw.state, record: compatibleRecord };
      };
    };
  });
}

export async function loadSave(context?: SaveContext): Promise<GameState | null> {
  const resolvedContext = context ?? await getDefaultSaveContext();
  const result = await inspectActiveSave(resolvedContext);
  if (result.status === "ready") return result.state;
  if (result.status === "incompatible" || result.status === "corrupt") {
    throw new Error(result.reason);
  }
  return null;
}

export async function saveGame(state: GameState, context?: SaveContext): Promise<void> {
  const resolvedContext = context ?? await getDefaultSaveContext();
  assertStateMatchesContext(state, resolvedContext);

  // 主线开始时代表一次新游戏，必须分配新 saveId，不能覆盖上一局。
  if (state.turn === 0) {
    await createNewSave(state, resolvedContext);
    return;
  }

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const saveStore = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE_NAME);
    let failure: Error | null = null;

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      failure = failure ?? transaction.error ?? new Error("保存存档失败");
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("保存存档事务已中断"));
    };

    const pointerRequest = metaStore.get(ACTIVE_SAVE_KEY);
    pointerRequest.onerror = () => {
      failure = pointerRequest.error ?? new Error("读取活动存档指针失败");
      transaction.abort();
    };
    pointerRequest.onsuccess = () => {
      const saveId = (pointerRequest.result as MetaRecord | undefined)?.value;

      if (typeof saveId !== "string" || saveId.length === 0) {
        const newId = randomSaveId();
        const now = new Date().toISOString();
        saveStore.add(buildSaveRecord(state, resolvedContext, newId, now));
        metaStore.put({ key: ACTIVE_SAVE_KEY, value: newId } satisfies MetaRecord);
        return;
      }

      const existingRequest = saveStore.get(saveId);
      existingRequest.onerror = () => {
        failure = existingRequest.error ?? new Error("读取待更新的存档失败");
        transaction.abort();
      };
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as unknown;
        if (!isSaveRecord(existing) || existing.status === "corrupt" || !isGameState(existing.state, existing)) {
          failure = new Error("当前存档损坏或格式未知，已拒绝自动覆盖");
          transaction.abort();
          return;
        }
        if (existing.state.seed !== state.seed) {
          failure = new Error("当前活动存档已切换，已拒绝旧页面覆盖另一局游戏");
          transaction.abort();
          return;
        }
        const issue = compatibilityIssue(existing, resolvedContext);
        if (issue) {
          failure = new Error(issue + "；已拒绝覆盖旧存档");
          transaction.abort();
          return;
        }

        const updated: SaveRecord = {
          ...existing,
          updatedAt: new Date().toISOString(),
          status: state.ended ? "completed" : "in_progress",
          state
        };
        saveStore.put(updated);
      };
    };
  });
}

export async function removeSave(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const saveStore = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE_NAME);
    let failure: Error | null = null;

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      failure = failure ?? transaction.error ?? new Error("清除当前存档失败");
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("清除当前存档事务已中断"));
    };

    const pointerRequest = metaStore.get(ACTIVE_SAVE_KEY);
    pointerRequest.onerror = () => {
      failure = pointerRequest.error ?? new Error("读取活动存档指针失败");
      transaction.abort();
    };
    pointerRequest.onsuccess = () => {
      const saveId = (pointerRequest.result as MetaRecord | undefined)?.value;
      if (typeof saveId === "string") saveStore.delete(saveId);
      metaStore.put({ key: ACTIVE_SAVE_KEY, value: null } satisfies MetaRecord);
    };
  });
}
