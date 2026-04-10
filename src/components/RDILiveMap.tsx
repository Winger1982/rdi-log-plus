import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type DistanceUnit = 'KM' | 'MI';
type DataMode = 'OFFLINE' | 'ONLINE';
type MapTheme = 'light' | 'dark';

type StationProfile = {
  operatorName: string;
  callsign: string;
  gridSquare: string;
  distanceUnit: DistanceUnit;
};

type MapStation = {
  callsign: string;
  operatorName?: string;
  gridSquare: string;
  submitterGrid?: string;
  country?: string;
  isRDI?: boolean;
  isActive?: boolean;
  source?: 'OFFLINE' | 'CLUSTERDX' | 'MANUAL';
  frequency?: string;
  mode?: string;
  utcTime?: string;
};

type LatLon = {
  lat: number;
  lon: number;
};

type RDILiveMapProps = {
  dataMode?: DataMode;
  mapConnected?: boolean;
  stationProfile?: Partial<StationProfile>;
  clusterSpots?: MapStation[];
  mapTheme?: MapTheme;
};

type BridgeSpotsResponse = {
  ok: boolean;
  count?: number;
  fetchedAt?: string;
  spots?: MapStation[];
  error?: string;
};

type LatLngTuple = [number, number];

const BRIDGE_BASE_URL = 'https://rdi-log-plus-bridge.onrender.com';
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY ?? '';
const MAP_THEME_STORAGE_KEY = 'rdi-map-theme';

const defaultStationProfile: StationProfile = {
  operatorName: 'Fred',
  callsign: '9RDI01',
  gridSquare: 'FN25',
  distanceUnit: 'KM',
};

