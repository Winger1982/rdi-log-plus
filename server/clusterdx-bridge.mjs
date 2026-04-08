import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || process.env.CLUSTERDX_BRIDGE_PORT || 8787);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json());

const CLUSTERDX_BASE_URL = process.env.CLUSTERDX_BASE_URL || 'https://clusterdx.org';
const CLUSTERDX_LOGIN_URL =
  process.env.CLUSTERDX_LOGIN_URL || `${CLUSTERDX_BASE_URL}/auth-login.php`;

const CLUSTERDX_SPOTS_URL =
  process.env.CLUSTERDX_SPOTS_URL || `${CLUSTERDX_BASE_URL}/spots.php`;

const CLUSTERDX_LIVE_CLUSTER_URL =
  process.env.CLUSTERDX_LIVE_CLUSTER_URL ||
  `${CLUSTERDX_BASE_URL}/New_ClusterDX/fetch_cluster_data.php`;

const DXPROOF_PROPAGATION_URL =
  process.env.DXPROOF_PROPAGATION_URL ||
  'https://www.dxproof.com/propagation_46860.asp';

const DEFAULT_LOAD_SIZE = Number(process.env.CLUSTERDX_DEFAULT_LOAD_SIZE || 25);

const jar = new CookieJar();

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    maxRedirects: 5,
  }),
);

