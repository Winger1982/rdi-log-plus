import { useEffect, useState } from 'react';
import type { CSSProperties, ChangeEvent, FormEvent } from 'react';
import type { Logbook } from './lib/logbook-types';
import type { RdiLogRecord } from './lib/types';
import {
  ensureDefaultLogbook,
  loadLogbooks,
  getActiveLogbookId,
  setActiveLogbookId,
  createLogbook,
  renameLogbook,
  loadLogbookRecords,
  saveLogbookRecords,
  updateLogbookMeta,
} from './lib/logbook-storage';
import { parseSimpleCSV } from './lib/csv';
import RDIConsoleMockup from './RDIConsoleMockup';

type ToolPreset = {
  label: string;
  frequency: string;
  mode: string;
};

type QsoForm = {
  callsign: string;
  date: string;
  time: string;
  frequency: string;
  mode: string;
  rst: string;
  path: string;
  remarks: string;
};

type QsoErrors = Partial<Record<keyof QsoForm, string>>;

const MIN_FREQUENCY_MHZ = 26.0;
const MAX_FREQUENCY_MHZ = 27.999;

const QUICK_PRESETS: ToolPreset[] = [
  { label: 'Ch 6 AM', frequency: '27.025', mode: 'AM' },
  { label: 'Ch 11 AM', frequency: '27.085', mode: 'AM' },
  { label: 'Ch 19 AM', frequency: '27.185', mode: 'AM' },
  { label: 'Ch 28 AM', frequency: '27.285', mode: 'AM' },
  { label: 'Ch 38 LSB', frequency: '27.385', mode: 'LSB' },
  { label: '27.555 USB', frequency: '27.555', mode: 'USB' },
];

const LEGACY_RECORD_CACHE_PREFIX = 'rdi.logplus.records.';

const getRecordCacheKey = (logbookId: string) => `${LEGACY_RECORD_CACHE_PREFIX}${logbookId}`;

function readCachedRecords(logbookId: string): RdiLogRecord[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(getRecordCacheKey(logbookId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearCachedRecords(logbookId: string) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getRecordCacheKey(logbookId));
  } catch {
    // ignore cache cleanup issues
  }
}

function loadResilientRecords(logbookId: string): RdiLogRecord[] {
  const savedRecords = loadLogbookRecords(logbookId);
  if (savedRecords.length > 0) {
    clearCachedRecords(logbookId);
    return savedRecords;
  }

  const cachedRecords = readCachedRecords(logbookId);
  if (cachedRecords.length > 0) {
    saveLogbookRecords(logbookId, cachedRecords);
    clearCachedRecords(logbookId);
    return cachedRecords;
  }

  return [];
}

function persistRecords(logbookId: string, nextRecords: RdiLogRecord[]) {
  saveLogbookRecords(logbookId, nextRecords);
  clearCachedRecords(logbookId);
}

