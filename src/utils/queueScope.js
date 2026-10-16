// Todo lo que tenga que ver con "a qué cola/modo aplica este comando" vive
// acá, para que /crear_rol, /crear_categoria, /ver_roles, etc. se comporten
// todos igual: si el servidor tiene una sola cola, no preguntan nada; si
// tiene varias, exigen la opción `modo` (con autocompletado) para no dejar
// ambigüedad — el mismo criterio que ya usa /revertir.

function resolveQueueOptions(guildData) {
  const options = [];
  if (guildData.channels.queue) options.push({ key: 'default', label: 'Cola por defecto' });
  for (const mode of Object.values(guildData.modes || {})) {
    options.push({ key: mode.key, label: mode.name });
  }
  return options;
}

function storeForModeKey(guildData, modeKey) {
  return modeKey ? guildData.modes[modeKey] : guildData;
}

/**
 * Resuelve el modeKey final (null = cola por defecto) a partir de la opción
 * 'modo' que mandó el usuario. Si no la mandó, resuelve solo si hay una
 * única cola posible. Devuelve { ok:true, modeKey, label } o
 * { ok:false, message }.
 */
function resolveModeKeyFromInput(guildData, modoInput) {
  const queueOptions = resolveQueueOptions(guildData);

  if (modoInput) {
    const found = queueOptions.find(o => o.key === modoInput);
    if (!found) {
      return { ok: false, message: 'Ese modo no existe. Usá `/mode list` para ver los disponibles, o dejá el campo vacío si solo hay una cola.' };
    }
    return { ok: true, modeKey: found.key === 'default' ? null : found.key, label: found.label };
  }

  if (queueOptions.length === 0) {
    return { ok: false, message: 'Este servidor todavía no tiene ninguna cola configurada.' };
  }
  if (queueOptions.length === 1) {
    return { ok: true, modeKey: queueOptions[0].key === 'default' ? null : queueOptions[0].key, label: queueOptions[0].label };
  }
  return {
    ok: false,
    message: `Este servidor tiene ${queueOptions.length} colas/modos — especificá en cuál con la opción \`modo\`:\n` +
      queueOptions.map(o => `• \`${o.key}\` — ${o.label}`).join('\n')
  };
}

async function autocompleteModo(interaction, guildData) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = resolveQueueOptions(guildData)
    .filter(o => o.key.includes(focused) || o.label.toLowerCase().includes(focused))
    .map(o => ({ name: o.key === 'default' ? 'Cola por defecto' : `${o.label} (${o.key})`.slice(0, 100), value: o.key }));
  return interaction.respond(choices.slice(0, 25));
}

module.exports = { resolveQueueOptions, storeForModeKey, resolveModeKeyFromInput, autocompleteModo };
