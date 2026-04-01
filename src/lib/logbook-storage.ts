import type { RdiLogRecord } from './types';
import type { Logbook, LogbookTemplate, LogbookWithRecords } from './logbook-types';

const LOGBOOKS_KEY = 'rdi-log-plus-logbooks';
const LOGBOOK_RECORDS_PREFIX = 'rdi-log-plus-logbook-records-';
const ACTIVE_LOGBOOK_KEY = 'rdi-log-plus-active-logbook';

const LEGACY_LOGBOOKS_KEY = 'qlog-logbooks';
const LEGACY_LOGBOOK_RECORDS_PREFIX = 'qlog-logbook-records-';
const LEGACY_ACTIVE_LOGBOOK_KEY = 'qlog-active-logbook';

function genId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function migrateLegacyStorage() {
  try {
    const hasNewLogbooks = localStorage.getItem(LOGBOOKS_KEY);
    const hasLegacyLogbooks = localStorage.getItem(LEGACY_LOGBOOKS_KEY);

    if (!hasNewLogbooks && hasLegacyLogbooks) {
      localStorage.setItem(LOGBOOKS_KEY, hasLegacyLogbooks);
    }

    const activeNew = localStorage.getItem(ACTIVE_LOGBOOK_KEY);
    const activeLegacy = localStorage.getItem(LEGACY_ACTIVE_LOGBOOK_KEY);

    if (!activeNew && activeLegacy) {
      localStorage.setItem(ACTIVE_LOGBOOK_KEY, activeLegacy);
    }

    const rawBooks = localStorage.getItem(LOGBOOKS_KEY) ?? localStorage.getItem(LEGACY_LOGBOOKS_KEY);
    if (!rawBooks) return;

    const books = JSON.parse(rawBooks) as Logbook[];
    if (!Array.isArray(books)) return;

    for (const book of books) {
      const newKey = `${LOGBOOK_RECORDS_PREFIX}${book.id}`;
      const legacyKey = `${LEGACY_LOGBOOK_RECORDS_PREFIX}${book.id}`;

      const hasNewRecords = localStorage.getItem(newKey);
      const legacyRecords = localStorage.getItem(legacyKey);

      if (!hasNewRecords && legacyRecords) {
        localStorage.setItem(newKey, legacyRecords);
      }
    }
  } catch (error) {
    console.error('migrateLegacyStorage failed:', error);
  }
}

function getRecordStorageKey(logbookId: string): string {
  return `${LOGBOOK_RECORDS_PREFIX}${logbookId}`;
}

export function loadLogbooks(): Logbook[] {
  migrateLegacyStorage();

  try {
    const raw = localStorage.getItem(LOGBOOKS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('loadLogbooks failed:', error);
    return [];
  }
}

function saveLogbooks(books: Logbook[]) {
  localStorage.setItem(LOGBOOKS_KEY, JSON.stringify(books));
}

export function createLogbook(name: string, template: LogbookTemplate): Logbook {
  const books = loadLogbooks();
  const now = new Date().toISOString();

  const book: Logbook = {
    id: genId(),
    name,
    template,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const updatedBooks = [...books, book];
  saveLogbooks(updatedBooks);
  saveLogbookRecords(book.id, []);
  return book;
}

export function renameLogbook(id: string, name: string) {
  const books = loadLogbooks();
  const book = books.find((b) => b.id === id);

  if (!book) return;

  book.name = name;
  book.updatedAt = new Date().toISOString();
  saveLogbooks(books);
}

export function updateLogbookMeta(
  id: string,
  meta: Partial<Pick<Logbook, 'lastImportedAt' | 'lastImportedCount' | 'lastImportedFilename'>>
) {
  const books = loadLogbooks();
  const book = books.find((b) => b.id === id);

  if (!book) return;

  Object.assign(book, meta);
  book.updatedAt = new Date().toISOString();
  saveLogbooks(books);
}

export function archiveLogbook(id: string) {
  const books = loadLogbooks();
  const book = books.find((b) => b.id === id);

  if (!book) return;

  book.archived = true;
  book.updatedAt = new Date().toISOString();
  saveLogbooks(books);
}

export function unarchiveLogbook(id: string) {
  const books = loadLogbooks();
  const book = books.find((b) => b.id === id);

  if (!book) return;

  book.archived = false;
  book.updatedAt = new Date().toISOString();
  saveLogbooks(books);
}

export function deleteLogbook(id: string) {
  const books = loadLogbooks().filter((b) => b.id !== id);
  saveLogbooks(books);

  localStorage.removeItem(getRecordStorageKey(id));
  localStorage.removeItem(`${LEGACY_LOGBOOK_RECORDS_PREFIX}${id}`);

  if (getActiveLogbookId() === id) {
    clearActiveLogbook();
  }
}

export function loadLogbookRecords(logbookId: string): RdiLogRecord[] {
  migrateLegacyStorage();

  try {
    const raw = localStorage.getItem(getRecordStorageKey(logbookId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('loadLogbookRecords failed:', error);
    return [];
  }
}

export function saveLogbookRecords(logbookId: string, records: RdiLogRecord[]) {
  localStorage.setItem(getRecordStorageKey(logbookId), JSON.stringify(records));

  const books = loadLogbooks();
  const book = books.find((b) => b.id === logbookId);

  if (!book) return;

  book.updatedAt = new Date().toISOString();
  saveLogbooks(books);
}

export function getActiveLogbookId(): string | null {
  migrateLegacyStorage();
  return localStorage.getItem(ACTIVE_LOGBOOK_KEY);
}

export function setActiveLogbookId(id: string) {
  localStorage.setItem(ACTIVE_LOGBOOK_KEY, id);
}

export function clearActiveLogbook() {
  localStorage.removeItem(ACTIVE_LOGBOOK_KEY);
}

export function exportAllLogbooks(): LogbookWithRecords[] {
  return loadLogbooks().map((book) => ({
    ...book,
    records: loadLogbookRecords(book.id),
  }));
}

export function ensureDefaultLogbook(): Logbook {
  const books = loadLogbooks();

  if (books.length === 0) {
    const year = new Date().getFullYear();
    const book = createLogbook(`${year} General Log`, 'Yearly General Log');
    setActiveLogbookId(book.id);
    return book;
  }

  const activeId = getActiveLogbookId();
  if (!activeId || !books.find((b) => b.id === activeId)) {
    const first = books.find((b) => !b.archived) || books[0];
    setActiveLogbookId(first.id);
    return first;
  }

  return books.find((b) => b.id === activeId)!;
}