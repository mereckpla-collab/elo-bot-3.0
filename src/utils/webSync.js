'use strict';
// Envía data/db.json a la página web (otro servidor) cada vez que el bot lo cambia.
// Solo funciona si defines WEB_SYNC_URL y WEB_SYNC_KEY en las variables del bot. Si no, no hace nada.
//   WEB_SYNC_URL = https://haxcore.wisp.uno/api/import/db
//   WEB_SYNC_KEY = la misma clave que EXPORT_KEY en la página (mínimo 16 caracteres)
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', '..', 'data', 'db.json');
let lastSent = 0;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const mtime = fs.statSync(DB_FILE).mtimeMs;
    if (mtime === lastSent) return;
    const text = fs.readFileSync(DB_FILE, 'utf8');
    JSON.parse(text); // si el bot estaba escribiendo y quedó a medias, no se envía (se reintenta)
    const r = await fetch(process.env.WEB_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Export-Key': process.env.WEB_SYNC_KEY },
      body: text,
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    lastSent = mtime;
  } catch (e) {
    console.error('[webSync] No se pudo enviar db.json a la web (se reintenta):', e.message);
  } finally { busy = false; }
}

function start() {
  if (!process.env.WEB_SYNC_URL || !process.env.WEB_SYNC_KEY) return;
  console.log('[webSync] Enviando db.json a', process.env.WEB_SYNC_URL);
  setInterval(tick, 10000).unref();
  tick();
}

module.exports = { start };