function mergeImportedRecords(existing: RdiLogRecord[], imported: RdiLogRecord[]): RdiLogRecord[] {
  const seen = new Map<string, RdiLogRecord>();

  const makeKey = (record: RdiLogRecord) =>
    [
      (record.callsign || '').trim().toUpperCase(),
      (record.date || '').trim(),
      (record.time || '').trim(),
      (record.frequency || '').trim(),
      (record.mode || '').trim().toUpperCase(),
    ].join('|');

  for (const record of [...imported, ...existing]) {
    const key = makeKey(record);
    if (!seen.has(key)) {
      seen.set(key, record);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const aStamp = `${a.date || ''} ${a.time || ''}`;
    const bStamp = `${b.date || ''} ${b.time || ''}`;
    return bStamp.localeCompare(aStamp, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function getUtcDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getUtcTime(): string {
  const now = new Date();
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeDate(value: string | undefined): string {
  const trimmed = (value || '').trim();
  return isValidDateString(trimmed) ? trimmed : '';
}

function normalizeTime(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeMode(value: string | undefined): string {
  const upper = (value || '').trim().toUpperCase();
  if (!upper) return '';

  const aliases: Record<string, string> = {
    LBS: 'LSB',
    UBS: 'USB',
    LS: 'LSB',
    US: 'USB',
  };

  return aliases[upper] || upper;
}

function normalizeFrequency(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';

  const numeric = Number(trimmed.replace(/,/g, '.'));
  if (Number.isNaN(numeric)) return '';

  const mhz = numeric >= 26000 ? numeric / 1000 : numeric;
  if (mhz < MIN_FREQUENCY_MHZ || mhz > MAX_FREQUENCY_MHZ) return '';

  return mhz.toFixed(3);
}

function sanitizeRecord(record: RdiLogRecord): RdiLogRecord | null {
  const frequency = normalizeFrequency(record.frequency);
  if (!frequency) return null;

  return {
    ...record,
    callsign: (record.callsign || '').trim().toUpperCase(),
    date: normalizeDate(record.date),
    time: normalizeTime(record.time),
    frequency,
    mode: normalizeMode(record.mode),
    rst: (record.rst || '').trim(),
    path: (record.path || '').trim(),
    remarks: (record.remarks || '').trim(),
  };
}

function createEmptyQsoForm(): QsoForm {
  return {
    callsign: '',
    date: getUtcDate(),
    time: getUtcTime(),
    frequency: '',
    mode: '',
    rst: '',
    path: '',
    remarks: '',
  };
}

function inputStyle(hasError?: string): CSSProperties {
  return {
    width: '100%',
    background: '#111827',
    color: '#e5e7eb',
    border: `1px solid ${hasError ? '#dc2626' : '#334155'}`,
    borderRadius: '8px',
    padding: '10px 12px',
    boxSizing: 'border-box',
  };
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  color: '#d1d5db',
  fontWeight: 600,
};

const errorStyle: CSSProperties = {
  marginTop: '6px',
  color: '#fca5a5',
  fontSize: '0.88rem',
};

const modalOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  zIndex: 1000,
};

const modalBoxStyle: CSSProperties = {
  width: '100%',
  maxWidth: '720px',
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
};

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px',
};

const secondaryButtonStyle: CSSProperties = {
  background: '#1f2937',
  color: '#e5e7eb',
  border: '1px solid #374151',
  borderRadius: '8px',
  padding: '10px 14px',
  cursor: 'pointer',
  fontWeight: 600,
};

const primaryButtonStyle: CSSProperties = {
  background: '#1d4ed8',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 14px',
  cursor: 'pointer',
  fontWeight: 700,
};

const noticeStyle: CSSProperties = {
  marginTop: '16px',
  background: 'rgba(22, 163, 74, 0.14)',
  border: '1px solid rgba(34, 197, 94, 0.5)',
  borderRadius: '10px',
  padding: '10px 12px',
  color: '#bbf7d0',
  fontSize: '0.92rem',
};

export default function App() {
  const [logbooks, setLogbooks] = useState<Logbook[]>([]);
  const [activeLogbook, setActiveLogbook] = useState<Logbook | null>(null);
  const [records, setRecords] = useState<RdiLogRecord[]>([]);

  const [showAddQso, setShowAddQso] = useState(false);
  const [qsoForm, setQsoForm] = useState<QsoForm>(createEmptyQsoForm());
  const [qsoErrors, setQsoErrors] = useState<QsoErrors>({});
  const [importNotice, setImportNotice] = useState('');

  const refreshLogbooks = () => {
    const ensured = ensureDefaultLogbook();
    const books = loadLogbooks();
    const activeId = getActiveLogbookId();
    const active = books.find((book) => book.id === activeId) || ensured;

    setLogbooks(books);
    setActiveLogbook(active);
    setRecords(loadResilientRecords(active.id));
  };

  useEffect(() => {
    refreshLogbooks();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showAddQso) {
        closeAddQsoModal();
      }
    };

    if (showAddQso) {
      window.addEventListener('keydown', handleEscape);
    }

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showAddQso]);

  const handleCreateLogbook = () => {
    const name = window.prompt('Enter a new logbook name:');
    if (!name?.trim()) return;

    const newBook = createLogbook(name.trim(), 'Custom Log');
    setActiveLogbookId(newBook.id);
    refreshLogbooks();
  };

  const handleRenameLogbook = () => {
    if (!activeLogbook) return;

    const newName = window.prompt('Rename active logbook:', activeLogbook.name);
    if (!newName?.trim()) return;

    renameLogbook(activeLogbook.id, newName.trim());
    refreshLogbooks();
  };

  const handleDeleteLogbook = () => {
    if (!activeLogbook) return;
    alert('Delete logbook can be added next. Current logbook was left untouched.');
  };

  const handleSwitchLogbook = (id: string) => {
    setActiveLogbookId(id);
    refreshLogbooks();
  };

  const handleExportCsv = () => {
    if (!records.length) {
      alert('No QSOs to export.');
      return;
    }

    const headers = [
      'callsign',
      'date',
      'time',
      'frequency',
      'mode',
      'rst',
      'path',
      'remarks',
    ] as const;

    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '');
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const csvRows = [
      headers.join(','),
      ...records.map((record) =>
        headers.map((header) => escapeCsv(record[header] ?? '')).join(',')
      ),
    ];

    const blob = new Blob([csvRows.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rdi-log-plus-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    const input = document.getElementById('hidden-csv-import') as HTMLInputElement | null;
    input?.click();
  };

  const handleImportCSV = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeLogbook) return;

    const text = await file.text();
    const parsed = parseSimpleCSV(text);

    let skippedCount = 0;
    const cleaned = parsed.reduce<RdiLogRecord[]>((acc, record) => {
      const sanitized = sanitizeRecord(record);
      if (!sanitized) {
        skippedCount += 1;
        return acc;
      }
      acc.push(sanitized);
      return acc;
    }, []);

    const merged = mergeImportedRecords(records, cleaned);

    persistRecords(activeLogbook.id, merged);
    updateLogbookMeta(activeLogbook.id, {
      lastImportedAt: new Date().toISOString(),
      lastImportedCount: cleaned.length,
      lastImportedFilename: file.name,
    });

    setRecords(merged);

    setImportNotice(
      skippedCount > 0
        ? `${cleaned.length} records imported. ${skippedCount} skipped because frequency was outside 26.000–27.999 MHz.`
        : `${cleaned.length} records imported successfully.`
    );

    event.target.value = '';
  };

  const openAddQsoModal = () => {
    setQsoErrors({});
    setQsoForm(createEmptyQsoForm());
    setShowAddQso(true);
  };

  const openPresetQsoModal = (preset: ToolPreset) => {
    setQsoErrors({});
    setQsoForm({
      ...createEmptyQsoForm(),
      frequency: preset.frequency,
      mode: preset.mode,
    });
    setShowAddQso(true);
  };

  const closeAddQsoModal = () => {
    setShowAddQso(false);
    setQsoErrors({});
    setQsoForm(createEmptyQsoForm());
  };

  const validateQsoForm = (): QsoErrors => {
    const errors: QsoErrors = {};

    if (!qsoForm.callsign.trim()) {
      errors.callsign = 'Callsign is required.';
    }

    if (!qsoForm.date.trim()) {
      errors.date = 'UTC date is required.';
    }

    if (!qsoForm.time.trim()) {
      errors.time = 'UTC time is required.';
    }

    if (!qsoForm.frequency.trim()) {
      errors.frequency = 'Frequency is required.';
    } else if (!normalizeFrequency(qsoForm.frequency)) {
      errors.frequency = 'Frequency must be between 26.000 and 27.999 MHz.';
    }

    if (!qsoForm.mode.trim()) {
      errors.mode = 'Mode is required.';
    }

    return errors;
  };

  const handleSaveQso = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeLogbook) return;

    const errors = validateQsoForm();
    setQsoErrors(errors);

    if (Object.keys(errors).length > 0) return;

    const newRecord: RdiLogRecord = {
      id: crypto.randomUUID(),
      callsign: qsoForm.callsign.trim().toUpperCase(),
      date: normalizeDate(qsoForm.date),
      time: normalizeTime(qsoForm.time),
      frequency: normalizeFrequency(qsoForm.frequency),
      mode: normalizeMode(qsoForm.mode),
      rst: qsoForm.rst.trim(),
      path: qsoForm.path.trim(),
      remarks: qsoForm.remarks.trim(),
    };

    const updatedRecords = [newRecord, ...records];
    persistRecords(activeLogbook.id, updatedRecords);
    setRecords(updatedRecords);
    closeAddQsoModal();
  };

  const handleUpdateQso = (recordId: string, updates: Partial<RdiLogRecord>) => {
    if (!activeLogbook) return;

    const target = records.find((record) => record.id === recordId);
    if (!target) return;

    const mergedRecord: RdiLogRecord = {
      ...target,
      ...updates,
      id: target.id,
    };

    const sanitized = sanitizeRecord(mergedRecord);

    if (!sanitized) {
      alert('Frequency must stay between 26.000 and 27.999 MHz.');
      return;
    }

    if (!sanitized.callsign.trim()) {
      alert('Callsign is required.');
      return;
    }

    if (!sanitized.date.trim()) {
      alert('UTC date is required.');
      return;
    }

    if (!sanitized.time.trim()) {
      alert('UTC time is required.');
      return;
    }

    if (!sanitized.mode.trim()) {
      alert('Mode is required.');
      return;
    }

    const updatedRecords = records.map((record) =>
      record.id === recordId ? sanitized : record
    );

    persistRecords(activeLogbook.id, updatedRecords);
    setRecords(updatedRecords);
  };

  const handleDeleteQso = (recordId: string) => {
    if (!activeLogbook) return;

    const target = records.find((record) => record.id === recordId);
    if (!target) return;

    const confirmed = window.confirm(
      `Delete contact ${target.callsign || 'unknown'} on ${target.date || 'unknown date'} at ${target.time || 'unknown time'}?`
    );

    if (!confirmed) return;

    const updatedRecords = records.filter((record) => record.id !== recordId);
    persistRecords(activeLogbook.id, updatedRecords);
    setRecords(updatedRecords);
  };

  return (
    <>
      <RDIConsoleMockup
        activeLogbook={activeLogbook}
        logbooks={logbooks}
        records={records}
        quickPresets={QUICK_PRESETS}
        onCreateLogbook={handleCreateLogbook}
        onRenameLogbook={handleRenameLogbook}
        onDeleteLogbook={handleDeleteLogbook}
        onSwitchLogbook={handleSwitchLogbook}
        onOpenAddQso={openAddQsoModal}
        onOpenPresetQso={openPresetQsoModal}
        onExportCsv={handleExportCsv}
        onImportCSVClick={handleImportClick}
        onUpdateQso={handleUpdateQso}
        onDeleteQso={handleDeleteQso}
      />

      {showAddQso && (
        <div style={modalOverlayStyle} onClick={closeAddQsoModal}>
          <div style={modalBoxStyle} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#e5e7eb' }}>Add QSO</h2>
                <p style={{ marginTop: '6px', color: '#94a3b8' }}>
                  Log a contact into the active logbook
                </p>
              </div>
              <button type="button" style={secondaryButtonStyle} onClick={closeAddQsoModal}>
                Close
              </button>
            </div>

            <form onSubmit={handleSaveQso} style={{ marginTop: '20px' }}>
              <div style={formGridStyle}>
                <div>
                  <label style={labelStyle}>Callsign</label>
                  <input
                    style={inputStyle(qsoErrors.callsign)}
                    value={qsoForm.callsign}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, callsign: e.target.value }))}
                    placeholder="9RDI123"
                  />
                  {qsoErrors.callsign && <div style={errorStyle}>{qsoErrors.callsign}</div>}
                </div>

                <div>
                  <label style={labelStyle}>UTC Date</label>
                  <input
                    type="date"
                    style={inputStyle(qsoErrors.date)}
                    value={qsoForm.date}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, date: e.target.value }))}
                  />
                  {qsoErrors.date && <div style={errorStyle}>{qsoErrors.date}</div>}
                </div>

                <div>
                  <label style={labelStyle}>UTC Time</label>
                  <input
                    type="time"
                    style={inputStyle(qsoErrors.time)}
                    value={qsoForm.time}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, time: e.target.value }))}
                  />
                  {qsoErrors.time && <div style={errorStyle}>{qsoErrors.time}</div>}
                </div>

                <div>
                  <label style={labelStyle}>Frequency</label>
                  <input
                    style={inputStyle(qsoErrors.frequency)}
                    value={qsoForm.frequency}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, frequency: e.target.value }))}
                    placeholder="27.385"
                  />
                  {qsoErrors.frequency && <div style={errorStyle}>{qsoErrors.frequency}</div>}
                </div>

                <div>
                  <label style={labelStyle}>Mode</label>
                  <input
                    style={inputStyle(qsoErrors.mode)}
                    value={qsoForm.mode}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, mode: e.target.value }))}
                    placeholder="LSB"
                  />
                  {qsoErrors.mode && <div style={errorStyle}>{qsoErrors.mode}</div>}
                </div>

                <div>
                  <label style={labelStyle}>RST</label>
                  <input
                    style={inputStyle()}
                    value={qsoForm.rst}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, rst: e.target.value }))}
                    placeholder="55"
                  />
                </div>

                <div>
                  <label style={labelStyle}>Path</label>
                  <input
                    style={inputStyle()}
                    value={qsoForm.path}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, path: e.target.value }))}
                    placeholder="EU Skip"
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Remarks</label>
                  <textarea
                    style={{ ...inputStyle(), minHeight: '90px', resize: 'vertical' }}
                    value={qsoForm.remarks}
                    onChange={(e) => setQsoForm((prev) => ({ ...prev, remarks: e.target.value }))}
                    placeholder="Signal report, operator notes, location..."
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'flex-end',
                  marginTop: '20px',
                }}
              >
                <button type="button" style={secondaryButtonStyle} onClick={closeAddQsoModal}>
                  Cancel
                </button>
                <button type="submit" style={primaryButtonStyle}>
                  Save QSO
                </button>
              </div>

              {importNotice && <div style={noticeStyle}>{importNotice}</div>}
            </form>
          </div>
        </div>
      )}

      <input
        id="hidden-csv-import"
        type="file"
        accept=".csv"
        onChange={handleImportCSV}
        style={{ display: 'none' }}
      />
    </>
  );
}