const offlineStations: MapStation[] = [
  {
    callsign: '44RDI12',
    operatorName: 'Paul',
    gridSquare: 'IO91',
    country: 'England',
    isRDI: true,
    isActive: true,
    source: 'OFFLINE',
    frequency: '27.385',
    mode: 'LSB',
    utcTime: '13:42',
  },
  {
    callsign: '14RDI03',
    operatorName: 'Marc',
    gridSquare: 'JN18',
    country: 'France',
    isRDI: true,
    isActive: false,
    source: 'OFFLINE',
    frequency: '27.555',
    mode: 'USB',
    utcTime: '13:40',
  },
  {
    callsign: '1RDI07',
    operatorName: 'Luca',
    gridSquare: 'JN61',
    country: 'Italy',
    isRDI: true,
    isActive: true,
    source: 'OFFLINE',
    frequency: '27.425',
    mode: 'AM',
    utcTime: '13:44',
  },
  {
    callsign: '3ATI',
    operatorName: 'Demo Contact',
    gridSquare: 'GG66',
    country: 'Brazil',
    isRDI: false,
    isActive: false,
    source: 'OFFLINE',
    frequency: '27.565',
    mode: 'USB',
    utcTime: '13:35',
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeGridSquare(grid: string) {
  return grid.trim().toUpperCase();
}

function maidenheadToLatLon(grid: string): LatLon | null {
  const g = normalizeGridSquare(grid);

  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) {
    return null;
  }

  const A = 'A'.charCodeAt(0);

  const fieldLon = g.charCodeAt(0) - A;
  const fieldLat = g.charCodeAt(1) - A;
  const squareLon = Number.parseInt(g[2], 10);
  const squareLat = Number.parseInt(g[3], 10);

  let lon = fieldLon * 20 - 180 + squareLon * 2;
  let lat = fieldLat * 10 - 90 + squareLat * 1;

  if (g.length >= 6) {
    const subLon = g.charCodeAt(4) - A;
    const subLat = g.charCodeAt(5) - A;

    lon += subLon * (2 / 24);
    lat += subLat * (1 / 24);

    lon += (2 / 24) / 2;
    lat += (1 / 24) / 2;
  } else {
    lon += 1;
    lat += 0.5;
  }

  lat = clamp(lat, -89.999, 89.999);
  lon = clamp(lon, -179.999, 179.999);

  return { lat, lon };
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function calculateDistanceKm(from: LatLon, to: LatLon) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);

  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function calculateBearing(from: LatLon, to: LatLon) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function degreesToCompass(degrees: number) {
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

function formatDistance(distanceKm: number, unit: DistanceUnit) {
  if (unit === 'MI') {
    return `${Math.round(distanceKm * 0.621371).toLocaleString()} mi`;
  }
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

function getPrefixFlag(callsign: string) {
  if (callsign.startsWith('9RDI')) return '🇨🇦';
  if (callsign.startsWith('44RDI') || callsign.startsWith('26RDI')) return '🇬🇧';
  if (callsign.startsWith('14RDI')) return '🇫🇷';
  if (callsign.startsWith('1RDI')) return '🇮🇹';
  return '🏳️';
}

function getMarkerColor(station: MapStation) {
  if (station.isActive && station.isRDI) return '#f5b301';
  if (station.isRDI) return '#4da3ff';
  if (station.source === 'CLUSTERDX') return '#22c55e';
  return '#7ddc6d';
}

function getSourceLabel(station: MapStation) {
  if (station.source === 'CLUSTERDX') return 'ClusterDX';
  if (station.source === 'MANUAL') return 'Manual';
  return 'Offline';
}

function formatBridgeTime(value: string | null) {
  if (!value) return 'Not updated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not updated';
  return `${date.toUTCString().split(' ')[4]} UTC`;
}

function buildOpenWeatherTileUrl(layer: string) {
  return `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`;
}

function getStoredMapTheme(): MapTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(MAP_THEME_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function getBaseMapUrl(mapTheme: MapTheme) {
  return mapTheme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}

function getMapBackground(mapTheme: MapTheme) {
  return mapTheme === 'dark' ? '#111827' : '#dbe4ef';
}

export default function RDILiveMap({
  dataMode = 'OFFLINE',
  mapConnected = true,
  stationProfile,
  clusterSpots,
  mapTheme,
}: RDILiveMapProps) {
  const [selectedCallsign, setSelectedCallsign] = useState<string | null>(null);
  const [bridgeSpots, setBridgeSpots] = useState<MapStation[]>([]);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [showLiveActivity, setShowLiveActivity] = useState(true);
  const [showPropagationLayer, setShowPropagationLayer] = useState(false);
  const [showWeatherLayer, setShowWeatherLayer] = useState(false);
  const [storedMapTheme, setStoredMapTheme] = useState<MapTheme>(() => getStoredMapTheme());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refreshTheme = () => {
      setStoredMapTheme(getStoredMapTheme());
    };

    refreshTheme();
    window.addEventListener('storage', refreshTheme);
    window.addEventListener('focus', refreshTheme);

    return () => {
      window.removeEventListener('storage', refreshTheme);
      window.removeEventListener('focus', refreshTheme);
    };
  }, []);

  const activeMapTheme = mapTheme ?? storedMapTheme;

  const currentStation: StationProfile = {
    ...defaultStationProfile,
    ...stationProfile,
    operatorName: stationProfile?.operatorName || defaultStationProfile.operatorName,
    callsign: stationProfile?.callsign || defaultStationProfile.callsign,
    gridSquare: stationProfile?.gridSquare || defaultStationProfile.gridSquare,
    distanceUnit: stationProfile?.distanceUnit || defaultStationProfile.distanceUnit,
  };

  const normalizedGrid = useMemo(
    () => normalizeGridSquare(currentStation.gridSquare),
    [currentStation.gridSquare]
  );

  const myCoords = useMemo(
    () => maidenheadToLatLon(currentStation.gridSquare),
    [currentStation.gridSquare]
  );

  const fetchBridgeSpots = async () => {
    if (dataMode !== 'ONLINE' || !mapConnected || clusterSpots) return;

    setIsLoading(true);
    setFetchError(null);

    try {
      const response = await fetch(`${BRIDGE_BASE_URL}/api/spots?loadSize=25`);
      const payload = (await response.json()) as BridgeSpotsResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not load live spots from bridge.');
      }

      setBridgeConnected(true);
      setBridgeSpots(Array.isArray(payload.spots) ? payload.spots : []);
      setLastUpdated(payload.fetchedAt || new Date().toISOString());
    } catch (error) {
      setBridgeConnected(false);
      setBridgeSpots([]);
      setFetchError(error instanceof Error ? error.message : 'Unknown bridge error.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (dataMode === 'OFFLINE') {
      setBridgeSpots([]);
      setBridgeConnected(false);
      setFetchError(null);
      setLastUpdated(null);
      return;
    }

    void fetchBridgeSpots();
  }, [dataMode, mapConnected, clusterSpots]);

  const sourceStations = useMemo(() => {
    if (dataMode === 'ONLINE') {
      if (!mapConnected) return [];
      if (clusterSpots && clusterSpots.length > 0) return clusterSpots;
      return bridgeSpots;
    }

    return offlineStations;
  }, [bridgeSpots, clusterSpots, dataMode, mapConnected]);

  const plottedStations = useMemo(() => {
    return sourceStations
      .map((station) => {
        const dxCoords = maidenheadToLatLon(station.gridSquare);
        if (!dxCoords) return null;

        const submitterCoords =
          station.source === 'CLUSTERDX' && station.submitterGrid
            ? maidenheadToLatLon(station.submitterGrid)
            : null;

        const lineFrom = submitterCoords ?? myCoords;
        if (!lineFrom) return null;

        const distance = myCoords ? calculateDistanceKm(myCoords, dxCoords) : 0;
        const bearing = myCoords ? calculateBearing(myCoords, dxCoords) : 0;
        const compass = degreesToCompass(bearing);

        return {
          station,
          coords: dxCoords,
          lineFrom,
          distance,
          bearing,
          compass,
        };
      })
      .filter(Boolean) as Array<{
        station: MapStation;
        coords: LatLon;
        lineFrom: LatLon;
        distance: number;
        bearing: number;
        compass: string;
      }>;
  }, [myCoords, sourceStations]);

  const sourceSummary = useMemo(() => {
    if (dataMode === 'ONLINE' && !mapConnected) {
      return 'Online mode selected • ClusterDX offline';
    }

    if (dataMode === 'ONLINE' && isLoading) {
      return 'Online mode • Loading live spots...';
    }

    if (dataMode === 'ONLINE' && fetchError) {
      return 'Online mode • Bridge error';
    }

    if (dataMode === 'ONLINE' && bridgeConnected) {
      return `Online mode • Live ClusterDX • ${formatBridgeTime(lastUpdated)}`;
    }

    if (dataMode === 'ONLINE') {
      return 'Online mode • Waiting for bridge';
    }

    return 'Offline mode • Local station data';
  }, [bridgeConnected, dataMode, fetchError, isLoading, lastUpdated, mapConnected]);

  const propagationCircles = useMemo(() => {
    return [
      { center: [50, 14] as LatLngTuple, radius: 2100000, color: '#22c55e', opacity: 0.16 },
      { center: [47, -10] as LatLngTuple, radius: 1800000, color: '#22c55e', opacity: 0.12 },
      { center: [25, -78] as LatLngTuple, radius: 1300000, color: '#eab308', opacity: 0.14 },
      { center: [39, -92] as LatLngTuple, radius: 1900000, color: '#ef4444', opacity: 0.10 },
      { center: [14, 20] as LatLngTuple, radius: 1700000, color: '#ef4444', opacity: 0.08 },
      { center: [43, -58] as LatLngTuple, radius: 1400000, color: '#eab308', opacity: 0.10 },
    ];
  }, []);

  const hasWeatherApiKey = OPENWEATHER_API_KEY.trim().length > 0;

  if (!myCoords) {
    return (
      <section style={panelStyle}>
        <h2 style={titleStyle}>RDI Live Map</h2>
        <p style={subTitleStyle}>Could not calculate your station location from grid square.</p>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <div style={headerRowStyle}>
        <div>
          <h2 style={titleStyle}>RDI Live Map</h2>
          <p style={subTitleStyle}>Click spot for rotor heading</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {showLiveActivity && (
            <div style={clusterDxBadgeStyle}>
              <span style={{ ...legendDotStyle, background: '#22c55e' }} />
              ClusterDX spot
            </div>
          )}

          <div style={sourceBadgeStyle}>{sourceSummary}</div>

          {dataMode === 'ONLINE' && (
            <button
              type="button"
              style={refreshButtonStyle}
              onClick={() => void fetchBridgeSpots()}
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      <div style={{ ...mapWrapStyle, background: getMapBackground(activeMapTheme) }}>
        <MapContainer
          center={[42, -75]}
          zoom={3}
          minZoom={2}
          scrollWheelZoom={true}
          style={{ height: '600px', width: '100%' }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            url={getBaseMapUrl(activeMapTheme)}
          />

          {showPropagationLayer &&
            propagationCircles.map((region, index) => (
              <Circle
                key={`prop-${index}`}
                center={region.center}
                radius={region.radius}
                pathOptions={{
                  color: region.color,
                  weight: 0,
                  fillColor: region.color,
                  fillOpacity: region.opacity,
                }}
              />
            ))}

          {showWeatherLayer && hasWeatherApiKey && (
            <TileLayer
              url={buildOpenWeatherTileUrl('precipitation_new')}
              opacity={0.82}
              zIndex={350}
            />
          )}

          {showLiveActivity &&
            plottedStations.map(({ station, coords, lineFrom }) => (
              <Polyline
                key={`line-${station.callsign}-${station.gridSquare}-${station.utcTime ?? 'na'}`}
                positions={[
                  [lineFrom.lat, lineFrom.lon],
                  [coords.lat, coords.lon],
                ]}
                pathOptions={{
                  color:
                    station.source === 'CLUSTERDX'
                      ? 'rgba(34,197,94,0.72)'
                      : station.isActive
                        ? '#3b82f6'
                        : 'rgba(59,130,246,0.5)',
                  weight: station.isActive ? 2 : 1,
                }}
              />
            ))}

          {showLiveActivity && (
            <CircleMarker
              center={[myCoords.lat, myCoords.lon]}
              radius={8}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: '#ff5d5d',
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div style={popupContentStyle}>
                  <div style={popupCallsignStyle}>📍 {currentStation.callsign}</div>
                  <div><strong>Operator:</strong> {currentStation.operatorName}</div>
                  <div><strong>Grid:</strong> {normalizedGrid}</div>
                  <div><strong>Station:</strong> Your location</div>
                </div>
              </Popup>
            </CircleMarker>
          )}

          {showLiveActivity &&
            plottedStations.map(({ station, coords, distance, bearing, compass }) => (
              <CircleMarker
                key={`${station.callsign}-${station.gridSquare}-${station.utcTime ?? 'na'}`}
                center={[coords.lat, coords.lon]}
                radius={station.isActive ? 8 : 6}
                eventHandlers={{
                  click: () => setSelectedCallsign(station.callsign),
                }}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2,
                  fillColor: getMarkerColor(station),
                  fillOpacity: 0.95,
                }}
              >
                <Popup>
                  <div style={popupContentStyle}>
                    <div style={popupCallsignStyle}>
                      {getPrefixFlag(station.callsign)} {station.callsign}
                    </div>
                    <div><strong>Operator:</strong> {station.operatorName ?? 'Unknown'}</div>
                    <div><strong>Country:</strong> {station.country ?? 'Unknown'}</div>
                    <div><strong>Target grid:</strong> {station.gridSquare}</div>
                    <div><strong>Your grid:</strong> {normalizedGrid}</div>
                    <div><strong>Source:</strong> {getSourceLabel(station)}</div>
                    {station.frequency && <div><strong>Frequency:</strong> {station.frequency}</div>}
                    {station.mode && <div><strong>Mode:</strong> {station.mode}</div>}
                    {station.utcTime && <div><strong>UTC:</strong> {station.utcTime}</div>}
                    <hr style={ruleStyle} />
                    <div><strong>Distance:</strong> {formatDistance(distance, currentStation.distanceUnit)}</div>
                    <div><strong>Bearing:</strong> {Math.round(bearing)}°</div>
                    <div><strong>Direction:</strong> {compass}</div>
                    <div style={rotorTextStyle}>
                      Turn rotor to {Math.round(bearing)}°
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        {selectedCallsign && showLiveActivity && (
          <div style={statusStyle}>
            Selected: <strong>{selectedCallsign}</strong>
          </div>
        )}

        {showWeatherLayer && !hasWeatherApiKey && (
          <div style={weatherOverlayNoticeStyle}>
            Add <strong>VITE_OPENWEATHER_API_KEY</strong> to your .env file to enable live weather tiles.
          </div>
        )}

        {dataMode === 'ONLINE' && fetchError && (
          <div style={offlineOverlayStyle}>
            {fetchError}
          </div>
        )}

        {dataMode === 'ONLINE' && !fetchError && plottedStations.length === 0 && !isLoading && showLiveActivity && (
          <div style={offlineOverlayStyle}>
            No live spots were returned yet. Use Refresh after logging in to the bridge.
          </div>
        )}
      </div>

      <div style={layerBarStyle}>
        <div style={layerTopRowStyle}>
          <label style={layerChipStyle}>
            <input
              type="checkbox"
              checked={showLiveActivity}
              onChange={(event) => setShowLiveActivity(event.target.checked)}
            />
            <span>Live 11m Activity</span>
          </label>

          <label style={layerChipStyle}>
            <input
              type="checkbox"
              checked={showPropagationLayer}
              onChange={(event) => setShowPropagationLayer(event.target.checked)}
            />
            <span>11m Propagation Strength</span>
          </label>

          <label style={layerChipStyle}>
            <input
              type="checkbox"
              checked={showWeatherLayer}
              onChange={(event) => setShowWeatherLayer(event.target.checked)}
            />
            <span>Weather / Safety</span>
          </label>
        </div>

        <div style={layerBottomRowStyle}>
          <div style={layerGroupStyle}>
            {showLiveActivity ? (
              <div style={layerGroupItemsStyle}>
                <span style={layerKeyItemStyle}>
                  <span style={{ ...layerKeySwatchStyle, background: '#ff5d5d' }} />
                  Your station
                </span>
                <span style={layerKeyItemStyle}>
                  <span style={{ ...layerKeySwatchStyle, background: '#4da3ff' }} />
                  RDI member
                </span>
                <span style={layerKeyItemStyle}>
                  <span style={{ ...layerKeySwatchStyle, background: '#f5b301' }} />
                  Active RDI
                </span>
              </div>
            ) : (
              <div />
            )}
          </div>

          <div style={layerGroupStyle}>
            <div style={layerGroupItemsStyle}>
              <span style={layerKeyItemStyle}>
                <span style={{ ...layerKeySwatchStyle, background: 'rgba(34,197,94,0.85)' }} />
                Open
              </span>
              <span style={layerKeyItemStyle}>
                <span style={{ ...layerKeySwatchStyle, background: 'rgba(234,179,8,0.85)' }} />
                Fair
              </span>
              <span style={layerKeyItemStyle}>
                <span style={{ ...layerKeySwatchStyle, background: 'rgba(239,68,68,0.85)' }} />
                Weak
              </span>
            </div>
          </div>

          <div style={layerGroupStyle}>
            <div style={layerGroupItemsStyle}>
              <span style={layerKeyItemStyle}>
                <span style={{ ...layerKeySwatchStyle, background: 'rgba(59,130,246,0.95)' }} />
                Rain
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const panelStyle: CSSProperties = {
  borderRadius: '18px',
  background:
    'linear-gradient(180deg, rgba(17,24,39,0.96) 0%, rgba(15,23,42,0.96) 100%)',
  border: '1px solid rgba(148,163,184,0.22)',
  padding: '1rem',
  boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
  color: '#e5eef7',
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  marginBottom: '0.85rem',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.2rem',
  fontWeight: 700,
};

const subTitleStyle: CSSProperties = {
  margin: '0.2rem 0 0',
  fontSize: '0.9rem',
  color: '#9fb0c3',
};

const sourceBadgeStyle: CSSProperties = {
  background: 'rgba(30,41,59,0.9)',
  color: '#dbeafe',
  border: '1px solid rgba(96,165,250,0.4)',
  borderRadius: '999px',
  padding: '0.45rem 0.75rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const clusterDxBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  background: 'rgba(22,101,52,0.18)',
  color: '#dcfce7',
  border: '1px solid rgba(74,222,128,0.32)',
  borderRadius: '999px',
  padding: '0.45rem 0.75rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const refreshButtonStyle: CSSProperties = {
  background: 'rgba(70, 130, 220, 0.18)',
  color: '#dce9ff',
  border: '1px solid rgba(120, 170, 255, 0.28)',
  borderRadius: '10px',
  padding: '8px 10px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontWeight: 700,
};

const mapWrapStyle: CSSProperties = {
  position: 'relative',
  minHeight: '600px',
  borderRadius: '16px',
  overflow: 'hidden',
  background: '#dbe4ef',
};

const layerBarStyle: CSSProperties = {
  marginTop: '0.35rem',
  borderRadius: '12px',
  background: 'rgba(15,23,42,0.72)',
  border: '1px solid rgba(148,163,184,0.18)',
  padding: '0.42rem 0.75rem 0.55rem',
  color: '#e5eef7',
};

const layerTopRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '0.7rem',
  alignItems: 'center',
};

const layerBottomRowStyle: CSSProperties = {
  marginTop: '0.35rem',
  paddingTop: '0.38rem',
  borderTop: '1px solid rgba(148,163,184,0.12)',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '0.7rem',
  alignItems: 'start',
};

const layerChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.45rem',
  background: 'rgba(30,41,59,0.9)',
  border: '1px solid rgba(96,165,250,0.2)',
  borderRadius: '999px',
  padding: '0.48rem 0.7rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#e5eef7',
  whiteSpace: 'nowrap',
};

const layerGroupStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  minHeight: '22px',
};

const layerGroupItemsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.65rem',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.75rem',
  color: '#cbd5e1',
  textAlign: 'center',
};

const layerKeyItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
};

const layerKeySwatchStyle: CSSProperties = {
  width: '12px',
  height: '12px',
  borderRadius: '999px',
  display: 'inline-block',
};

const legendDotStyle: CSSProperties = {
  width: '10px',
  height: '10px',
  borderRadius: '999px',
  display: 'inline-block',
};

const statusStyle: CSSProperties = {
  position: 'absolute',
  top: '12px',
  right: '12px',
  background: 'rgba(15,23,42,0.84)',
  color: '#e5eef7',
  padding: '0.5rem 0.75rem',
  borderRadius: '10px',
  border: '1px solid rgba(148,163,184,0.25)',
  fontSize: '0.82rem',
  zIndex: 500,
};

const weatherOverlayNoticeStyle: CSSProperties = {
  position: 'absolute',
  left: '12px',
  right: '12px',
  bottom: '12px',
  background: 'rgba(15,23,42,0.86)',
  color: '#f8fafc',
  padding: '0.65rem 0.85rem',
  borderRadius: '10px',
  border: '1px solid rgba(96,165,250,0.35)',
  fontSize: '0.82rem',
  zIndex: 500,
};

const offlineOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  background: 'rgba(15,23,42,0.48)',
  color: '#f8fafc',
  fontWeight: 700,
  borderRadius: '12px',
  border: '1px solid rgba(148,163,184,0.25)',
  zIndex: 450,
  pointerEvents: 'none',
  padding: '16px',
};

const popupContentStyle: CSSProperties = {
  minWidth: '220px',
  color: '#111827',
  fontSize: '0.9rem',
  lineHeight: 1.45,
};

const popupCallsignStyle: CSSProperties = {
  fontSize: '1rem',
  fontWeight: 800,
  marginBottom: '0.45rem',
};

const rotorTextStyle: CSSProperties = {
  marginTop: '0.65rem',
  fontWeight: 800,
  color: '#b45309',
  fontSize: '1rem',
};

const ruleStyle: CSSProperties = {
  margin: '0.55rem 0',
  border: 'none',
  borderTop: '1px solid #d1d5db',
};