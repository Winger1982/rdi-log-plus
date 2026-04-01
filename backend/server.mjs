import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { URLSearchParams } from 'url';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const CLUSTER_BASE = 'https://clusterdx.org';
const LOGIN_URL = `${CLUSTER_BASE}/auth-login.php`;
const SPOTS_URL = `${CLUSTER_BASE}/New_ClusterDX/fetch_cluster_data.php`;
const PING_URL = `${CLUSTER_BASE}/auth/ping.php`;

let sessionCookie = '';
let loggedInUser = '';
let lastSpots = null;
let pingTimer = null;
let spotsTimer = null;

function extractCookie(setCookieHeader) {
  if (!setCookieHeader || !Array.isArray(setCookieHeader)) return '';
  return setCookieHeader.map((item) => item.split(';')[0]).join('; ');
}

function ensureLoggedIn() {
  if (!sessionCookie) {
    throw new Error('Not logged into ClusterDX.');
  }
}

async function loginToClusterDX(username, password) {
  const form = new URLSearchParams();
  form.append('username', username);
  form.append('password', password);
  form.append('remember_me', 'on');

  const response = await axios.post(LOGIN_URL, form.toString(), {
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${CLUSTER_BASE}/auth-login.php`,
      Origin: CLUSTER_BASE,
      'User-Agent': 'RDI-Live-Band-Console/1.0',
    },
  });

  const cookie = extractCookie(response.headers['set-cookie']);
  if (!cookie) {
    throw new Error('Login failed. No session cookie returned.');
  }

  sessionCookie = cookie;
  loggedInUser = username;
  return true;
}

async function fetchClusterSpots() {
  ensureLoggedIn();

  const response = await axios.get(SPOTS_URL, {
    headers: {
      Cookie: sessionCookie,
      Referer: `${CLUSTER_BASE}/index.php`,
      'User-Agent': 'RDI-Live-Band-Console/1.0',
      Accept: 'application/json, text/plain, */*',
    },
  });

  lastSpots = response.data;
  return response.data;
}

async function pingClusterDX() {
  ensureLoggedIn();

  await axios.get(PING_URL, {
    headers: {
      Cookie: sessionCookie,
      Referer: `${CLUSTER_BASE}/index.php`,
      'User-Agent': 'RDI-Live-Band-Console/1.0',
      Accept: '*/*',
    },
  });
}

function clearTimers() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  if (spotsTimer) {
    clearInterval(spotsTimer);
    spotsTimer = null;
  }
}

function startBackgroundRefresh() {
  clearTimers();

  pingTimer = setInterval(async () => {
    try {
      await pingClusterDX();
      console.log('ClusterDX ping ok');
    } catch (error) {
      console.error('ClusterDX ping failed:', error.message);
    }
  }, 20000);

  spotsTimer = setInterval(async () => {
    try {
      const data = await fetchClusterSpots();
      const count = Array.isArray(data?.data) ? data.data.length : 0;
      console.log(`ClusterDX spots refreshed: ${count}`);
    } catch (error) {
      console.error('ClusterDX spots refresh failed:', error.message);
    }
  }, 60000);
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'RDI ClusterDX backend bridge',
    loggedIn: Boolean(sessionCookie),
    user: loggedInUser || null,
  });
});

app.post('/api/clusterdx/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({
      ok: false,
      error: 'Username and password are required.',
    });
  }

  try {
    await loginToClusterDX(username, password);
    const spotData = await fetchClusterSpots();
    startBackgroundRefresh();

    return res.json({
      ok: true,
      message: 'Logged into ClusterDX successfully.',
      user: loggedInUser,
      initialSpotCount: Array.isArray(spotData?.data) ? spotData.data.length : 0,
    });
  } catch (error) {
    sessionCookie = '';
    loggedInUser = '';
    clearTimers();

    return res.status(500).json({
      ok: false,
      error: error.message || 'ClusterDX login failed.',
    });
  }
});

app.post('/api/clusterdx/logout', (_req, res) => {
  sessionCookie = '';
  loggedInUser = '';
  lastSpots = null;
  clearTimers();

  res.json({
    ok: true,
    message: 'Logged out of ClusterDX backend session.',
  });
});

app.get('/api/clusterdx/status', (_req, res) => {
  res.json({
    ok: true,
    loggedIn: Boolean(sessionCookie),
    user: loggedInUser || null,
    cachedSpotCount: Array.isArray(lastSpots?.data) ? lastSpots.data.length : 0,
  });
});

app.get('/api/clusterdx/spots', async (_req, res) => {
  try {
    const data = await fetchClusterSpots();

    res.json({
      ok: true,
      source: 'clusterdx',
      loggedIn: true,
      ...data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch ClusterDX spots.',
    });
  }
});

app.get('/api/clusterdx/spots/cached', (_req, res) => {
  res.json({
    ok: true,
    source: 'cache',
    loggedIn: Boolean(sessionCookie),
    ...(lastSpots || { data: [], meta: {} }),
  });
});

app.listen(PORT, () => {
  console.log(`RDI ClusterDX backend running on http://localhost:${PORT}`);
});