import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || process.env.CRX_BRIDGE_PORT || 8790);

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

const CRX_API_URL =
  process.env.CRX_API_URL || 'https://s.crx.cloud/api/';

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
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

async function crxRequest(query, extra = {}) {
  const apiKey = getApiKey();

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
    const data = await crxRequest('get_spots_on_map/11m/1');

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

    hasLocation: Boolean(gridSquare),
  };
}

app.get('/api/crx/spots-normalized-test', async (_req, res) => {
  try {
    const data = await crxRequest('get_spots/11m/10', {
      sortby: 'time',
      groupby: '1',
    });

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
    const requestedSize = Number.parseInt(
      String(req.query.loadSize || '25'),
      10,
    );

    const loadSize = Number.isFinite(requestedSize)
      ? Math.min(100, Math.max(1, requestedSize))
      : 25;

    const data = await crxRequest(`get_spots/11m/${loadSize}`, {
      sortby: 'time',
      groupby: '1',
    });

    const rawSpots = Array.isArray(data?.spots) ? data.spots : [];
    const spots = rawSpots.map(normalizeCrxSpot);

    return res.json({
      ok: true,
      source: 'CRX',
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
app.listen(PORT, () => {
  console.log(`RDI Log Plus CRX bridge running on port ${PORT}`);
  console.log(`CRX API: ${CRX_API_URL}`);
  console.log(`Allowed frontend origin: ${FRONTEND_ORIGIN}`);
});
