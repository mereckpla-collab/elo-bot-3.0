const { getSalas, saveSalas } = require('../database');
const { HAXBALL_ROOMS, SALA_OCCUPIED_AUTO_FREE_MS, SALA_CLOSED_AUTO_FREE_MS } = require('../config');

// Haxball no da ninguna forma de consultar desde afuera si una sala tiene
// jugadores o si sigue abierta (no hay API pública para eso). Como estas
// salas se abren a mano desde el navegador, el estado de cada una se maneja
// por "reporte": /salas entrega la primera libre y la marca como ocupada;
// la gente avisa con botones cuando se desocupa, se cae, etc. Si nadie
// avisa nunca, se libera sola pasado un tiempo para que no quede trabada.

function roomByCode(code) {
  return HAXBALL_ROOMS.find(r => r.code === code) || null;
}

function roomLink(code) {
  return `https://www.haxball.com/play?c=${code}`;
}

function autoExpire(salas) {
  const now = Date.now();
  let changed = false;
  for (const room of HAXBALL_ROOMS) {
    const entry = salas[room.code];
    if (!entry) continue;
    const limit = entry.status === 'ocupada' ? SALA_OCCUPIED_AUTO_FREE_MS
      : entry.status === 'caida' ? SALA_CLOSED_AUTO_FREE_MS
      : null;
    if (limit && now - entry.updatedAt > limit) {
      salas[room.code] = { status: 'libre', updatedAt: now, updatedBy: null };
      changed = true;
    }
  }
  return changed;
}

/** Busca la primera sala con estado "libre" (en orden de la lista). Null si no hay ninguna. */
function findFreeRoom() {
  const salas = getSalas();
  if (autoExpire(salas)) saveSalas(salas);
  const free = HAXBALL_ROOMS.find(r => (salas[r.code]?.status || 'libre') === 'libre');
  return free || null;
}

function setRoomStatus(code, status, userId) {
  const salas = getSalas();
  salas[code] = { status, updatedAt: Date.now(), updatedBy: userId };
  saveSalas(salas);
}

function getRoomStatus(code) {
  const salas = getSalas();
  return salas[code]?.status || 'libre';
}

/** Devuelve las 20 salas con su estado actual, para un panel/listado. */
function allStatuses() {
  const salas = getSalas();
  if (autoExpire(salas)) saveSalas(salas);
  return HAXBALL_ROOMS.map(r => ({ ...r, status: salas[r.code]?.status || 'libre' }));
}

module.exports = { roomByCode, roomLink, findFreeRoom, setRoomStatus, getRoomStatus, allStatuses };