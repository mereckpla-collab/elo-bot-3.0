const { PICK_TIMEOUT_MS, QUEUE_TIMEOUT_MS } = require('../config');

// La cola "de siempre" (legacy) guarda su config directo en guildData; cada
// modo creado con el wizard la guarda en guildData.modes[key]. Por eso
// `store` sirve igual para los dos casos.
function getStore(guildData, modeKey) {
  return modeKey ? guildData.modes?.[modeKey] : guildData;
}

function validMs(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Tiempo que tiene un capitán para pickear en ese modo.
function getPickTimeoutMs(guildData, modeKey) {
  return validMs(getStore(guildData, modeKey)?.pickTimeoutMs) ?? PICK_TIMEOUT_MS;
}

// Tiempo que puede estar alguien en la cola de ese modo antes de que lo
// saquen por inactividad (AFK).
function getQueueTimeoutMs(guildData, modeKey) {
  return validMs(getStore(guildData, modeKey)?.queueTimeoutMs) ?? QUEUE_TIMEOUT_MS;
}

// Decide sobre qué cola actúa el comando. `requested` es el valor de la
// opción `mode` ('default' = cola de siempre, o la key de un modo).
// Si no se eligió nada: sin modos creados actúa sobre la cola por defecto;
// con modos creados obliga a elegir uno para no tocar el equivocado.
function resolveTargetMode(guildData, requested) {
  const modes = Object.values(guildData.modes || {});

  if (!requested) {
    if (modes.length === 0) return { modeKey: null, store: guildData, label: 'la cola por defecto' };
    return { error: 'Hay varios modos en este servidor. Elegí cuál con la opción `mode`.' };
  }
  if (requested === 'default') return { modeKey: null, store: guildData, label: 'la cola por defecto' };

  const mode = guildData.modes?.[requested];
  if (!mode) return { error: 'Ese modo ya no existe. Usá `/mode list` para ver los actuales.' };
  return { modeKey: mode.key, store: mode, label: `el modo \`${mode.name}\`` };
}

// Opciones para el autocomplete de `mode`: la cola por defecto + los modos.
function modeChoices(guildData, focused) {
  const q = (focused || '').toLowerCase();
  const choices = [{ name: 'Cola por defecto (default)', value: 'default' }];
  for (const m of Object.values(guildData.modes || {})) {
    choices.push({ name: `${m.name} (${m.key})`.slice(0, 100), value: m.key });
  }
  return choices
    .filter(c => c.name.toLowerCase().includes(q) || c.value.includes(q))
    .slice(0, 25);
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min && sec) return `${min} min ${sec} s`;
  if (min) return `${min} min`;
  return `${sec} s`;
}

module.exports = {
  getPickTimeoutMs,
  getQueueTimeoutMs,
  resolveTargetMode,
  modeChoices,
  formatDuration
};