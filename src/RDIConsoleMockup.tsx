import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import type { Logbook } from './lib/logbook-types';
import type { RdiLogRecord } from './lib/types';
import RDILiveMap from './components/RDILiveMap';

type WeatherStatus = 'CLEAR' | 'WATCH' | 'WARNING';
type StationMode = 'HOME' | 'PORTABLE' | 'MOBILE';
type DistanceUnit = 'KM' | 'MI';
type DataMode = 'OFFLINE' | 'ONLINE';
type ClusterLoginState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

type StationProfile = {
  operatorName: string;
  callsign: string;
  gridSquare: string;
  stationMode: StationMode;
  distanceUnit: DistanceUnit;
  latitude: string;
  longitude: string;
};

type StationWeather = {
  temperature: string;
  wind: string;
  rainChance: string;
  lightningRisk: string;
  summaryMessage: string;
  weatherCode: number | null;
  weatherLabel: string;
  lastUpdated: string | null;
  timezone: string | null;
  error: string | null;
};

type PropagationData = {
  dayCondition: string;
  nightCondition: string;
  solarFlux: string;
  sunspots: string;
  aIndex: string;
  kIndex: string;
  aurora: string;
  updatedAt: string | null;
  sourceUrl: string;
  error: string | null;
};

type ToolPreset = {
  label: string;
  frequency: string;
  mode: string;
};

type ClusterSettings = {
  clusterName: string;
  username: string;
  password: string;
  rememberMe: boolean;
};

type ClusterStatusPayload = {
  ok?: boolean;
  bridge?: string;
  loggedIn?: boolean;
  lastLoginAt?: string | null;
  lastFetchAt?: string | null;
  lastError?: string | null;
  loginUrl?: string;
  spotsUrl?: string;
};

type OpenMeteoResponse = {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    weather_code?: number;
    time?: string;
  };
  daily?: {
    precipitation_probability_max?: number[];
    time?: string[];
  };
};

type PropagationApiResponse = {
  ok?: boolean;
  dayCondition?: string;
  nightCondition?: string;
  solarFlux?: string;
  sunspots?: string;
  aIndex?: string;
  kIndex?: string;
  aurora?: string;
  updatedAt?: string | null;
  sourceUrl?: string;
  error?: string;
};

type EditContactForm = {
  callsign: string;
  date: string;
  time: string;
  frequency: string;
  mode: string;
  rst: string;
  path: string;
  remarks: string;
};

type EditContactErrors = Partial<Record<keyof EditContactForm, string>>;

type RDIConsoleMockupProps = {
  activeLogbook: Logbook | null;
  logbooks: Logbook[];
  records: RdiLogRecord[];
  quickPresets: ToolPreset[];
  onCreateLogbook: () => void;
  onRenameLogbook: () => void;
  onDeleteLogbook: () => void;
  onSwitchLogbook: (id: string) => void;
  onOpenAddQso: () => void;
  onOpenPresetQso: (preset: ToolPreset) => void;
  onExportCsv: () => void;
  onImportCSVClick: () => void;
  onUpdateQso: (recordId: string, updates: Partial<RdiLogRecord>) => void;
  onDeleteQso: (recordId: string) => void;
};

type SortField = 'callsign' | 'date' | 'time' | 'frequency' | 'mode';

const BRIDGE_BASE_URL = 'http://localhost:8787';
const PROFILE_STORAGE_KEY = 'rdi.console.profile';
const CLUSTER_STORAGE_KEY = 'rdi.console.cluster';
const COORDINATE_HELP_URL = 'https://gps-coordinates.org/';
const RDI_LOGO_SRC = '/rdi-logo.png';
const PROPAGATION_SOURCE_FALLBACK = 'https://www.dxproof.com/propagation_46860.asp';
const QSO_PAGE_SIZE = 10;

const MIN_FREQUENCY_MHZ = 26.0;
const MAX_FREQUENCY_MHZ = 27.999;

const DEFAULT_PROFILE: StationProfile = {
  operatorName: 'Fred',
  callsign: '9RDI01',
  gridSquare: 'FN25',
  stationMode: 'HOME',
  distanceUnit: 'KM',
  latitude: '',
  longitude: '',
};

const DEFAULT_CLUSTER_SETTINGS: ClusterSettings = {
  clusterName: 'ClusterDX',
  username: '',
  password: '',
  rememberMe: true,
};

const DEFAULT_WEATHER: StationWeather = {
  temperature: '—',
  wind: '—',
  rainChance: '—',
  lightningRisk: 'LOW',
  summaryMessage: 'Enter latitude and longitude in Setup to enable live weather.',
  weatherCode: null,
  weatherLabel: 'Unknown',
  lastUpdated: null,
  timezone: null,
  error: null,
};

const DEFAULT_PROPAGATION: PropagationData = {
  dayCondition: 'Unknown',
  nightCondition: 'Unknown',
  solarFlux: '—',
  sunspots: '—',
  aIndex: '—',
  kIndex: '—',
  aurora: '—',
  updatedAt: null,
  sourceUrl: PROPAGATION_SOURCE_FALLBACK,
  error: null,
};

const DESIRED_PRESETS: ToolPreset[] = [
  { label: 'Intl Calling Frequency', frequency: '27.555', mode: 'USB' },
  { label: 'RDI 11m Net', frequency: '27.405', mode: 'USB' },
  { label: 'Local Calling Frequency Americas', frequency: '27.385', mode: 'LSB' },
];

