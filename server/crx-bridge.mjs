import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
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

const DXPROOF_PROPAGATION_URL =
  'https://www.dxproof.com/propagation_46860.asp';

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

async function requireActiveRdiMember(userId) {
  const { data, error } = await supabaseAdmin
    .from('rdi_members')
    .select('callsign, active')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to verify RDI membership: ${error.message}`);
  }

  if (!data) {
    throw new Error('Active RDI membership is required.');
  }

  return data.callsign;
}

async function loadActiveRdiMembers() {
  const { data, error } = await supabaseAdmin
    .from('rdi_members')
    .select('callsign, display_name')
    .eq('active', true);

  if (error) {
    throw new Error(
      `Unable to load active RDI members: ${error.message}`,
    );
  }

  return new Map(
    (data || []).map((member) => [
      String(member.callsign || '').trim().toUpperCase(),
      member.display_name || '',
    ]),
  );
}

async function saveEncryptedCrxCredential(userId, apiKey) {
  const encrypted = encryptCrxApiKey(apiKey);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('crx_credentials')
    .upsert(
      {
        user_id: userId,
        encrypted_api_key: encrypted.encryptedApiKey,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        last_verified_at: now,
        updated_at: now,
      },
      {
        onConflict: 'user_id',
      },
    );

  if (error) {
    throw new Error(
      `Unable to save CRX credential: ${error.message}`,
    );
  }
}

async function loadSavedCrxApiKey(userId) {
  const { data, error } = await supabaseAdmin
    .from('crx_credentials')
    .select('encrypted_api_key, iv, auth_tag')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load CRX credential: ${error.message}`,
    );
  }

  if (!data) {
    return '';
  }

  return decryptCrxApiKey({
    encryptedApiKey: data.encrypted_api_key,
    iv: data.iv,
    authTag: data.auth_tag,
  });
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
    const userId = await getAuthenticatedUserId(req);
    await requireActiveRdiMember(userId);

    const apiKey = String(req.body?.apiKey || '').trim();

    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: 'CRX API key is required.',
      });
    }

    await crxRequest('get_spots_on_map/11m/1', {}, apiKey);

    await saveEncryptedCrxCredential(userId, apiKey);

    return res.json({
      ok: true,
      message: 'CRX API key accepted and saved securely.',
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
),

longitude: firstValue(
  spot.dx_lon,
),
hasLocation: Boolean(
  gridSquare ||
  (firstValue(spot.dx_lat) &&
   firstValue(spot.dx_lon))
),
  };
}

app.get('/api/spots', async (req, res) => {
  try {
const userId = await getAuthenticatedUserId(req);
await requireActiveRdiMember(userId);

const savedApiKey = await loadSavedCrxApiKey(userId);

let apiKey = savedApiKey;
let keySource = savedApiKey ? 'saved-member' : 'server';
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
  const rdiMembers = await loadActiveRdiMembers();

  const spots = rawSpots.map((spot) => {
  const normalizedSpot = normalizeCrxSpot(spot);
  const isRdiMember = rdiMembers.has(normalizedSpot.callsign);

  return {
    ...normalizedSpot,
    isRDI: isRdiMember,
    isActive: isRdiMember,
  };
});

    return res.json({
      ok: true,
      source: 'CRX',
      keySource,
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

async function fetchDxproofDayNight() {
  const response = await axios.get(DXPROOF_PROPAGATION_URL, {
    timeout: 15000,
    headers: {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  Referer: 'https://www.dxproof.com/',
  Origin: 'https://www.dxproof.com',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'iframe',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
   },
  });

  const html = typeof response.data === 'string' ? response.data : '';
  if (!html) {
    throw new Error('DXProof returned empty content.');
  }

  const $ = cheerio.load(html);
  const metricBlocks = $('div[style*="border-radius: 5px"]');

  const readBlockValue = (index) =>
    metricBlocks.eq(index).find('span').last().text().trim();

  return {
    dayCondition: readBlockValue(0) || 'Unknown',
    nightCondition: readBlockValue(1) || 'Unknown',
  };
}

app.get('/api/propagation-test', async (_req, res) => {
  try {
    const dayNightPromise = fetchDxproofDayNight().catch((error) => {
  console.error(
    'DXProof Day/Night fetch failed:',
    error instanceof Error ? error.message : error,
  );

  return {
    dayCondition: 'Unknown',
    nightCondition: 'Unknown',
  };
});
    const [
  dayNight,
  fluxResponse,
  kpResponse,
  sunspotResponse,
  auroraResponse,
] = await Promise.all([
  dayNightPromise,
    
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
  dayCondition: dayNight.dayCondition,
  nightCondition: dayNight.nightCondition,
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
