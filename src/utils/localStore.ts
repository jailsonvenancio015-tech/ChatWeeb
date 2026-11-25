import type {
  AccountSettings,
  ChatMessage,
  FollowRelation,
  GroupConfig,
  HighlightCollection,
  SocialPost,
  StickerItem,
  StoryItem,
  UnreadRoomInfo,
  UserProfile,
} from '../types/app';
import { MAX_ACCOUNTS_PER_DEVICE } from './meshProtocol';

export interface LocalAppSnapshot {
  currentUser: UserProfile;
  settings: AccountSettings;
  activeRoomCode: string | null;
  groups: Record<string, GroupConfig>;
  messagesByRoom: Record<string, ChatMessage[]>;
  profiles: Record<string, UserProfile>;
  posts: SocialPost[];
  stories: StoryItem[];
  highlights: HighlightCollection[];
  followRelations: FollowRelation[];
  stickers: StickerItem[];
  likedPostIds: string[];
  unreadByRoom: Record<string, UnreadRoomInfo>;
  updatedAt: number;
}

export interface DeviceVault {
  activeAccountId: string;
  accounts: Record<string, LocalAppSnapshot>;
  updatedAt: number;
}

const DB_NAME = 'pulso_device_db';
const DB_VERSION = 2;
const STORE_NAME = 'app_state';
const STATE_KEY = 'primary_snapshot';
const VAULT_KEY = 'device_vault_v2';
const LS_FALLBACK_KEY = 'pulso_device_snapshot_v1';
const LS_VAULT_KEY = 'pulso_device_vault_v2';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut<T>(key: string, val: T): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(val, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback handled by localStorage mirror
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function loadDeviceVault(): Promise<DeviceVault | null> {
  const fromIdb = await idbGet<DeviceVault>(VAULT_KEY);
  if (fromIdb && fromIdb.accounts && Object.keys(fromIdb.accounts).length > 0) {
    return fromIdb;
  }

  try {
    const rawVault = localStorage.getItem(LS_VAULT_KEY);
    if (rawVault) {
      const parsed = JSON.parse(rawVault) as DeviceVault;
      if (parsed && parsed.accounts && Object.keys(parsed.accounts).length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  // Legacy migration from single-account snapshot
  const legacy = await loadLocalSnapshot();
  if (legacy) {
    const migrated: DeviceVault = {
      activeAccountId: legacy.currentUser.id,
      accounts: { [legacy.currentUser.id]: legacy },
      updatedAt: Date.now(),
    };
    return migrated;
  }

  return null;
}

export async function saveDeviceVault(vault: DeviceVault): Promise<void> {
  const keys = Object.keys(vault.accounts).slice(0, MAX_ACCOUNTS_PER_DEVICE);
  const trimmedAccounts: Record<string, LocalAppSnapshot> = {};
  for (const k of keys) {
    trimmedAccounts[k] = vault.accounts[k];
  }
  const payload: DeviceVault = {
    activeAccountId: trimmedAccounts[vault.activeAccountId]
      ? vault.activeAccountId
      : keys[0],
    accounts: trimmedAccounts,
    updatedAt: Date.now(),
  };

  await idbPut(VAULT_KEY, payload);

  try {
    localStorage.setItem(LS_VAULT_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota limits when media is large; IndexedDB has full data
  }
}

export async function loadLocalSnapshot(): Promise<LocalAppSnapshot | null> {
  const fromIdb = await idbGet<LocalAppSnapshot>(STATE_KEY);
  if (fromIdb) return fromIdb;
  return loadFromLocalStorage();
}

export async function saveLocalSnapshot(snapshot: LocalAppSnapshot): Promise<void> {
  const payload: LocalAppSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
  };
  await idbPut(STATE_KEY, payload);
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function loadFromLocalStorage(): LocalAppSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalAppSnapshot;
  } catch {
    return null;
  }
}

export async function clearLocalSnapshot(): Promise<void> {
  try {
    localStorage.removeItem(LS_FALLBACK_KEY);
    localStorage.removeItem(LS_VAULT_KEY);
  } catch {
    // ignore
  }
  await idbDelete(STATE_KEY);
  await idbDelete(VAULT_KEY);
}
