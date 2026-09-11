import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || process.env.CRX_BRIDGE_PORT || 8790);

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://rdi-log-plus.vercel.app',
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

const CRX_API_URL =
  process.env.CRX_API_URL || 'https://s.crx.cloud/api/';
const SUPABASE_URL = String(
  process.env.SUPABASE_URL || '',
).trim();

const SUPABASE_SECRET_KEY = String(
  process.env.SUPABASE_SECRET_KEY || '',
).trim();

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

app.use(express.json());

const crxClient = axios.create({
  baseURL: CRX_API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

function getApiKey() {
  const apiKey = String(process.env.CRX_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('CRX_API_KEY is not configured.');
  }

  return apiKey;
}

function getEncryptionKey() {
  const encodedKey = String(
    process.env.CRX_ENCRYPTION_KEY || '',
  ).trim();

  if (!encodedKey) {
    throw new Error('CRX_ENCRYPTION_KEY is not configured.');
  }

  const key = Buffer.from(encodedKey, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'CRX_ENCRYPTION_KEY must decode to exactly 32 bytes.',
    );
  }

  return key;
}

function encryptCrxApiKey(apiKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(apiKey, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedApiKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptCrxApiKey({
  encryptedApiKey,
  iv,
  authTag,
}) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(iv, 'base64'),
  );

  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(encryptedApiKey, 'base64'),
    ),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

async function getAuthenticatedUserId(req) {
  const authorization = String(
    req.headers.authorization || '',
  ).trim();

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new Error('Missing Supabase access token.');
  }

  const accessToken = match[1];

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error('Invalid or expired Supabase session.');
  }

  return user.id;
}

async function crxRequest(query, extra = {}, apiKeyOverride = '') {
  const apiKey =
    String(apiKeyOverride || '').trim() || getApiKey();

  const response = await crxClient.post('', {
    req: {
      type: 'radio',
      query,
      apikey: apiKey,
      ...extra,
    },
  });

  if (response.data?.error) {
    throw new Error(response.data.error);
  }

  return response.data;
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'RDI Log Plus CRX Bridge',
    apiUrl: CRX_API_URL,
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'RDI Log Plus CRX Bridge',
  });
});

app.get('/api/crx/health', async (_req, res) => {
  try {
    const data = await crxRequest('health_check');

    return res.json({
      ok: true,
      crx: data,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'CRX health check failed.',
    });
  }
});

app.post('/api/crx/test-key', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();

    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: 'CRX API key is required.',
      });
    }

    await crxRequest('health_check', {}, apiKey);

    return res.json({
      ok: true,
      message: 'CRX API key accepted.',
    });
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'CRX API key test failed.',
    });
  }
});

app.get('/api/crx/spots-test', async (_req, res) => {
  try {
    const data = await crxRequest('get_spots/11m/10', {
      sortby: 'time',
      groupby: '1',
    });

    return res.json({
      ok: true,
      count: Array.isArray(data?.spots) ? data.spots.length : 0,
      spots: Array.isArray(data?.spots) ? data.spots : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'CRX spots test failed.',
      crxResponse: error?.response?.data ?? null,
    });
  }
});
app.get('/api/crx/map-test', async (_req, res) => {
  try {
    const data = await crxRequest('get_spots_on_map/11m/10');

    return res.json({
      ok: true,
      count: Array.isArray(data?.spots) ? data.spots.length : 0,
      spots: Array.isArray(data?.spots) ? data.spots : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'CRX map test failed.',
      crxResponse: error?.response?.data ?? null,
    });
  }
});
function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}
function normalizeFrequency(value) {
  const raw = firstValue(value);
  if (!raw) return '';

  const numeric = Number(raw.replace(',', '.'));
  if (!Number.isFinite(numeric)) return raw;

  // CRX often returns 11m frequency in kHz.
  // Example: 27555 becomes 27.555 MHz.
  if (numeric >= 1000) {
    return (numeric / 1000).toFixed(3);
  }

  return numeric.toFixed(3);
}

function normalizeUtcTime(spot) {
  const raw = firstValue(
    spot.date_spot,
    spot.time,
    spot.timestamp,
    spot.datetime,
  );

  if (!raw) return '';

  // Unix timestamp in seconds.
  if (/^\d{9,11}$/.test(raw)) {
    const date = new Date(Number(raw) * 1000);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(11, 16);
    }
  }

  return raw;
}

function normalizeCrxSpot(spot) {
  const gridSquare = firstValue(
    spot.locator_dx,
    spot.dx_locator,
    spot.grid_dx,
    spot.gridSquare,
  ).toUpperCase();

  const submitterGrid = firstValue(
    spot.locator_sender,
    spot.spotter_locator,
    spot.grid_sender,
    spot.submitterGrid,
  ).toUpperCase();

  return {
    callsign: firstValue(
      spot.callsign_dx,
      spot.spotcall,
      spot.callsign,
    ).toUpperCase(),

    gridSquare,

    submitterGrid,

    country: firstValue(
      spot.country_dx,
      spot.dx_country,
      spot.country,
    ),

    source: 'CRX',

    frequency: normalizeFrequency(
      firstValue(
        spot.frequency,
        spot.freq,
      ),
    ),

    mode: firstValue(
      spot.mode,
      spot.modulation,
    ).toUpperCase(),

    utcTime: normalizeUtcTime(spot),

    spotter: firstValue(
      spot.callsign_sender,
      spot.spotter,
    ).toUpperCase(),

    report: firstValue(
      spot.report,
      spot.rst,
    ),

    comment: firstValue(
      spot.comment,
      spot.comments,
    ),

    crxSource: firstValue(
      spot.source,
      spot.net,
    ),
latitude: firstValue(
  spot.dx_lat,
  spot.latitude,
  spot.lat,
),

longitude: firstValue(
  spot.dx_lon,
  spot.longitude,
  spot.lon,
),
hasLocation: Boolean(
  gridSquare ||
  (firstValue(spot.dx_lat, spot.latitude, spot.lat) &&
   firstValue(spot.dx_lon, spot.longitude, spot.lon))
),
  };
}