let authState = {
  loggedIn: false,
  lastLoginAt: null,
  lastFetchAt: null,
  lastError: null,
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectMode(text) {
  const upper = String(text || '').toUpperCase();
  if (upper.includes('USB')) return 'USB';
  if (upper.includes('LSB')) return 'LSB';
  if (upper.includes('AM')) return 'AM';
  if (upper.includes('FM')) return 'FM';
  if (upper.includes('CW')) return 'CW';
  return '';
}

function inferCountryFromCallsign(callsign) {
  const call = String(callsign || '').toUpperCase();

  if (call.startsWith('9RDI') || call.startsWith('VE') || call.startsWith('VA')) return 'Canada';
  if (call.startsWith('44') || call.startsWith('26') || call.startsWith('2E') || call.startsWith('M')) return 'United Kingdom';
  if (call.startsWith('14')) return 'France';
  if (call.startsWith('1')) return 'Italy';
  if (call.startsWith('13')) return 'Germany';
  if (call.startsWith('30')) return 'Spain';
  if (call.startsWith('2')) return 'France';

  return '';
}

function looksLikeGrid(value) {
  return /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(String(value || '').trim());
}

function textToStation(raw = {}) {
  const callsign = normalizeWhitespace(raw.callsign);
  const gridSquare = normalizeWhitespace(raw.gridSquare).toUpperCase();
  const frequency = normalizeWhitespace(raw.frequency);
  const mode = normalizeWhitespace(raw.mode || detectMode(raw.rawText));
  const utcTime = normalizeWhitespace(raw.utcTime);
  const country = normalizeWhitespace(raw.country || inferCountryFromCallsign(callsign));

  if (!callsign || !gridSquare || !looksLikeGrid(gridSquare)) {
    return null;
  }

  return {
    callsign,
    operatorName: raw.operatorName ? normalizeWhitespace(raw.operatorName) : undefined,
    gridSquare,
    country: country || undefined,
    isRDI: callsign.toUpperCase().includes('RDI'),
    isActive: false,
    source: 'CLUSTERDX',
    frequency: frequency || undefined,
    mode: mode || undefined,
    utcTime: utcTime || undefined,
    submitterGrid: raw.submitterGrid
      ? normalizeWhitespace(raw.submitterGrid).toUpperCase()
      : undefined,
  };
}

function parseJsonSpots(payload, loadSize = DEFAULT_LOAD_SIZE) {
  if (!payload) return [];

  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.spots)
      ? payload.spots
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  const results = items
    .map((item) => {
      const dxCall = item.DX || item.dx || item.dxCall || item.callsign || item.call;
      const dxGrid = item.loc_DX || item.grid || item.gridSquare || item.locator;
      const submitter = item.SUBMITTER || item.operatorName || item.operator || item.name;
      const submitterGrid = item.loc_SUBMITTER || '';
      const frequencyRaw = String(item.FREQUENCY || item.frequency || item.freq || '').trim();

      const frequency =
        frequencyRaw && /^\d+$/.test(frequencyRaw)
          ? `${frequencyRaw.slice(0, 2)}.${frequencyRaw.slice(2)}`
          : frequencyRaw;

      return textToStation({
        callsign: dxCall,
        operatorName: submitter,
        gridSquare: dxGrid,
        submitterGrid,
        country: item.country_dx || item.country || inferCountryFromCallsign(dxCall),
        frequency,
        mode: item.MODE || item.mode,
        utcTime: item.UTC || item.utc || item.utcTime || item.time,
        rawText: JSON.stringify(item),
      });
    })
    .filter(Boolean);

  const seen = new Set();

  const deduped = results.filter((item) => {
    const key = `${item.callsign}|${item.utcTime || ''}|${item.frequency || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, loadSize);
}

function parsePropagationHtml(html) {
  const $ = cheerio.load(html);

  const titleText =
    normalizeWhitespace($('title').text()) ||
    normalizeWhitespace($('span:contains("11M Band Propagation")').first().text());

  const metricBlocks = $('div[style*="border-radius: 5px"]');

  if (!metricBlocks.length || metricBlocks.length < 8) {
    throw new Error('Unable to locate propagation metric blocks in banner HTML.');
  }

  const readBlockValue = (index) =>
    normalizeWhitespace(metricBlocks.eq(index).find('span').last().text());

  const dayCondition = readBlockValue(0) || 'Unknown';
  const nightCondition = readBlockValue(1) || 'Unknown';
  const solarFlux = readBlockValue(2) || '—';
  const sunspots = readBlockValue(3) || '—';
  const aIndex = readBlockValue(4) || '—';
  const kIndex = readBlockValue(5) || '—';
  const aurora = readBlockValue(7) || '—';

  return {
    dayCondition,
    nightCondition,
    solarFlux,
    sunspots,
    aIndex,
    kIndex,
    aurora,
    updatedAt: titleText || null,
    sourceUrl: DXPROOF_PROPAGATION_URL,
  };
}

async function fetchPropagationData() {
  const response = await client.get(DXPROOF_PROPAGATION_URL, {
    headers: {
      Referer: 'https://www.dxproof.com/',
      Origin: 'https://www.dxproof.com',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status !== 200) {
    throw new Error(`Request failed with status code ${response.status}`);
  }

  const html = typeof response.data === 'string' ? response.data : '';
  if (!html) {
    throw new Error('Propagation source returned empty content.');
  }

  return parsePropagationHtml(html);
}

async function fetchLoginPage() {
  const response = await client.get(CLUSTERDX_LOGIN_URL);
  const html = typeof response.data === 'string' ? response.data : '';
  const $ = cheerio.load(html);

  const csrfToken = $('input[name="csrf_token"]').attr('value') || '';
  const hpField = $('input[name="hp_field"]').attr('value') || '';

  return {
    response,
    csrfToken,
    hpField,
  };
}

function buildLoginForm({
  username,
  password,
  rememberMe = true,
  csrfToken = '',
  hpField = '',
}) {
  const form = new URLSearchParams();

  form.set('csrf_token', csrfToken);
  form.set('hp_field', hpField);
  form.set('username', username);
  form.set('password', password);

  if (rememberMe) {
    form.set('remember_me', '1');
  }

  return form;
}

async function loginToClusterDx({
  username,
  password,
  rememberMe = true,
}) {
  authState.lastError = null;

  const loginPage = await fetchLoginPage();

  const body = buildLoginForm({
    username,
    password,
    rememberMe,
    csrfToken: loginPage.csrfToken,
    hpField: loginPage.hpField,
  });

  const response = await client.post(CLUSTERDX_LOGIN_URL, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html,application/xhtml+xml',
      Origin: CLUSTERDX_BASE_URL,
      Referer: CLUSTERDX_LOGIN_URL,
    },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const redirectLocation = response.headers?.location || '';

  const redirectedToApp =
    response.status === 302 &&
    redirectLocation &&
    !redirectLocation.includes('auth-login.php');

  if (!redirectedToApp) {
    authState.loggedIn = false;
    authState.lastError = 'ClusterDX login failed. Check username/password or form field names.';
    throw new Error(authState.lastError);
  }

  authState.loggedIn = true;
  authState.lastLoginAt = new Date().toISOString();
  authState.lastError = null;

  return true;
}

async function fetchClusterDxSpots({ loadSize = DEFAULT_LOAD_SIZE }) {
  authState.lastError = null;

  const liveUrl = new URL(CLUSTERDX_LIVE_CLUSTER_URL);
  liveUrl.searchParams.set('_ts', String(Date.now()));

  const response = await client.get(liveUrl.toString(), {
    headers: {
      Referer: `${CLUSTERDX_BASE_URL}/infusions/spots_map/spots_map.php`,
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  authState.lastFetchAt = new Date().toISOString();

  if (typeof response.data === 'object' && response.data !== null) {
    const liveSpots = parseJsonSpots(response.data, loadSize);
    if (liveSpots.length > 0) return liveSpots;
  }

  return [];
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'RDI Log Plus ClusterDX Bridge',
    loggedIn: authState.loggedIn,
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'RDI Log Plus ClusterDX Bridge',
    loggedIn: authState.loggedIn,
    lastLoginAt: authState.lastLoginAt,
    lastFetchAt: authState.lastFetchAt,
    lastError: authState.lastError,
  });
});

app.get('/api/status', async (_req, res) => {
  res.json({
    ok: true,
    bridge: 'ClusterDX',
    loggedIn: authState.loggedIn,
    lastLoginAt: authState.lastLoginAt,
    lastFetchAt: authState.lastFetchAt,
    lastError: authState.lastError,
    loginUrl: CLUSTERDX_LOGIN_URL,
    spotsUrl: CLUSTERDX_SPOTS_URL,
  });
});

app.get('/api/propagation', async (_req, res) => {
  try {
    const propagation = await fetchPropagationData();

    res.json({
      ok: true,
      ...propagation,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Propagation fetch failed.',
      sourceUrl: DXPROOF_PROPAGATION_URL,
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const rememberMe = req.body?.rememberMe !== false;

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Missing username or password.',
      });
    }

    await loginToClusterDx({ username, password, rememberMe });

    return res.json({
      ok: true,
      loggedIn: true,
      lastLoginAt: authState.lastLoginAt,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Login failed.',
    });
  }
});

app.get('/api/spots', async (req, res) => {
  try {
    const loadSize = Number(req.query.loadSize || DEFAULT_LOAD_SIZE);

    if (!authState.loggedIn) {
      return res.status(401).json({
        ok: false,
        error: 'Not logged in to ClusterDX yet.',
      });
    }

    const spots = await fetchClusterDxSpots({ loadSize });

    return res.json({
      ok: true,
      count: spots.length,
      loadSize,
      fetchedAt: authState.lastFetchAt,
      spots,
    });
  } catch (error) {
    authState.lastError = error instanceof Error ? error.message : 'Fetch failed.';

    return res.status(500).json({
      ok: false,
      error: authState.lastError,
    });
  }
});

app.post('/api/logout', async (_req, res) => {
  try {
    await new Promise((resolve, reject) => {
      jar.removeAllCookies((err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    authState = {
      loggedIn: false,
      lastLoginAt: null,
      lastFetchAt: null,
      lastError: null,
    };

    return res.json({ ok: true, loggedIn: false });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Logout failed.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`ClusterDX bridge running on port ${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_ORIGIN}`);
  console.log(`Login URL: ${CLUSTERDX_LOGIN_URL}`);
  console.log(`Spots URL: ${CLUSTERDX_SPOTS_URL}`);
  console.log(`Propagation URL: ${DXPROOF_PROPAGATION_URL}`);
});