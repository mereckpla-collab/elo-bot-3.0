const https = require('https');

const API_HOST = 'api.mrhosthaxball.com';
const API_PATH = '/v1/rooms';
const POLL_INTERVAL_MS = 30 * 1000; // la doc pide consultar cada 30s, no en cada uso de comando

const cache = { rooms: [], summary: null, etag: null, lastFetch: 0, retryAfterUntil: 0 };
let pollTimer = null;

/**
 * Hace el GET a la API con https nativo de Node (en vez de fetch(), que
 * recién existe desde Node 18 — así funciona sin importar qué versión de
 * Node tenga el hosting). Devuelve { status, headers, body }.
 */
function httpsGet(host, pathName, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: pathName, method: 'GET', headers, timeout: 10000 }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchRooms() {
  if (Date.now() < cache.retryAfterUntil) return; // todavía en cooldown por un 429 anterior

  const apiKey = process.env.MRHOST_API_KEY;
  if (!apiKey) {
    console.warn('[mrhost] MRHOST_API_KEY no está configurado en el .env — /sala no va a tener datos.');
    return;
  }

  try {
    const headers = { 'X-API-Key': apiKey };
    if (cache.etag) headers['If-None-Match'] = cache.etag;

    const res = await httpsGet(API_HOST, API_PATH, headers);

    if (res.status === 304) {
      cache.lastFetch = Date.now();
      return;
    }
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers['retry-after'] || '30', 10);
      cache.retryAfterUntil = Date.now() + retryAfter * 1000;
      console.warn(`[mrhost] Rate limited (429). Reintentando en ${retryAfter}s.`);
      return;
    }
    if (res.status !== 200) {
      console.error(`[mrhost] La API respondió ${res.status}: ${res.body.slice(0, 200)}`);
      return;
    }

    const data = JSON.parse(res.body);
    cache.rooms = data.rooms || [];
    cache.summary = data.summary || null;
    if (res.headers.etag) cache.etag = res.headers.etag;
    cache.lastFetch = Date.now();
  } catch (err) {
    console.error('[mrhost] Error consultando la API de salas:', err.message);
  }
}

/** Arranca el polling de fondo. Se llama UNA sola vez, desde index.js. */
function startPolling() {
  if (pollTimer) return;
  fetchRooms();
  pollTimer = setInterval(fetchRooms, POLL_INTERVAL_MS);
}

function getRooms() {
  return cache.rooms;
}

function getSummary() {
  return cache.summary;
}

function getLastFetch() {
  return cache.lastFetch;
}

module.exports = { startPolling, fetchRooms, getRooms, getSummary, getLastFetch };