function windDirectionToCompass(degrees: number | undefined): string {
  if (degrees === undefined || Number.isNaN(degrees)) return '';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

function weatherCodeToLabel(code: number | null): string {
  if (code === null) return 'Unknown';
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61 || code === 63 || code === 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71 || code === 73 || code === 75 || code === 77) return 'Snow';
  if (code === 80 || code === 81 || code === 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm / hail';
  return 'Unsettled';
}

function deriveWeatherStatus(code: number | null, rainChance: number): WeatherStatus {
  if (code === 95 || code === 96 || code === 99) return 'WARNING';
  if (rainChance >= 70) return 'WARNING';
  if (rainChance >= 40) return 'WATCH';
  return 'CLEAR';
}

function deriveLightningRisk(code: number | null): string {
  if (code === 95 || code === 96 || code === 99) return 'HIGH';
  return 'LOW';
}

function normalizeCallsign(value: string) {
  return value.trim().toUpperCase();
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

function createEditContactForm(record: RdiLogRecord): EditContactForm {
  return {
    callsign: record.callsign || '',
    date: record.date || '',
    time: record.time || '',
    frequency: record.frequency || '',
    mode: record.mode || '',
    rst: record.rst || '',
    path: record.path || '',
    remarks: record.remarks || '',
  };
}

function propagationTone(value: string): { background: string; border: string; color: string } {
  const upper = String(value || '').toUpperCase();

  if (upper.includes('EXCELLENT') || upper.includes('VERY GOOD') || upper.includes('GOOD')) {
    return {
      background: 'rgba(22, 163, 74, 0.22)',
      border: 'rgba(74, 222, 128, 0.40)',
      color: '#ecfdf5',
    };
  }

  if (upper.includes('FAIR') || upper.includes('MODERATE')) {
    return {
      background: 'rgba(217, 119, 6, 0.24)',
      border: 'rgba(251, 191, 36, 0.40)',
      color: '#fff7ed',
    };
  }

  if (upper.includes('POOR') || upper.includes('CLOSED') || upper.includes('STORM')) {
    return {
      background: 'rgba(185, 28, 28, 0.24)',
      border: 'rgba(248, 113, 113, 0.40)',
      color: '#fff1f2',
    };
  }

  return {
    background: 'rgba(255,255,255,0.06)',
    border: 'rgba(171, 205, 255, 0.22)',
    color: '#eef5ff',
  };
}

export default function RDIConsoleMockup({
  activeLogbook,
  logbooks,
  records,
  quickPresets,
  onCreateLogbook,
  onRenameLogbook,
  onDeleteLogbook,
  onSwitchLogbook,
  onOpenAddQso,
  onOpenPresetQso,
  onExportCsv,
  onImportCSVClick,
  onUpdateQso,
  onDeleteQso,
}: RDIConsoleMockupProps) {
  const [utcNow, setUtcNow] = useState(new Date());
  const [showSetup, setShowSetup] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showWeatherWarning, setShowWeatherWarning] = useState(false);
  const [showFindContact, setShowFindContact] = useState(false);
  const [showEditContact, setShowEditContact] = useState(false);
  const [showEditContactDetails, setShowEditContactDetails] = useState(false);
  const [editContactSelectedId, setEditContactSelectedId] = useState<string | null>(null);
  const [editContactIsEditing, setEditContactIsEditing] = useState(false);
  const [editContactDraft, setEditContactDraft] = useState<EditContactForm | null>(null);
  const [editContactErrors, setEditContactErrors] = useState<EditContactErrors>({});
  const [findContactAcknowledgedId, setFindContactAcknowledgedId] = useState<string | null>(null);
  const [findContactQuery, setFindContactQuery] = useState('');
  const [editContactQuery, setEditContactQuery] = useState('');
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentQsoPage, setCurrentQsoPage] = useState(1);

  const [profile, setProfile] = useState<StationProfile>(() => {
    if (typeof window === 'undefined') return DEFAULT_PROFILE;
    try {
      const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      return saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  const [profileDraft, setProfileDraft] = useState<StationProfile>(profile);

  const [clusterSettings, setClusterSettings] = useState<ClusterSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_CLUSTER_SETTINGS;
    try {
      const saved = window.localStorage.getItem(CLUSTER_STORAGE_KEY);
      return saved ? { ...DEFAULT_CLUSTER_SETTINGS, ...JSON.parse(saved) } : DEFAULT_CLUSTER_SETTINGS;
    } catch {
      return DEFAULT_CLUSTER_SETTINGS;
    }
  });

  const [clusterDraft, setClusterDraft] = useState<ClusterSettings>(clusterSettings);

  const [clusterState, setClusterState] = useState<ClusterLoginState>('DISCONNECTED');
  const [clusterMessage, setClusterMessage] = useState('ClusterDX is not connected.');
  const [clusterLastLoginAt, setClusterLastLoginAt] = useState<string | null>(null);
  const [clusterLastFetchAt, setClusterLastFetchAt] = useState<string | null>(null);
  const [clusterLastError, setClusterLastError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveMessageTone, setSaveMessageTone] = useState<'success' | 'error'>('success');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [weather, setWeather] = useState<StationWeather>(DEFAULT_WEATHER);
  const [propagation, setPropagation] = useState<PropagationData>(DEFAULT_PROPAGATION);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUtcNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setProfileDraft(profile);
  }, [profile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }, [profile]);

  useEffect(() => {
    setClusterDraft(clusterSettings);
  }, [clusterSettings]);

  useEffect(() => {
    if (!saveMessage) return;
    const timer = window.setTimeout(() => setSaveMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  const utcTimeOnly = useMemo(() => utcNow.toUTCString().split(' ')[4], [utcNow]);

  const localTimeOnly = useMemo(() => {
    if (weather.timezone) {
      return new Intl.DateTimeFormat([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: weather.timezone,
      }).format(utcNow);
    }

    return utcNow.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [utcNow, weather.timezone]);

  const localDateLabel = useMemo(() => {
    if (weather.timezone) {
      return new Intl.DateTimeFormat([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: weather.timezone,
      }).format(utcNow);
    }

    return utcNow.toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [utcNow, weather.timezone]);

  const weatherStatus = useMemo<WeatherStatus>(() => {
    const rainValue = Number.parseInt(weather.rainChance.replace('%', ''), 10);
    return deriveWeatherStatus(weather.weatherCode, Number.isNaN(rainValue) ? 0 : rainValue);
  }, [weather.rainChance, weather.weatherCode]);

  const dataMode: DataMode = clusterState === 'CONNECTED' ? 'ONLINE' : 'OFFLINE';

  const clusterBadge = useMemo(() => {
    switch (clusterState) {
      case 'CONNECTED':
        return {
          label: 'Connected',
          background: 'rgba(82, 151, 117, 0.28)',
          border: 'rgba(151, 212, 177, 0.42)',
          color: '#e6fff1',
        };
      case 'CONNECTING':
        return {
          label: 'Connecting',
          background: 'rgba(88, 122, 170, 0.28)',
          border: 'rgba(152, 184, 229, 0.38)',
          color: '#e7f1ff',
        };
      case 'ERROR':
        return {
          label: 'Error',
          background: 'rgba(160, 92, 92, 0.26)',
          border: 'rgba(217, 149, 149, 0.4)',
          color: '#fff0f0',
        };
      case 'DISCONNECTED':
      default:
        return {
          label: 'Disconnected',
          background: 'rgba(105, 124, 147, 0.24)',
          border: 'rgba(170, 188, 208, 0.36)',
          color: '#eef4fb',
        };
    }
  }, [clusterState]);

  const warningBadge =
    weatherStatus === 'WARNING'
      ? {
          label: 'Warning',
          background: 'rgba(185, 28, 28, 0.30)',
          border: 'rgba(248, 113, 113, 0.55)',
          color: '#fff1f2',
        }
      : weatherStatus === 'WATCH'
        ? {
            label: 'Watch',
            background: 'rgba(217, 119, 6, 0.28)',
            border: 'rgba(251, 191, 36, 0.44)',
            color: '#fff7ed',
          }
        : {
            label: 'No Warning',
            background: 'rgba(22, 163, 74, 0.26)',
            border: 'rgba(74, 222, 128, 0.42)',
            color: '#ecfdf5',
          };

  const shellStyle: CSSProperties = {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at top, rgba(78, 145, 240, 0.22), rgba(12, 24, 44, 0.96) 54%), linear-gradient(180deg, #0a1424 0%, #07101c 100%)',
    color: '#eef5ff',
    padding: '14px',
    fontFamily: 'Inter, Arial, sans-serif',
  };

  const panelStyle: CSSProperties = {
    background: 'rgba(20, 38, 63, 0.9)',
    border: '1px solid rgba(125, 180, 255, 0.24)',
    borderRadius: '16px',
    boxShadow: '0 10px 28px rgba(8, 18, 34, 0.28)',
    padding: '14px',
  };

  const labelStyle: CSSProperties = {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#c8daf0',
    marginBottom: '6px',
  };

  const compactButtonStyle: CSSProperties = {
    background: 'rgba(92, 143, 223, 0.26)',
    color: '#f5f9ff',
    border: '1px solid rgba(171, 205, 255, 0.34)',
    borderRadius: '10px',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 700,
    minWidth: '94px',
    textAlign: 'center',
  };

  const primaryButtonStyle: CSSProperties = {
    ...compactButtonStyle,
    background: 'rgba(72, 132, 235, 0.38)',
  };

  const saveSetupButtonStyle: CSSProperties = useMemo(
    () => ({
      ...primaryButtonStyle,
      background:
        saveMessage && saveMessageTone === 'success'
          ? 'rgba(22, 163, 74, 0.34)'
          : primaryButtonStyle.background,
      border:
        saveMessage && saveMessageTone === 'success'
          ? '1px solid rgba(74, 222, 128, 0.48)'
          : primaryButtonStyle.border,
      color:
        saveMessage && saveMessageTone === 'success'
          ? '#ecfdf5'
          : primaryButtonStyle.color,
      minWidth: '112px',
    }),
    [saveMessage, saveMessageTone],
  );

  const inputStyle: CSSProperties = {
    width: '100%',
    background: '#233c61',
    color: '#f4f8ff',
    border: '1px solid #6d8db8',
    borderRadius: '10px',
    padding: '10px 12px',
    boxSizing: 'border-box',
    fontSize: '0.95rem',
  };

  const selectStyle: CSSProperties = {
    width: '100%',
    background: '#29446c',
    color: '#f7fbff',
    border: '1px solid #7a98c1',
    borderRadius: '10px',
    padding: '10px 12px',
    boxSizing: 'border-box',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
  };

  const statCardStyle: CSSProperties = {
    padding: '12px',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(173, 202, 239, 0.16)',
  };

  const formatDateTime = (value: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
  };

  const displayPresets = useMemo(() => {
    const preferredMap = new Map(
      DESIRED_PRESETS.map((preset) => [`${preset.frequency}-${preset.mode}`.toUpperCase(), preset]),
    );

    const matched = quickPresets.filter((preset) =>
      preferredMap.has(`${preset.frequency}-${preset.mode}`.toUpperCase()),
    );

    if (matched.length === 3) {
      return DESIRED_PRESETS.map(
        (desired) =>
          matched.find(
            (preset) => preset.frequency === desired.frequency && preset.mode === desired.mode,
          ) || desired,
      );
    }

    return DESIRED_PRESETS;
  }, [quickPresets]);

  const sortedRecords = useMemo(() => {
    const copy = [...records];

    copy.sort((a, b) => {
      let aValue = '';
      let bValue = '';

      switch (sortField) {
        case 'callsign':
          aValue = a.callsign || '';
          bValue = b.callsign || '';
          break;
        case 'date':
          aValue = `${a.date || ''} ${a.time || ''}`;
          bValue = `${b.date || ''} ${b.time || ''}`;
          break;
        case 'time':
          aValue = a.time || '';
          bValue = b.time || '';
          break;
        case 'frequency':
          aValue = a.frequency || '';
          bValue = b.frequency || '';
          break;
        case 'mode':
          aValue = a.mode || '';
          bValue = b.mode || '';
          break;
      }

      const comparison = aValue.localeCompare(bValue, undefined, {
        numeric: true,
        sensitivity: 'base',
      });

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return copy;
  }, [records, sortDirection, sortField]);

  const totalQsoPages = Math.max(1, Math.ceil(sortedRecords.length / QSO_PAGE_SIZE));

  useEffect(() => {
    setCurrentQsoPage(1);
  }, [sortField, sortDirection]);

  useEffect(() => {
    setCurrentQsoPage((prev) => Math.min(prev, totalQsoPages));
  }, [totalQsoPages]);

  const pagedRecords = useMemo(() => {
    const startIndex = (currentQsoPage - 1) * QSO_PAGE_SIZE;
    return sortedRecords.slice(startIndex, startIndex + QSO_PAGE_SIZE);
  }, [currentQsoPage, sortedRecords]);

  const latestRecord = useMemo(() => records[0] || null, [records]);

  const previousContactMatch = useMemo(() => {
    if (!latestRecord) return null;
    const latestCallsign = normalizeCallsign(latestRecord.callsign || '');
    if (!latestCallsign) return null;

    return (
      records.find((record) => {
        if (record.id === latestRecord.id) return false;
        return normalizeCallsign(record.callsign || '') === latestCallsign;
      }) || null
    );
  }, [latestRecord, records]);

  const findContactButtonIsRed =
    Boolean(previousContactMatch) && latestRecord?.id !== findContactAcknowledgedId;

  const findContactButtonStyle: CSSProperties = {
    ...compactButtonStyle,
    background: findContactButtonIsRed
      ? 'rgba(185, 28, 28, 0.32)'
      : 'rgba(22, 163, 74, 0.28)',
    border: findContactButtonIsRed
      ? '1px solid rgba(248, 113, 113, 0.48)'
      : '1px solid rgba(74, 222, 128, 0.42)',
    color: findContactButtonIsRed ? '#fff1f2' : '#ecfdf5',
    minWidth: '120px',
  };

  const editContactButtonStyle: CSSProperties = {
    ...compactButtonStyle,
    background: 'rgba(217, 119, 6, 0.28)',
    border: '1px solid rgba(251, 191, 36, 0.44)',
    color: '#fff7ed',
    minWidth: '124px',
  };

  const deleteButtonStyle: CSSProperties = {
    ...compactButtonStyle,
    background: 'rgba(185, 28, 28, 0.28)',
    border: '1px solid rgba(248, 113, 113, 0.42)',
    color: '#fff1f2',
  };

  const pagingButtonStyle = (disabled: boolean): CSSProperties => ({
    ...compactButtonStyle,
    minWidth: '76px',
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const editInputStyle = (hasError?: string): CSSProperties => ({
    width: '100%',
    background: editContactIsEditing ? '#233c61' : 'rgba(255,255,255,0.04)',
    color: '#f4f8ff',
    border: `1px solid ${hasError ? '#f87171' : editContactIsEditing ? '#6d8db8' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: '10px',
    padding: '10px 12px',
    boxSizing: 'border-box',
    fontSize: '0.95rem',
    opacity: editContactIsEditing ? 1 : 0.9,
  });

  const normalizedFindQuery = useMemo(() => normalizeCallsign(findContactQuery), [findContactQuery]);

  const matchingContacts = useMemo(() => {
    if (!normalizedFindQuery) return [];
    return records
      .filter((record) => normalizeCallsign(record.callsign || '') === normalizedFindQuery)
      .sort((a, b) => {
        const aStamp = `${a.date || ''} ${a.time || ''}`;
        const bStamp = `${b.date || ''} ${b.time || ''}`;
        return bStamp.localeCompare(aStamp, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [normalizedFindQuery, records]);

  const latestMatchingContact = matchingContacts[0] || null;

  const earlierMatchingContacts = useMemo(() => {
    if (!latestMatchingContact) return [];
    return matchingContacts.filter((record) => record.id !== latestMatchingContact.id);
  }, [latestMatchingContact, matchingContacts]);

  const normalizedEditQuery = useMemo(() => normalizeCallsign(editContactQuery), [editContactQuery]);

  const matchingEditContacts = useMemo(() => {
    if (!normalizedEditQuery) return [];
    return records
      .filter((record) => normalizeCallsign(record.callsign || '') === normalizedEditQuery)
      .sort((a, b) => {
        const aStamp = `${a.date || ''} ${a.time || ''}`;
        const bStamp = `${b.date || ''} ${b.time || ''}`;
        return bStamp.localeCompare(aStamp, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [normalizedEditQuery, records]);

  const selectedEditContact = useMemo(
    () => records.find((record) => record.id === editContactSelectedId) || null,
    [editContactSelectedId, records],
  );

  useEffect(() => {
    if (showEditContactDetails && selectedEditContact) {
      setEditContactDraft(createEditContactForm(selectedEditContact));
      setEditContactErrors({});
      setEditContactIsEditing(false);
    }
  }, [selectedEditContact, showEditContactDetails]);

  const handleOpenFindContact = () => {
    const startingCallsign = latestRecord?.callsign ? normalizeCallsign(latestRecord.callsign) : '';
    setFindContactQuery(startingCallsign);
    setShowFindContact(true);

    if (latestRecord && previousContactMatch) {
      setFindContactAcknowledgedId(latestRecord.id);
    }
  };

  const handleOpenEditContact = () => {
    setEditContactQuery('');
    setEditContactSelectedId(null);
    setShowEditContactDetails(false);
    setEditContactIsEditing(false);
    setEditContactErrors({});
    setEditContactDraft(null);
    setShowEditContact(true);
  };

  const handleOpenEditContactDetails = (recordId: string) => {
    setEditContactSelectedId(recordId);
    setShowEditContact(false);
    setShowEditContactDetails(true);
  };

  const handleCloseEditContactFlow = () => {
    setShowEditContact(false);
    setShowEditContactDetails(false);
    setEditContactSelectedId(null);
    setEditContactIsEditing(false);
    setEditContactErrors({});
    setEditContactDraft(null);
  };

  const handleFindContactChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFindContactQuery(event.target.value.toUpperCase());
  };

  const handleEditContactChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEditContactQuery(event.target.value.toUpperCase());
  };

  const handleEditDraftChange =
    (field: keyof EditContactForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const rawValue = event.target.value;
      const nextValue =
        field === 'callsign' || field === 'mode'
          ? rawValue.toUpperCase()
          : rawValue;

      setEditContactDraft((prev) =>
        prev
          ? {
              ...prev,
              [field]: nextValue,
            }
          : prev,
      );
    };

  const validateEditContactDraft = (): EditContactErrors => {
    const errors: EditContactErrors = {};

    if (!editContactDraft) return errors;

    if (!editContactDraft.callsign.trim()) {
      errors.callsign = 'Callsign is required.';
    }

    if (!normalizeDate(editContactDraft.date)) {
      errors.date = 'UTC date must be valid.';
    }

    if (!normalizeTime(editContactDraft.time)) {
      errors.time = 'UTC time must be valid.';
    }

    if (!normalizeFrequency(editContactDraft.frequency)) {
      errors.frequency = 'Frequency must be between 26.000 and 27.999 MHz.';
    }

    if (!normalizeMode(editContactDraft.mode)) {
      errors.mode = 'Mode is required.';
    }

    return errors;
  };

  const handleSaveEditedContact = () => {
    if (!selectedEditContact || !editContactDraft) return;

    const errors = validateEditContactDraft();
    setEditContactErrors(errors);

    if (Object.keys(errors).length > 0) return;

    onUpdateQso(selectedEditContact.id, {
      callsign: editContactDraft.callsign.trim().toUpperCase(),
      date: normalizeDate(editContactDraft.date),
      time: normalizeTime(editContactDraft.time),
      frequency: normalizeFrequency(editContactDraft.frequency),
      mode: normalizeMode(editContactDraft.mode),
      rst: editContactDraft.rst.trim(),
      path: editContactDraft.path.trim(),
      remarks: editContactDraft.remarks.trim(),
    });

    handleCloseEditContactFlow();
  };

  const handleDeleteSelectedContact = () => {
    if (!selectedEditContact) return;
    onDeleteQso(selectedEditContact.id);
    handleCloseEditContactFlow();
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'callsign' || field === 'mode' ? 'asc' : 'desc');
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return ' ↕';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const applyStatusPayload = useCallback(
    (payload: ClusterStatusPayload) => {
      const loggedIn = payload.loggedIn === true;
      const bridgeError = payload.lastError ?? null;

      setClusterLastLoginAt(payload.lastLoginAt ?? null);
      setClusterLastFetchAt(payload.lastFetchAt ?? null);
      setClusterLastError(bridgeError);

      if (loggedIn) {
        setClusterState('CONNECTED');
        setClusterMessage(`${clusterSettings.clusterName} connected.`);
        return;
      }

      if (bridgeError) {
        setClusterState('ERROR');
        setClusterMessage(bridgeError);
        return;
      }

      setClusterState('DISCONNECTED');
      setClusterMessage(`${clusterSettings.clusterName} is not connected.`);
    },
    [clusterSettings.clusterName],
  );

  const checkClusterStatus = useCallback(async () => {
    try {
      const response = await fetch(`${BRIDGE_BASE_URL}/api/status`);
      const payload = (await response.json()) as ClusterStatusPayload;
      if (!response.ok) {
        setClusterState('ERROR');
        setClusterMessage('Unable to read ClusterDX bridge status.');
        return;
      }
      applyStatusPayload(payload);
    } catch {
      setClusterState('ERROR');
      setClusterMessage('Unable to reach the ClusterDX bridge.');
    }
  }, [applyStatusPayload]);

  const connectCluster = useCallback(async () => {
    if (!clusterSettings.username.trim() || !clusterSettings.password.trim()) {
      setClusterState('ERROR');
      setClusterMessage('Enter and save ClusterDX username and password first.');
      return;
    }

    setClusterState('CONNECTING');
    setClusterMessage(`Connecting to ${clusterSettings.clusterName}...`);
    setClusterLastError(null);

    try {
      const response = await fetch(`${BRIDGE_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: clusterSettings.username.trim(),
          password: clusterSettings.password,
          rememberMe: clusterSettings.rememberMe,
        }),
      });

      const payload = (await response.json()) as ClusterStatusPayload;

      if (!response.ok || payload.ok !== true || payload.loggedIn !== true) {
        const errorMessage = payload.lastError || 'ClusterDX login failed.';
        setClusterState('ERROR');
        setClusterMessage(errorMessage);
        setClusterLastError(errorMessage);
        return;
      }

      applyStatusPayload(payload);
    } catch {
      setClusterState('ERROR');
      setClusterMessage('Unable to reach the ClusterDX bridge login endpoint.');
    }
  }, [applyStatusPayload, clusterSettings]);

  const fetchWeather = useCallback(async (latitude: string, longitude: string) => {
    if (!latitude.trim() || !longitude.trim()) {
      setWeather(DEFAULT_WEATHER);
      return;
    }

    const lat = Number.parseFloat(latitude);
    const lon = Number.parseFloat(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      setWeather((prev) => ({
        ...prev,
        error: 'Latitude or longitude is invalid.',
        summaryMessage: 'Latitude or longitude is invalid.',
      }));
      return;
    }

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code` +
        `&daily=precipitation_probability_max&timezone=auto&forecast_days=1`;

      const response = await fetch(url);
      const payload = (await response.json()) as OpenMeteoResponse;

      if (!response.ok || !payload.current || !payload.daily) {
        throw new Error('Weather API returned an invalid response.');
      }

      const temp = payload.current.temperature_2m;
      const wind = payload.current.wind_speed_10m;
      const windDir = payload.current.wind_direction_10m;
      const weatherCode = payload.current.weather_code ?? null;
      const rainChance = payload.daily.precipitation_probability_max?.[0] ?? 0;
      const compass = windDirectionToCompass(windDir);
      const weatherLabel = weatherCodeToLabel(weatherCode);
      const lightningRisk = deriveLightningRisk(weatherCode);

      setWeather({
        temperature: temp !== undefined ? `${Math.round(temp)}°C` : '—',
        wind:
          wind !== undefined
            ? `${Math.round(wind)} km/h${compass ? ` ${compass}` : ''}`
            : '—',
        rainChance: `${Math.round(rainChance)}%`,
        lightningRisk,
        summaryMessage: weatherLabel,
        weatherCode,
        weatherLabel,
        lastUpdated: payload.current.time ?? null,
        timezone: payload.timezone ?? null,
        error: null,
      });
    } catch {
      setWeather((prev) => ({
        ...prev,
        error: 'Unable to load weather from Open-Meteo.',
        summaryMessage: 'Unable to load weather from Open-Meteo.',
      }));
    }
  }, []);

  const fetchPropagation = useCallback(async () => {
    try {
      const response = await fetch(`${BRIDGE_BASE_URL}/api/propagation`);
      const payload = (await response.json()) as PropagationApiResponse;

      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || 'Propagation fetch failed.');
      }

      setPropagation({
        dayCondition: payload.dayCondition || 'Unknown',
        nightCondition: payload.nightCondition || 'Unknown',
        solarFlux: payload.solarFlux || '—',
        sunspots: payload.sunspots || '—',
        aIndex: payload.aIndex || '—',
        kIndex: payload.kIndex || '—',
        aurora: payload.aurora || '—',
        updatedAt: payload.updatedAt || null,
        sourceUrl: payload.sourceUrl || PROPAGATION_SOURCE_FALLBACK,
        error: null,
      });
    } catch (error) {
      setPropagation((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Propagation fetch failed.',
      }));
    }
  }, []);

  const saveSetup = () => {
    const cleanedProfile: StationProfile = {
      operatorName: profileDraft.operatorName.trim() || DEFAULT_PROFILE.operatorName,
      callsign: profileDraft.callsign.trim().toUpperCase() || DEFAULT_PROFILE.callsign,
      gridSquare: profileDraft.gridSquare.trim().toUpperCase() || DEFAULT_PROFILE.gridSquare,
      stationMode: profileDraft.stationMode,
      distanceUnit: profileDraft.distanceUnit,
      latitude: profileDraft.latitude.trim(),
      longitude: profileDraft.longitude.trim(),
    };

    const cleanedCluster: ClusterSettings = {
      clusterName: clusterDraft.clusterName.trim() || 'ClusterDX',
      username: clusterDraft.username.trim(),
      password: clusterDraft.password,
      rememberMe: clusterDraft.rememberMe,
    };

    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(cleanedProfile));
      window.localStorage.setItem(CLUSTER_STORAGE_KEY, JSON.stringify(cleanedCluster));
      setProfile(cleanedProfile);
      setClusterSettings(cleanedCluster);

      const nowLabel = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setLastSavedAt(nowLabel);
      setSaveMessage('Settings saved successfully.');
      setSaveMessageTone('success');
    } catch {
      setSaveMessage('Settings could not be saved locally.');
      setSaveMessageTone('error');
    }

    void fetchWeather(cleanedProfile.latitude, cleanedProfile.longitude);
  };

  const cancelSetupChanges = () => {
    setProfileDraft(profile);
    setClusterDraft(clusterSettings);
    setSaveMessage('');
    setShowSetup(false);
  };

  useEffect(() => {
    void checkClusterStatus();
  }, [checkClusterStatus]);

  useEffect(() => {
    void fetchWeather(profile.latitude, profile.longitude);
    const interval = window.setInterval(() => {
      void fetchWeather(profile.latitude, profile.longitude);
    }, 10 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [profile.latitude, profile.longitude, fetchWeather]);

  useEffect(() => {
    void fetchPropagation();
    const interval = window.setInterval(() => {
      void fetchPropagation();
    }, 15 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [fetchPropagation]);

  const headerBadgeStyle = (bg: string, border: string, color: string): CSSProperties => ({
    ...compactButtonStyle,
    background: bg,
    border: `1px solid ${border}`,
    color,
  });

  const sortableThStyle: CSSProperties = {
    textAlign: 'left',
    padding: '9px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    color: '#d7e4f5',
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const tdStyle: CSSProperties = {
    padding: '9px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    color: '#edf4ff',
    fontSize: '0.88rem',
    verticalAlign: 'top',
  };

  const logoStyle: CSSProperties = {
    width: '140px',
    height: '140px',
    objectFit: 'contain',
    borderRadius: '12px',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.28)',
    flexShrink: 0,
    display: 'block',
  };

  const logoFallbackStyle: CSSProperties = {
    width: '140px',
    height: '140px',
    borderRadius: '12px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.95), rgba(30, 58, 138, 0.85))',
    border: '1px solid rgba(234, 179, 8, 0.45)',
    color: '#f5d76e',
    fontWeight: 900,
    fontSize: '1rem',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.28)',
  };

  const dayTone = propagationTone(propagation.dayCondition);
  const nightTone = propagationTone(propagation.nightCondition);

  const smallMetricTileStyle: CSSProperties = {
    padding: '8px 10px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(171, 205, 255, 0.16)',
    textAlign: 'center',
    minWidth: 0,
  };

  return (
    <div style={shellStyle}>
      {showAbout && (
        <div
          onClick={() => setShowAbout(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '20px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '760px',
              background: 'rgba(18, 33, 56, 0.98)',
              border: '1px solid rgba(125, 180, 255, 0.28)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              padding: '20px',
              display: 'grid',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>About RDI Log Plus</div>
                <div style={{ color: '#bfd0e4', fontSize: '0.92rem', marginTop: '4px' }}>
                  Version 1.04.26
                </div>
              </div>

              <button type="button" style={compactButtonStyle} onClick={() => setShowAbout(false)}>
                Close
              </button>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e7f1ff',
                lineHeight: 1.7,
                fontSize: '0.95rem',
              }}
            >
              <strong>RDI Log Plus</strong> is a modern operating and logging companion built with a clear focus on
              real 11m radio use. It combines practical logging tools, quick frequency presets, live map activity,
              contact search and editing, and a clean dashboard layout designed for everyday operators.
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e7f1ff',
                lineHeight: 1.7,
                fontSize: '0.95rem',
              }}
            >
              <strong>Radio DX International</strong> is a worldwide radio community focused on bringing operators
              together through activity, friendship, check-ins, DX, learning, and a shared love of radio.
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(251, 191, 36, 0.10)',
                border: '1px solid rgba(251, 191, 36, 0.24)',
                color: '#fff7ed',
                lineHeight: 1.7,
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
            >
              Built for operators. Designed for clarity. Powered by the spirit of Radio DX International.
            </div>

            <div style={{ color: '#bfd0e4', fontSize: '0.85rem' }}>
              Radio DX International — Since 2018
            </div>
          </div>
        </div>
      )}

      {showWeatherWarning && (
        <div
          onClick={() => setShowWeatherWarning(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'rgba(18, 33, 56, 0.98)',
              border:
                weatherStatus === 'WARNING'
                  ? '1px solid rgba(248, 113, 113, 0.5)'
                  : weatherStatus === 'WATCH'
                    ? '1px solid rgba(251, 191, 36, 0.45)'
                    : '1px solid rgba(74, 222, 128, 0.4)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              padding: '18px',
              display: 'grid',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
              {weatherStatus === 'WARNING'
                ? 'Weather Warning'
                : weatherStatus === 'WATCH'
                  ? 'Weather Watch'
                  : 'Weather Status'}
            </div>
            <div style={{ color: '#d9e7f7', fontSize: '0.95rem' }}>
              {weatherStatus === 'WARNING'
                ? 'A weather warning is active. Review local conditions before operating.'
                : weatherStatus === 'WATCH'
                  ? 'Weather watch conditions are present. Keep an eye on changing local conditions.'
                  : 'No weather warning is active right now.'}
            </div>
            <div style={{ color: '#d9e7f7', fontSize: '0.92rem' }}>
              Temperature: <strong>{weather.temperature}</strong>
              <br />
              Wind: <strong>{weather.wind}</strong>
              <br />
              Rain: <strong>{weather.rainChance}</strong>
              <br />
              Lightning: <strong>{weather.lightningRisk}</strong>
              <br />
              Summary: <strong>{weather.weatherLabel}</strong>
            </div>
            <div>
              <button type="button" style={compactButtonStyle} onClick={() => setShowWeatherWarning(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showFindContact && (
        <div
          onClick={() => setShowFindContact(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '620px',
              background: 'rgba(18, 33, 56, 0.98)',
              border: '1px solid rgba(125, 180, 255, 0.28)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Find Contact</div>

            <div>
              <div style={labelStyle}>Search by Callsign</div>
              <input
                type="text"
                value={findContactQuery}
                onChange={handleFindContactChange}
                placeholder="Enter callsign"
                style={inputStyle}
              />
            </div>

            {!normalizedFindQuery ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#d9e7f7',
                }}
              >
                Enter a callsign to search your logbook.
              </div>
            ) : matchingContacts.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(22, 163, 74, 0.16)',
                  border: '1px solid rgba(74, 222, 128, 0.32)',
                  color: '#ecfdf5',
                }}
              >
                No QSO found for <strong>{normalizedFindQuery}</strong>.
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#d9e7f7',
                    fontSize: '0.92rem',
                    lineHeight: 1.7,
                  }}
                >
                  <strong>Latest matching QSO</strong>
                  <br />
                  Callsign: <strong>{latestMatchingContact?.callsign || '—'}</strong>
                  <br />
                  Date: <strong>{latestMatchingContact?.date || '—'}</strong>
                  <br />
                  UTC: <strong>{latestMatchingContact?.time || '—'}</strong>
                  <br />
                  Frequency: <strong>{latestMatchingContact?.frequency || '—'}</strong>
                  <br />
                  Mode: <strong>{latestMatchingContact?.mode || '—'}</strong>
                  <br />
                  RST: <strong>{latestMatchingContact?.rst || '—'}</strong>
                  <br />
                  Path: <strong>{latestMatchingContact?.path || '—'}</strong>
                  <br />
                  Remarks: <strong>{latestMatchingContact?.remarks || '—'}</strong>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background:
                      earlierMatchingContacts.length > 0
                        ? 'rgba(185, 28, 28, 0.16)'
                        : 'rgba(22, 163, 74, 0.16)',
                    border:
                      earlierMatchingContacts.length > 0
                        ? '1px solid rgba(248, 113, 113, 0.32)'
                        : '1px solid rgba(74, 222, 128, 0.32)',
                    color: earlierMatchingContacts.length > 0 ? '#fff1f2' : '#ecfdf5',
                  }}
                >
                  Total QSOs found for <strong>{normalizedFindQuery}</strong>: <strong>{matchingContacts.length}</strong>
                  <br />
                  Earlier QSOs before the latest one: <strong>{earlierMatchingContacts.length}</strong>
                </div>

                {earlierMatchingContacts.length > 0 && (
                  <div
                    style={{
                      maxHeight: '220px',
                      overflowY: 'auto',
                      padding: '10px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ ...labelStyle, marginBottom: '10px' }}>Earlier Contact History</div>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {earlierMatchingContacts.map((record) => (
                        <div
                          key={record.id}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: '#d9e7f7',
                            fontSize: '0.9rem',
                            lineHeight: 1.6,
                          }}
                        >
                          <strong>{record.date || '—'}</strong> at <strong>{record.time || '—'}</strong>
                          <br />
                          {record.frequency || '—'} {record.mode || '—'}
                          {record.rst ? ` • RST ${record.rst}` : ''}
                          {record.path ? ` • ${record.path}` : ''}
                          <br />
                          Remarks: <strong>{record.remarks || '—'}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" style={compactButtonStyle} onClick={() => setShowFindContact(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditContact && (
        <div
          onClick={handleCloseEditContactFlow}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '620px',
              background: 'rgba(18, 33, 56, 0.98)',
              border: '1px solid rgba(251, 191, 36, 0.28)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Edit Contact</div>

            <div>
              <div style={labelStyle}>Search by Callsign</div>
              <input
                type="text"
                value={editContactQuery}
                onChange={handleEditContactChange}
                placeholder="Enter callsign"
                style={inputStyle}
              />
            </div>

            {!normalizedEditQuery ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#d9e7f7',
                }}
              >
                Enter a callsign to open a saved contact.
              </div>
            ) : matchingEditContacts.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(185, 28, 28, 0.16)',
                  border: '1px solid rgba(248, 113, 113, 0.32)',
                  color: '#fff1f2',
                }}
              >
                No saved contact found for <strong>{normalizedEditQuery}</strong>.
              </div>
            ) : (
              <div
                style={{
                  maxHeight: '320px',
                  overflowY: 'auto',
                  padding: '10px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ ...labelStyle, marginBottom: '8px' }}>Matching Contacts</div>

                <div
                  style={{
                    marginBottom: '12px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: 'rgba(251, 191, 36, 0.10)',
                    border: '1px solid rgba(251, 191, 36, 0.24)',
                    color: '#fff7ed',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                  }}
                >
                  Click a matching contact below to open details for editing or deletion.
                </div>

                <div style={{ display: 'grid', gap: '10px' }}>
                  {matchingEditContacts.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => handleOpenEditContactDetails(record.id)}
                      title="Click to open contact details"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: '12px',
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
                        border: '1px solid rgba(251, 191, 36, 0.34)',
                        color: '#fff7ed',
                        fontSize: '0.92rem',
                        lineHeight: 1.65,
                        cursor: 'pointer',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '12px',
                          alignItems: 'center',
                          marginBottom: '4px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong>{record.callsign || '—'}</strong>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            color: '#fde68a',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}
                        >
                          Click to open
                        </span>
                      </div>

                      <div>
                        {record.date || '—'} at {record.time || '—'}
                      </div>

                      <div>
                        {record.frequency || '—'} {record.mode || '—'}
                        {record.rst ? ` • RST ${record.rst}` : ''}
                        {record.path ? ` • ${record.path}` : ''}
                      </div>

                      <div>
                        Remarks: <strong>{record.remarks || '—'}</strong>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" style={compactButtonStyle} onClick={handleCloseEditContactFlow}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditContactDetails && selectedEditContact && editContactDraft && (
        <div
          onClick={handleCloseEditContactFlow}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
            padding: '20px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '760px',
              background: 'rgba(18, 33, 56, 0.98)',
              border: '1px solid rgba(251, 191, 36, 0.28)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Contact Details</div>
              <div style={{ color: '#bfd0e4', fontSize: '0.82rem', fontWeight: 700 }}>
                Selected: {selectedEditContact.callsign || '—'}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <div style={labelStyle}>Callsign</div>
                <input
                  type="text"
                  value={editContactDraft.callsign}
                  onChange={handleEditDraftChange('callsign')}
                  style={editInputStyle(editContactErrors.callsign)}
                  disabled={!editContactIsEditing}
                />
                {editContactErrors.callsign && (
                  <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
                    {editContactErrors.callsign}
                  </div>
                )}
              </div>

              <div>
                <div style={labelStyle}>UTC Date</div>
                <input
                  type="date"
                  value={editContactDraft.date}
                  onChange={handleEditDraftChange('date')}
                  style={editInputStyle(editContactErrors.date)}
                  disabled={!editContactIsEditing}
                />
                {editContactErrors.date && (
                  <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
                    {editContactErrors.date}
                  </div>
                )}
              </div>

              <div>
                <div style={labelStyle}>UTC Time</div>
                <input
                  type="time"
                  value={editContactDraft.time}
                  onChange={handleEditDraftChange('time')}
                  style={editInputStyle(editContactErrors.time)}
                  disabled={!editContactIsEditing}
                />
                {editContactErrors.time && (
                  <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
                    {editContactErrors.time}
                  </div>
                )}
              </div>

              <div>
                <div style={labelStyle}>Frequency</div>
                <input
                  type="text"
                  value={editContactDraft.frequency}
                  onChange={handleEditDraftChange('frequency')}
                  style={editInputStyle(editContactErrors.frequency)}
                  disabled={!editContactIsEditing}
                />
                {editContactErrors.frequency && (
                  <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
                    {editContactErrors.frequency}
                  </div>
                )}
              </div>

              <div>
                <div style={labelStyle}>Mode</div>
                <input
                  type="text"
                  value={editContactDraft.mode}
                  onChange={handleEditDraftChange('mode')}
                  style={editInputStyle(editContactErrors.mode)}
                  disabled={!editContactIsEditing}
                />
                {editContactErrors.mode && (
                  <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
                    {editContactErrors.mode}
                  </div>
                )}
              </div>

              <div>
                <div style={labelStyle}>RST</div>
                <input
                  type="text"
                  value={editContactDraft.rst}
                  onChange={handleEditDraftChange('rst')}
                  style={editInputStyle()}
                  disabled={!editContactIsEditing}
                />
              </div>

              <div>
                <div style={labelStyle}>Path</div>
                <input
                  type="text"
                  value={editContactDraft.path}
                  onChange={handleEditDraftChange('path')}
                  style={editInputStyle()}
                  disabled={!editContactIsEditing}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <div style={labelStyle}>Remarks</div>
                <textarea
                  value={editContactDraft.remarks}
                  onChange={handleEditDraftChange('remarks')}
                  style={{ ...editInputStyle(), minHeight: '100px', resize: 'vertical' }}
                  disabled={!editContactIsEditing}
                />
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#d9e7f7',
                fontSize: '0.9rem',
              }}
            >
              {editContactIsEditing
                ? 'Editing is active. Save your changes or cancel to return to view mode.'
                : 'This contact is in view mode. Press Edit to make changes or Delete to remove it.'}
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {!editContactIsEditing ? (
                <button
                  type="button"
                  style={editContactButtonStyle}
                  onClick={() => {
                    setEditContactIsEditing(true);
                    setEditContactErrors({});
                  }}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button type="button" style={primaryButtonStyle} onClick={handleSaveEditedContact}>
                    Save
                  </button>
                  <button
                    type="button"
                    style={compactButtonStyle}
                    onClick={() => {
                      if (selectedEditContact) {
                        setEditContactDraft(createEditContactForm(selectedEditContact));
                      }
                      setEditContactErrors({});
                      setEditContactIsEditing(false);
                    }}
                  >
                    Cancel Edit
                  </button>
                </>
              )}

              <button type="button" style={deleteButtonStyle} onClick={handleDeleteSelectedContact}>
                Delete
              </button>

              <button type="button" style={compactButtonStyle} onClick={handleCloseEditContactFlow}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          maxWidth: '1560px',
          margin: '0 auto',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div
          style={{
            ...panelStyle,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '18px',
            flexWrap: 'wrap',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>Weather Watch</div>

            <div style={headerBadgeStyle('rgba(255,255,255,0.05)', 'rgba(180, 200, 226, 0.2)', '#f0f6ff')}>
              Temp {weather.temperature}
            </div>
            <div style={headerBadgeStyle('rgba(255,255,255,0.05)', 'rgba(180, 200, 226, 0.2)', '#f0f6ff')}>
              Wind {weather.wind}
            </div>
            <div style={headerBadgeStyle('rgba(255,255,255,0.05)', 'rgba(180, 200, 226, 0.2)', '#f0f6ff')}>
              Rain {weather.rainChance}
            </div>
            <button
              type="button"
              style={{
                ...compactButtonStyle,
                background: warningBadge.background,
                border: `1px solid ${warningBadge.border}`,
                color: warningBadge.color,
              }}
              onClick={() => setShowWeatherWarning(true)}
            >
              {warningBadge.label}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>Map Status</div>
            <div style={headerBadgeStyle(clusterBadge.background, clusterBadge.border, clusterBadge.color)}>
              {clusterSettings.clusterName} {clusterBadge.label}
            </div>
          </div>
        </div>

        {showSetup && (
          <div
            style={{
              ...panelStyle,
              display: 'grid',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Console + Cluster Settings</div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" style={saveSetupButtonStyle} onClick={saveSetup}>
                  {saveMessage && saveMessageTone === 'success' ? 'Saved' : 'Save'}
                </button>
                <button type="button" style={compactButtonStyle} onClick={cancelSetupChanges}>
                  Close
                </button>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '16px',
              }}
            >
              <div style={{ ...statCardStyle, display: 'grid', gap: '12px' }}>
                <div style={{ fontSize: '1.02rem', fontWeight: 700 }}>Station Profile</div>

                <div>
                  <div style={labelStyle}>Operator Name</div>
                  <input
                    type="text"
                    value={profileDraft.operatorName}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({ ...prev, operatorName: event.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Call Sign</div>
                  <input
                    type="text"
                    value={profileDraft.callsign}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({ ...prev, callsign: event.target.value.toUpperCase() }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Grid Square</div>
                  <input
                    type="text"
                    value={profileDraft.gridSquare}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({ ...prev, gridSquare: event.target.value.toUpperCase() }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Station Mode</div>
                  <select
                    value={profileDraft.stationMode}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({
                        ...prev,
                        stationMode: event.target.value as StationMode,
                      }))
                    }
                    style={selectStyle}
                  >
                    <option value="HOME">HOME</option>
                    <option value="PORTABLE">PORTABLE</option>
                    <option value="MOBILE">MOBILE</option>
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Distance Units</div>
                  <select
                    value={profileDraft.distanceUnit}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({
                        ...prev,
                        distanceUnit: event.target.value as DistanceUnit,
                      }))
                    }
                    style={selectStyle}
                  >
                    <option value="KM">KM (Metric)</option>
                    <option value="MI">MI (Standard)</option>
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Latitude</div>
                  <input
                    type="text"
                    value={profileDraft.latitude}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({ ...prev, latitude: event.target.value }))
                    }
                    style={inputStyle}
                    placeholder="e.g. 45.4215"
                  />
                </div>

                <div>
                  <div style={labelStyle}>Longitude</div>
                  <input
                    type="text"
                    value={profileDraft.longitude}
                    onChange={(event) =>
                      setProfileDraft((prev) => ({ ...prev, longitude: event.target.value }))
                    }
                    style={inputStyle}
                    placeholder="e.g. -75.6972"
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <a
                    href={COORDINATE_HELP_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      ...compactButtonStyle,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '160px',
                    }}
                  >
                    Find Coordinates
                  </a>
                </div>
              </div>

              <div style={{ ...statCardStyle, display: 'grid', gap: '12px' }}>
                <div style={{ fontSize: '1.02rem', fontWeight: 700 }}>Bridge Login Settings</div>

                <div>
                  <div style={labelStyle}>Cluster Name</div>
                  <input
                    type="text"
                    value={clusterDraft.clusterName}
                    onChange={(event) =>
                      setClusterDraft((prev) => ({ ...prev, clusterName: event.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Username</div>
                  <input
                    type="text"
                    value={clusterDraft.username}
                    onChange={(event) =>
                      setClusterDraft((prev) => ({ ...prev, username: event.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Password</div>
                  <input
                    type="password"
                    value={clusterDraft.password}
                    onChange={(event) =>
                      setClusterDraft((prev) => ({ ...prev, password: event.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: '#d7e3f1',
                    fontSize: '0.92rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={clusterDraft.rememberMe}
                    onChange={(event) =>
                      setClusterDraft((prev) => ({ ...prev, rememberMe: event.target.checked }))
                    }
                  />
                  Remember me
                </label>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button type="button" style={saveSetupButtonStyle} onClick={saveSetup}>
                    {saveMessage && saveMessageTone === 'success' ? 'Saved' : 'Save Credentials'}
                  </button>
                  <button type="button" style={primaryButtonStyle} onClick={() => void connectCluster()}>
                    {clusterState === 'CONNECTING' ? 'Connecting...' : 'Connect'}
                  </button>
                  <button type="button" style={compactButtonStyle} onClick={() => void checkClusterStatus()}>
                    Check Status
                  </button>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#d7e6f7',
                fontSize: '0.92rem',
                display: 'grid',
                gap: '6px',
              }}
            >
              <div>
                <strong>Status:</strong> {clusterSettings.clusterName} {clusterBadge.label}
              </div>
              <div>
                <strong>Message:</strong> {clusterMessage}
              </div>
              <div>
                <strong>Last Login:</strong> {formatDateTime(clusterLastLoginAt)}
              </div>
              <div>
                <strong>Last Fetch:</strong> {formatDateTime(clusterLastFetchAt)}
              </div>
              <div>
                <strong>Last Error:</strong> {clusterLastError || '—'}
              </div>
              <div>
                <strong>Weather:</strong> {weather.summaryMessage}
              </div>
              {saveMessage && (
                <div
                  style={{
                    marginTop: '6px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background:
                      saveMessageTone === 'success'
                        ? 'rgba(22, 163, 74, 0.16)'
                        : 'rgba(185, 28, 28, 0.18)',
                    border:
                      saveMessageTone === 'success'
                        ? '1px solid rgba(74, 222, 128, 0.45)'
                        : '1px solid rgba(248, 113, 113, 0.45)',
                    color: saveMessageTone === 'success' ? '#dcfce7' : '#fee2e2',
                    fontWeight: 700,
                  }}
                >
                  <strong>Saved:</strong> {saveMessage}
                  {lastSavedAt ? ` Last saved at ${lastSavedAt}.` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.5fr) minmax(340px, 1fr)',
            gap: '14px',
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'grid', gap: '10px' }}>
            <div style={panelStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '6px',
                }}
              >
                <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>RDI Dashboard</div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" style={compactButtonStyle} onClick={() => setShowAbout(true)}>
                    About
                  </button>
                  <button type="button" style={compactButtonStyle} onClick={() => setShowSetup((prev) => !prev)}>
                    ⚙ Setup
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto auto',
                  justifyContent: 'space-between',
                  gap: '18px',
                  alignItems: 'center',
                  minHeight: '34px',
                }}
              >
                <div style={{ fontSize: '1.06rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {utcTimeOnly} UTC
                </div>
                <div style={{ fontSize: '1.06rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {localTimeOnly} Local
                </div>
                <div style={{ fontSize: '1.06rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {localDateLabel}
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: 'grid',
                  gap: '4px',
                  marginBottom: '8px',
                  padding: '8px 10px',
                  borderRadius: '14px',
                  background:
                    'linear-gradient(180deg, rgba(35, 60, 97, 0.96), rgba(24, 44, 74, 0.96))',
                  border: '1px solid rgba(125, 180, 255, 0.24)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                    marginBottom: '0',
                  }}
                >
                  <div style={{ fontSize: '0.96rem', fontWeight: 800 }}>
                    Live 11m Propagation Snapshot
                  </div>

                  <div style={{ color: '#bfd0e4', fontSize: '0.78rem', fontWeight: 600 }}>
                    Updated: {propagation.updatedAt?.replace(/^11M Band Propagation\s*/i, '') || '—'}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                    gap: '8px',
                    alignItems: 'stretch',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: dayTone.background,
                      border: `1px solid ${dayTone.border}`,
                      color: dayTone.color,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ ...labelStyle, marginBottom: '3px', color: '#d8e6f7', fontSize: '0.66rem' }}>
                      Day
                    </div>
                    <div
                      style={{
                        fontSize: '0.94rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {propagation.dayCondition}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: nightTone.background,
                      border: `1px solid ${nightTone.border}`,
                      color: nightTone.color,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ ...labelStyle, marginBottom: '3px', color: '#d8e6f7', fontSize: '0.66rem' }}>
                      Night
                    </div>
                    <div
                      style={{
                        fontSize: '0.94rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {propagation.nightCondition}
                    </div>
                  </div>

                  {[
                    ['SFI', propagation.solarFlux],
                    ['SN', propagation.sunspots],
                    ['A', propagation.aIndex],
                    ['K', propagation.kIndex],
                    ['Aurora', propagation.aurora],
                  ].map(([label, value]) => (
                    <div key={label} style={smallMetricTileStyle}>
                      <div style={{ ...labelStyle, marginBottom: '3px', fontSize: '0.66rem' }}>{label}</div>
                      <div
                        style={{
                          fontSize: '0.96rem',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  minHeight: '650px',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  marginTop: '0',
                }}
              >
                <RDILiveMap dataMode={dataMode} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={panelStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                  marginBottom: '14px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '6px' }}>RDI Log Plus</div>
                  <div style={{ color: '#bfd0e4', fontSize: '0.92rem' }}>
                    Compact operating console on the right side
                  </div>
                </div>

                {!logoLoadFailed ? (
                  <img
                    src={RDI_LOGO_SRC}
                    alt="Radio DX International logo"
                    style={logoStyle}
                    onError={() => setLogoLoadFailed(true)}
                  />
                ) : (
                  <div style={logoFallbackStyle}>RDI</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                <button type="button" style={primaryButtonStyle} onClick={onCreateLogbook}>
                  Create
                </button>
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    background: 'rgba(191, 141, 102, 0.34)',
                    border: '1px solid rgba(226, 183, 149, 0.34)',
                  }}
                  onClick={onOpenAddQso}
                >
                  Add QSO
                </button>
                <button
                  type="button"
                  style={{
                    ...compactButtonStyle,
                    background: 'rgba(97, 143, 106, 0.3)',
                    border: '1px solid rgba(155, 200, 164, 0.32)',
                  }}
                  onClick={onImportCSVClick}
                >
                  Import
                </button>
                <button
                  type="button"
                  style={{
                    ...compactButtonStyle,
                    background: 'rgba(126, 104, 160, 0.3)',
                    border: '1px solid rgba(181, 160, 213, 0.3)',
                  }}
                  onClick={onExportCsv}
                >
                  Export
                </button>
              </div>

              <div style={statCardStyle}>
                <div style={labelStyle}>Active Logbook</div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <select
                    style={selectStyle}
                    value={activeLogbook?.id || ''}
                    onChange={(event) => onSwitchLogbook(event.target.value)}
                  >
                    {logbooks.map((logbook) => (
                      <option key={logbook.id} value={logbook.id}>
                        {logbook.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" style={compactButtonStyle} onClick={onCreateLogbook}>
                    New
                  </button>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '10px' }}>Quick Presets</div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {displayPresets.map((preset) => (
                  <button
                    key={`${preset.label}-${preset.frequency}-${preset.mode}`}
                    type="button"
                    style={{
                      padding: '7px 10px',
                      borderRadius: '10px',
                      background: 'rgba(100, 157, 164, 0.3)',
                      border: '1px solid rgba(164, 213, 220, 0.3)',
                      color: '#efffff',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                    onClick={() => onOpenPresetQso(preset)}
                  >
                    {preset.label} {preset.frequency} {preset.mode}
                  </button>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '10px',
                  alignItems: 'center',
                  marginBottom: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '1rem', fontWeight: 800 }}>Recent QSOs</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <div style={{ color: '#d2e2f4', fontSize: '0.82rem', fontWeight: 700 }}>
                    {records.length} QSOs
                  </div>

                  <button
                    type="button"
                    style={findContactButtonStyle}
                    onClick={handleOpenFindContact}
                    disabled={!latestRecord && records.length === 0}
                    title={
                      previousContactMatch
                        ? `Previous QSO found for ${latestRecord?.callsign || 'this operator'}`
                        : 'Search your logbook by callsign'
                    }
                  >
                    Find Contact
                  </button>

                  <button
                    type="button"
                    style={editContactButtonStyle}
                    onClick={handleOpenEditContact}
                    disabled={records.length === 0}
                    title="Find a saved contact and open it for editing or deletion"
                  >
                    Edit Contacts
                  </button>
                </div>
              </div>

              {sortedRecords.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '10px',
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ color: '#bfd0e4', fontSize: '0.84rem', fontWeight: 700 }}>
                    Rolodex View • Page {currentQsoPage} of {totalQsoPages}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      style={pagingButtonStyle(currentQsoPage === 1)}
                      onClick={() => setCurrentQsoPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentQsoPage === 1}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      style={pagingButtonStyle(currentQsoPage === totalQsoPages)}
                      onClick={() => setCurrentQsoPage((prev) => Math.min(totalQsoPages, prev + 1))}
                      disabled={currentQsoPage === totalQsoPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: '520px',
                    fontSize: '0.88rem',
                  }}
                >
                  <thead>
                    <tr>
                      <th style={sortableThStyle} onClick={() => handleSort('callsign')}>
                        Callsign{getSortIndicator('callsign')}
                      </th>
                      <th style={sortableThStyle} onClick={() => handleSort('date')}>
                        Date{getSortIndicator('date')}
                      </th>
                      <th style={sortableThStyle} onClick={() => handleSort('time')}>
                        UTC{getSortIndicator('time')}
                      </th>
                      <th style={sortableThStyle} onClick={() => handleSort('frequency')}>
                        Frequency{getSortIndicator('frequency')}
                      </th>
                      <th style={sortableThStyle} onClick={() => handleSort('mode')}>
                        Mode{getSortIndicator('mode')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRecords.length > 0 ? (
                      pagedRecords.map((record) => (
                        <tr key={record.id}>
                          <td style={tdStyle}>{record.callsign}</td>
                          <td style={tdStyle}>{record.date}</td>
                          <td style={tdStyle}>{record.time}</td>
                          <td style={tdStyle}>{record.frequency}</td>
                          <td style={tdStyle}>{record.mode}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'center',
                            color: '#a6bdd8',
                            padding: '18px 12px',
                          }}
                          colSpan={5}
                        >
                          No QSOs logged yet. Use <strong>Add QSO</strong> or a preset to begin.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {latestRecord && (
                <div style={{ color: '#bfd0e4', fontSize: '0.84rem', marginTop: '10px' }}>
                  Latest contact: {latestRecord.callsign} on {latestRecord.frequency} {latestRecord.mode}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}