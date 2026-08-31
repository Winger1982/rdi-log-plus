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

app.listen(PORT, () => {
  console.log(`RDI Log Plus CRX bridge running on port ${PORT}`);
  console.log(`CRX API: ${CRX_API_URL}`);
  console.log(`Allowed frontend origin: ${FRONTEND_ORIGIN}`);
});
