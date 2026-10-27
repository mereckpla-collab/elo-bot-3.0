const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild, getOrCreatePlayer, healAllBrokenNames } = require('../database');
const { errorEmbed, successEmbed, playerStatsEmbed, leaderboardEmbed, leaderboardComponents } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { checkAndGrantAchievements } = require('../handlers/achievements');
const { COLOR_PRIMARY, ELO_FLOOR } = require('../config');
const { gameEmbed, historyEmbed, matchupEmbed, serverEmbed, teamGraphEmbed } = require('../utils/statsExtra');

/**
 * Arma la gráfica de evolución de elo (línea) usando QuickChart.io — un
 * servicio gratis que renderiza el gráfico y devuelve una URL de imagen
 * directa, sin que el bot tenga que instalar ninguna librería de canvas
 * (esas suelen dar problemas de compilación en varios hostings). Discord
 * descarga la imagen solo con ponerla en .setImage(url).
 */
function buildEloGraphEmbed(playerName, modeText, history) {
  const MAX_POINTS = 200;
  const trimmed = history.length > MAX_POINTS ? history.slice(-MAX_POINTS) : history;

  const chartConfig = {
    type: 'line',
    data: {
      labels: trimmed.map((_, i) => i),
      datasets: [{
        label: playerName,
        data: trimmed,
        borderColor: '#5865F2',
        backgroundColor: 'rgba(88,101,242,0.15)',
        fill: true,
        tension: 0.25,
        pointRadius: 2
      }]
    },
    options: {
      title: { display: true, text: `${playerName}'s elo ${modeText} Graph` },
      scales: {
        xAxes: [{ scaleLabel: { display: true, labelString: 'Number of games' } }],
        yAxes: [{ scaleLabel: { display: true, labelString: 'elo points' } }]
      },
      legend: { display: true }
    }
  };

  const url = `https://quickchart.io/chart?width=600&height=400&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`📈 Gráfica de elo — ${playerName}`)
    .setImage(url);

  if (history.length > MAX_POINTS) {
    embed.setFooter({ text: `Mostrando las últimas ${MAX_POINTS} partidas de ${history.length} jugadas.` });
  }

  return embed;
}

/**
 * Cada modo (y la cola de siempre) tiene su PROPIO elo, independiente de
 * los demás — así que estos comandos necesitan saber en cuál economía
 * operar. Si solo existe una (la de siempre, o un único modo), se usa esa
 * sin preguntar. Si hay más de una, hay que especificar cuál con "modo".
 */
function resolveEconomy(guildData, modoKey) {
  const options = [];
  if (guildData.channels.queue) options.push({ key: 'default', label: 'Cola por defecto', store: guildData });
  for (const mode of Object.values(guildData.modes || {})) {
    if (!mode.players) mode.players = {};
    options.push({ key: mode.key, label: mode.name, store: mode });
  }

  if (modoKey) {
    const found = options.find(o => o.key === modoKey);
    if (!found) return { error: 'Ese modo no existe. Usá `/mode list` para ver los disponibles.' };
    return { store: found.store, label: found.key === 'default' ? null : found.label, key: found.key };
  }

  if (options.length === 0) return { error: 'Este servidor todavía no tiene ninguna cola instalada.' };
  if (options.length === 1) return { store: options[0].store, label: options[0].key === 'default' ? null : options[0].label, key: options[0].key };
  return { error: `Hay ${options.length} colas/modos en este servidor — especificá cuál con la opción "modo" (${options.map(o => o.label).join(', ')}).` };
}

/**
 * Igual que resolveEconomy, pero para comandos de SOLO LECTURA (stats,
 * leaderboard, graph): si no se especifica modo y hay más de uno, nunca
 * bloquea pidiendo que aclares — elige automáticamente la cola de siempre
 * si existe, o si no, el modo más viejo creado.
 */
function resolveEconomyAutoDefault(guildData, modoKey) {
  const strict = resolveEconomy(guildData, modoKey);
  if (!strict.error || modoKey) return strict;

  const modes = Object.values(guildData.modes || {});
  if (guildData.channels.queue) return { store: guildData, label: null, key: 'default' };
  if (modes.length) {
    const oldest = modes.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    if (!oldest.players) oldest.players = {};
    return { store: oldest, label: oldest.name, key: oldest.key };
  }
  return strict; // no hay ninguna cola instalada — el error original aplica
}

// Estadísticas editables con /stats edit stat y /stats edit stats.
const STAT_FIELDS = {
  wins: 'wins', losses: 'losses', draws: 'draws', games: 'gamesPlayed',
  streak: 'streak', 'best-streak': 'bestStreak', 'worst-streak': 'worstStreak',
  'best-elo': 'bestElo', 'worst-elo': 'worstElo'
};
const STAT_LABEL = {
  wins: 'Partidas ganadas (wins)', losses: 'Partidas perdidas (losses)', draws: 'Empates', games: 'Partidas jugadas',
  streak: 'Racha actual', 'best-streak': 'Mejor racha', 'worst-streak': 'Peor racha',
  'best-elo': 'Mejor elo', 'worst-elo': 'Peor elo'
};

// Devuelve un texto de error si el valor no tiene sentido para esa estadística.
function validateStat(key, value) {
  if (['wins', 'losses', 'draws', 'games', 'best-streak'].includes(key) && value < 0) return `${STAT_LABEL[key]} no puede ser negativo.`;
  if (key === 'worst-streak' && value > 0) return 'La peor racha se guarda en negativo (o 0).';
  return null;
}

// Después de editar elo/stats a mano se revisan los logros y rangos de esa
// persona al instante: si con el cambio llegó a un rango, rol o logro nuevo
// (racha, partidas jugadas, partidas ganadas, win rate, elo...), se le da el
// rol y sale el anuncio en #anuncios, igual que si lo hubiera ganado jugando.
async function syncAchievementsAfterEdit(interaction, economy, userId) {
  const modeKey = economy.key && economy.key !== 'default' ? economy.key : null;
  try {
    await checkAndGrantAchievements(interaction.client, interaction.guildId, modeKey, [userId]);
  } catch (err) {
    console.error('[logros] No pude revisar los logros después de /stats edit:', err.message);
  }
}

const modoOpt = o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Estadísticas de jugadores.')
    // --- Consulta (cualquiera) ---
    .addSubcommand(sc => sc.setName('player').setDescription('Ver stats de un jugador.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador (por defecto, tú)').setRequired(false))
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('graph').setDescription('Ver la gráfica de elo de un jugador a lo largo de sus partidas.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador (por defecto, tú)').setRequired(false))
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('leaderboard').setDescription('Ver la tabla de posiciones.')
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('game').setDescription('Ver los datos de una partida.')
      .addIntegerOption(o => o.setName('numero').setDescription('Número de la partida (el de "Game n°")').setRequired(true).setMinValue(1))
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('history').setDescription('Ver el historial de partidas de un jugador.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador (por defecto, tú)').setRequired(false))
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('matchup').setDescription('Ver con quién juega y contra quién juega un jugador.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador (por defecto, tú)').setRequired(false))
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('server').setDescription('Ver las stats generales del servidor.')
      .addStringOption(modoOpt))
    .addSubcommand(sc => sc.setName('team-graph').setDescription('Ver las victorias de cada equipo del modo.')
      .addStringOption(modoOpt))
    // --- Edición (Elo Admin) ---
    .addSubcommandGroup(g => g.setName('edit').setDescription('Elo Admin: edita puntos y stats de un jugador.')
      .addSubcommand(sc => sc.setName('add-points').setDescription('Suma puntos de elo.')
        .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
        .addIntegerOption(o => o.setName('puntos').setDescription('Cantidad a sumar').setRequired(true))
        .addStringOption(modoOpt))
      .addSubcommand(sc => sc.setName('remove-points').setDescription('Resta puntos de elo.')
        .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
        .addIntegerOption(o => o.setName('puntos').setDescription('Cantidad a restar').setRequired(true))
        .addStringOption(modoOpt))
      .addSubcommand(sc => sc.setName('points').setDescription('Fija el elo de un jugador en un valor exacto.')
        .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
        .addIntegerOption(o => o.setName('puntos').setDescription('Elo nuevo').setRequired(true).setMinValue(ELO_FLOOR))
        .addStringOption(modoOpt))
      .addSubcommand(sc => sc.setName('name').setDescription('Cambia el nombre de un jugador en el bot.')
        .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
        .addStringOption(o => o.setName('nombre').setDescription('Nombre nuevo').setRequired(true).setMaxLength(32)))
      .addSubcommand(sc => sc.setName('reset-all-names').setDescription('Vuelve a poner a todos los jugadores el nombre que tienen en Discord.'))
      .addSubcommand(sc => sc.setName('stat').setDescription('Edita UNA estadística de un jugador.')
        .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
        .addStringOption(o => o.setName('stat').setDescription('Qué estadística cambiar').setRequired(true)
          .addChoices(...Object.entries(STAT_LABEL).map(([value, name]) => ({ name, value }))))
        .addIntegerOption(o => o.setName('valor').setDescription('Valor nuevo').setRequired(true))
        .addStringOption(modoOpt))
      .addSubcommand(sc => {
        sc.setName('stats').setDescription('Edita varias estadísticas de un jugador a la vez.')
          .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true));
        sc.addIntegerOption(o => o.setName('elo').setDescription('Elo').setMinValue(ELO_FLOOR));
        for (const [key, label] of Object.entries(STAT_LABEL)) {
          sc.addIntegerOption(o => o.setName(key).setDescription(label));
        }
        return sc.addStringOption(modoOpt);
      })),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = [];
    if (guildData.channels.queue && 'cola por defecto'.includes(focused)) {
      choices.push({ name: 'Cola por defecto', value: 'default' });
    }
    for (const mode of Object.values(guildData.modes || {})) {
      if (mode.key.includes(focused) || mode.name.toLowerCase().includes(focused)) {
        choices.push({ name: `${mode.name} (${mode.key})`.slice(0, 100), value: mode.key });
      }
    }
    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const modoKey = interaction.options.getString('modo');

    if (group === 'edit') return handleEdit(interaction, guildData, sub, modoKey);

    if (!(await assertChannel(interaction, guildData, null, 'info_chat'))) return;

    const economy = resolveEconomyAutoDefault(guildData, modoKey);
    if (economy.error) {
      return interaction.reply({ embeds: [errorEmbed(economy.error)], ephemeral: true });
    }
    const store = economy.store;

    // Arregla en el momento cualquier nombre que haya quedado guardado como
    // el ID crudo de Discord (ej. jugadores agregados con /force_join antes
    // de que el bot pudiera resolver su apodo), sin tocar nada más.
    if (interaction.guild) {
      const healed = await healAllBrokenNames(interaction.guild, store);
      if (healed) saveGuild(interaction.guildId, guildData);
    }

    if (sub === 'player') {
      const target = interaction.options.getUser('usuario') || interaction.user;
      const player = store.players[target.id];
      if (!player) {
        return interaction.reply({ embeds: [errorEmbed('Ese jugador todavía no tiene partidas registradas ahí.')], ephemeral: true });
      }
      const sorted = Object.values(store.players).sort((a, b) => b.elo - a.elo);
      const position = sorted.findIndex(p => p.userId === target.id) + 1;

      const embed = playerStatsEmbed(store, player, position, economy.label);
      const badge = require('../utils/ranks').rankBadge(require('../utils/ranks').getRankForElo(player.elo).rankKey);
      return interaction.reply({ embeds: [embed], files: badge ? [badge.attachment] : [] });
    }

    if (sub === 'leaderboard') {
      const modeKeyForButtons = economy.key === 'default' ? null : economy.key;
      const { embed, page, sortKey } = leaderboardEmbed(store, 'elo', 0, economy.label);
      return interaction.reply({ embeds: [embed], components: leaderboardComponents(sortKey, page, modeKeyForButtons) });
    }

    if (sub === 'graph') {
      const target = interaction.options.getUser('usuario') || interaction.user;
      const player = store.players[target.id];
      if (!player) {
        return interaction.reply({ embeds: [errorEmbed('Ese jugador todavía no tiene partidas registradas ahí.')], ephemeral: true });
      }
      if (!player.history || player.history.length < 2) {
        return interaction.reply({ embeds: [errorEmbed('Todavía no hay suficientes partidas jugadas ahí como para armar una gráfica (hace falta al menos 2).')], ephemeral: true });
      }

      const name = require('../utils/names').displayName(store, target.id);
      const modeText = economy.label || 'cola por defecto';
      const embed = buildEloGraphEmbed(name, modeText, player.history);
      return interaction.reply({ embeds: [embed] });
    }

    // --- Subcomandos de consulta nuevos (la lógica vive en utils/statsExtra.js) ---
    const target = interaction.options.getUser('usuario') || interaction.user;
    let result = null;
    if (sub === 'game') result = gameEmbed(store, guildData, economy, interaction.options.getInteger('numero'));
    else if (sub === 'history') result = historyEmbed(store, guildData, economy, target.id);
    else if (sub === 'matchup') result = matchupEmbed(store, guildData, economy, target.id);
    else if (sub === 'server') result = serverEmbed(store, guildData, economy);
    else if (sub === 'team-graph') result = teamGraphEmbed(store, guildData, economy);

    if (result) {
      if (result.error) return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
      return interaction.reply({ embeds: [result.embed] });
    }
  }
};

/**
 * /stats edit ... (solo Elo Admin, en el mismo canal que los demás comandos
 * de edición: submit).
 */
async function handleEdit(interaction, guildData, sub, modoKey) {
  if (!(await assertChannel(interaction, guildData, 'reset_season'))) return; // mismo canal: submit
  if (!isEloAdmin(interaction, guildData)) {
    return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede editar puntos y stats.')], ephemeral: true });
  }

  // --- Los que no dependen de una cola puntual ---
  if (sub === 'name') {
    const target = interaction.options.getUser('usuario');
    const nuevo = interaction.options.getString('nombre').trim();
    if (!nuevo) return interaction.reply({ embeds: [errorEmbed('El nombre no puede estar vacío.')], ephemeral: true });

    // Igual que /rename: se cambia en TODAS las colas donde ya existe y queda
    // como nombre de referencia para las colas a las que entre después.
    for (const st of [guildData, ...Object.values(guildData.modes || {})]) {
      if (st.players?.[target.id]) st.players[target.id].name = nuevo;
    }
    guildData.preferredNames = guildData.preferredNames || {};
    guildData.preferredNames[target.id] = nuevo;
    saveGuild(interaction.guildId, guildData);
    return interaction.reply({ embeds: [successEmbed(`El nombre de <@${target.id}> ahora es **${nuevo}** en todas las colas (cambiado por <@${interaction.user.id}>).`)] });
  }

  if (sub === 'reset-all-names') {
    await interaction.deferReply();
    const stores = [guildData, ...Object.values(guildData.modes || {})].filter(st => st.players);
    const ids = [...new Set(stores.flatMap(st => Object.keys(st.players)))];

    // Nombre actual en Discord de cada jugador que sigue en el servidor.
    const names = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const members = await interaction.guild.members.fetch({ user: chunk }).catch(() => null);
      if (!members) continue;
      for (const m of members.values()) names[m.id] = m.nickname || m.user.globalName || m.user.username;
    }

    let updated = 0;
    for (const id of Object.keys(names)) {
      for (const st of stores) if (st.players[id]) st.players[id].name = names[id];
      if (guildData.preferredNames) delete guildData.preferredNames[id];
      updated += 1;
    }
    saveGuild(interaction.guildId, guildData);

    const missing = ids.length - updated;
    return interaction.editReply({ embeds: [successEmbed(
      `Listo: ${updated} jugador(es) volvieron a usar su nombre de Discord en todas las colas.` +
      (missing > 0 ? `\n${missing} ya no están en el servidor y no se tocaron.` : '')
    )] });
  }

  // --- Los que editan elo/stats dentro de una cola ---
  const economy = resolveEconomy(guildData, modoKey);
  if (economy.error) {
    return interaction.reply({ embeds: [errorEmbed(economy.error)], ephemeral: true });
  }
  const target = interaction.options.getUser('usuario');
  const player = getOrCreatePlayer(economy.store, target.id, target.globalName || target.username);
  const scopeText = economy.label ? ` en \`${economy.label}\`` : '';
  const by = `<@${interaction.user.id}>`;

  if (sub === 'add-points' || sub === 'remove-points') {
    const points = interaction.options.getInteger('puntos');
    const before = player.elo;
    player.elo = Math.max(ELO_FLOOR, sub === 'add-points' ? before + points : before - points);
    saveGuild(interaction.guildId, guildData);
    await interaction.reply({ embeds: [successEmbed(`Elo de <@${target.id}>${scopeText} cambiado por ${by}: ${before} -> ${player.elo}`)] });
    return syncAchievementsAfterEdit(interaction, economy, target.id);
  }

  if (sub === 'points') {
    const before = player.elo;
    player.elo = Math.max(ELO_FLOOR, interaction.options.getInteger('puntos'));
    saveGuild(interaction.guildId, guildData);
    await interaction.reply({ embeds: [successEmbed(`Elo de <@${target.id}>${scopeText} fijado por ${by}: ${before} -> ${player.elo}`)] });
    return syncAchievementsAfterEdit(interaction, economy, target.id);
  }

  // 'stat' (una) y 'stats' (varias)
  const edits = []; // [clave, valor]
  if (sub === 'stat') {
    edits.push([interaction.options.getString('stat'), interaction.options.getInteger('valor')]);
  } else {
    const elo = interaction.options.getInteger('elo');
    if (elo !== null) edits.push(['elo', elo]);
    for (const key of Object.keys(STAT_FIELDS)) {
      const v = interaction.options.getInteger(key);
      if (v !== null) edits.push([key, v]);
    }
  }
  if (!edits.length) {
    return interaction.reply({ embeds: [errorEmbed('No elegiste ninguna estadística para cambiar.')], ephemeral: true });
  }
  for (const [key, value] of edits) {
    const problem = key === 'elo' ? null : validateStat(key, value);
    if (problem) return interaction.reply({ embeds: [errorEmbed(problem)], ephemeral: true });
  }

  const lines = [];
  for (const [key, value] of edits) {
    if (key === 'elo') {
      const before = player.elo;
      player.elo = Math.max(ELO_FLOOR, value);
      lines.push(`Elo: ${before} -> ${player.elo}`);
    } else {
      const field = STAT_FIELDS[key];
      const before = player[field] ?? 0;
      player[field] = value;
      lines.push(`${STAT_LABEL[key]}: ${before} -> ${value}`);
    }
  }
  saveGuild(interaction.guildId, guildData);
  await interaction.reply({ embeds: [successEmbed(`Stats de <@${target.id}>${scopeText} editadas por ${by}:\n${lines.join('\n')}`)] });
  return syncAchievementsAfterEdit(interaction, economy, target.id);
}
