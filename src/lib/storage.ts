// Native: installs a synchronous `localStorage` global backed by SQLite (SDK 58 expo-sqlite).
// Web uses the browser's own localStorage — see storage.web.ts.
import 'expo-sqlite/localStorage/install';

export const STORAGE_ENGINE = 'SQLite (expo-sqlite localStorage)';