app.get('/api/crx/spots-normalized-test', async (_req, res) => {
  try {
    const data = await crxRequest('get_spots_on_map/11m/10');

    const rawSpots = Array.isArray(data?.spots) ? data.spots : [];
    const spots = rawSpots.map(normalizeCrxSpot);

    return res.json({
      ok: true,
      count: spots.length,
      mappableCount: spots.filter((spot) => spot.hasLocation).length,
      fetchedAt: new Date().toISOString(),
      spots,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'CRX normalized spots test failed.',
      crxResponse: error?.response?.data ?? null,
    });
  }
});
app.get('/api/spots', async (req, res) => {
  try {
    const apiKey = String(req.headers['x-crx-api-key'] || '').trim();
    const requestedSize = Number.parseInt(
      String(req.query.loadSize || '25'),
      10,
    );

    const loadSize = Number.isFinite(requestedSize)
      ? Math.min(100, Math.max(1, requestedSize))
      : 25;

    const data = await crxRequest(
  `get_spots_on_map/11m/${loadSize}`,
  {},
  apiKey,
);

    const rawSpots = Array.isArray(data?.spots) ? data.spots : [];
    const spots = rawSpots.map(normalizeCrxSpot);

    return res.json({
      ok: true,
      source: 'CRX',
      keySource: apiKey ? 'member' : 'server',
      count: spots.length,
      mappableCount: spots.filter((spot) => spot.hasLocation).length,
      fetchedAt: new Date().toISOString(),
      spots,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'CRX',
      error:
        error instanceof Error
          ? error.message
          : 'Could not load CRX 11m spots.',
      crxResponse: error?.response?.data ?? null,
    });
  }
});
app.get('/api/propagation-test', async (_req, res) => {
  try {
    const [fluxResponse, kpResponse, sunspotResponse, auroraResponse] =
  await Promise.all([
    axios.get('https://services.swpc.noaa.gov/json/f107_cm_flux.json', {
      timeout: 15000,
    }),
    axios.get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', {
      timeout: 15000,
    }),
    axios.get('https://services.swpc.noaa.gov/json/solar-cycle/swpc_observed_ssn.json', {
      timeout: 15000,
    }),
    axios.get('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', {
      timeout: 15000,
    }),
  ]);

    const fluxRecords = Array.isArray(fluxResponse.data)
  ? fluxResponse.data
  : [];

const kpRecords = Array.isArray(kpResponse.data)
  ? kpResponse.data
  : [];

const latestFlux = fluxRecords
  .filter((item) => item?.time_tag)
  .sort(
    (a, b) =>
      new Date(b.time_tag).getTime() -
      new Date(a.time_tag).getTime(),
  )[0];

const latestKp = kpRecords
  .filter((item) => item?.time_tag)
  .sort(
    (a, b) =>
      new Date(b.time_tag).getTime() -
      new Date(a.time_tag).getTime(),
  )[0];
    
const sunspotRecords = Array.isArray(sunspotResponse.data)
  ? sunspotResponse.data
  : [];

const auroraData = auroraResponse.data ?? null;
    
const auroraCoordinates = Array.isArray(auroraData?.coordinates)
  ? auroraData.coordinates
  : [];

const auroraMax = auroraCoordinates.reduce((maxValue, item) => {
  const value = Array.isArray(item) ? Number(item[2]) : Number.NaN;
  return Number.isFinite(value) ? Math.max(maxValue, value) : maxValue;
}, 0);  
    
const latestSunspot = sunspotRecords
  .filter((item) => item?.Obsdate)
  .sort(
    (a, b) =>
      new Date(b.Obsdate).getTime() -
      new Date(a.Obsdate).getTime(),
  )[0];
    
return res.json({
  ok: true,
  source: 'NOAA SWPC',
  fetchedAt: new Date().toISOString(),
  solarFlux: latestFlux?.flux ?? null,
  solarFluxTime: latestFlux?.time_tag ?? null,
  aIndex: latestKp?.a_running ?? null,
  kIndex: latestKp?.Kp ?? null,
  kIndexTime: latestKp?.time_tag ?? null,
  sunspots: latestSunspot?.swpc_ssn ?? null,
  sunspotsTime: latestSunspot?.Obsdate ?? null,
  aurora: auroraMax,
  auroraTime: auroraData?.['Observation Time'] ?? null,
});
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'NOAA SWPC',
      error:
        error instanceof Error
          ? error.message
          : 'Could not load NOAA propagation data.',
    });
  }
});
app.listen(PORT, () => {
  console.log(`RDI Log Plus CRX bridge running on port ${PORT}`);
  console.log(`CRX API: ${CRX_API_URL}`);
  console.log(`Allowed frontend origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
