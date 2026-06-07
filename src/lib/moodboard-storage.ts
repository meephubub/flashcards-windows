export type MoodboardTileKind = "text" | "image" | "link";

export type MoodboardTileRecord = {
  id: string;
  kind: MoodboardTileKind;
  content: string;
  createdAt: number;
};

const STORAGE_KEY = "moodboard-tiles";

function readStore(): Record<string, MoodboardTileRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MoodboardTileRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, MoodboardTileRecord>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listMoodboardTiles(): MoodboardTileRecord[] {
  return Object.values(readStore()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getMoodboardTile(id: string): MoodboardTileRecord | null {
  return readStore()[id] ?? null;
}

export function saveMoodboardTile(tile: MoodboardTileRecord) {
  const store = readStore();
  store[tile.id] = tile;
  writeStore(store);
}

export function removeMoodboardTile(id: string) {
  const store = readStore();
  delete store[id];
  writeStore(store);
}

export function createMoodboardId() {
  return crypto.randomUUID();
}
