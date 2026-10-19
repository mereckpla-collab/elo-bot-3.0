const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER } = require('../config');
const { getGuild, saveGuild } = require('../database');

// Estado transitorio del wizard (no se guarda en disco: se pierde si el bot
// reinicia a mitad de un setup, y no pasa nada, el admin lo vuelve a abrir).
// Clave: "<guildId>:<userId>"
const sessions = new Map();
const sessionKey = (guildId, userId) => `${guildId}:${userId}`;

const TYPE_LABELS = { solo: 'solo', team: 'team', ffa: 'FFA' };

function getSession(guildId, userId) {
  return sessions.get(sessionKey(guildId, userId));
}
function setSession(guildId, userId, data) {
  sessions.set(sessionKey(guildId, userId), data);
}
function clearSession(guildId, userId) {
  sessions.delete(sessionKey(guildId, userId));
}

function numberButtons(customPrefix, values, moreCustomId) {
  const row = new ActionRowBuilder().addComponents(
    values.map(v => new ButtonBuilder().setCustomId(`${customPrefix}_${v}`).setLabel(String(v)).setStyle(ButtonStyle.Primary))
  );
  const moreRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(moreCustomId).setLabel('More?').setStyle(ButtonStyle.Secondary)
  );
  return [row, moreRow];
}

// ---------- Paso 1: elegir tipo ----------

async function start(interaction, type) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (type === 'ffa') {
    setSession(guildId, userId, { type, step: 'players_ffa', streakBoost: false, defaultRanks: false });
    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle('Add a FFA queue')
      .setDescription('You need to specify how many **players** will compete against each other (free for all) in this mode.');
    const rows = numberButtons('mw_teams', [2, 3, 4, 5, 6], 'mw_teamsmore');
    return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }

  setSession(guildId, userId, { type, step: 'teams', streakBoost: false, defaultRanks: false });
  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`Add a ${TYPE_LABELS[type]} queue`)
    .setDescription('You need to specify how many **teams** will face each other in this mode.');
  const rows = numberButtons('mw_teams', [2, 3, 4, 5, 6], 'mw_teamsmore');
  return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
}

// ---------- Paso 2: cantidad de equipos (o de jugadores, si es FFA) ----------

async function chooseTeams(interaction, n) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const session = getSession(guildId, userId);
  if (!session) return expiredReply(interaction);

  if (session.type === 'ffa') {
    session.teams = n;
    session.playersPerTeam = 1;
    return showConfirmScreen(interaction, session, true);
  }

  session.teams = n;
  session.step = 'players';
  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`Add a ${TYPE_LABELS[session.type]} queue`)
    .setDescription(`And now we got **${n}** teams, we need to know how many **players** will be in the teams.`);
  const rows = numberButtons('mw_players', [1, 2, 3, 4, 5], 'mw_playersmore');
  return interaction.update({ embeds: [embed], components: rows });
}

async function askTeamsMore(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  const label = session.type === 'ffa' ? 'jugadores' : 'equipos';
  const modal = new ModalBuilder()
    .setCustomId('mwmodal_teams')
    .setTitle(`¿Cuántos ${label}?`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel(`Número de ${label} (2-30)`).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
  return interaction.showModal(modal);
}

// ---------- Paso 3: jugadores por equipo ----------

async function choosePlayers(interaction, n) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  session.playersPerTeam = n;
  return showConfirmScreen(interaction, session, false);
}

async function askPlayersMore(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  const modal = new ModalBuilder()
    .setCustomId('mwmodal_players')
    .setTitle('¿Cuántos jugadores por equipo?')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('Número de jugadores por equipo (1-30)').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
  return interaction.showModal(modal);
}

// ---------- Modal submit ----------

async function handleModalSubmit(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction, true);

  if (interaction.customId === 'mwmodal_teams') {
    const raw = interaction.fields.getTextInputValue('value');
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 2 || n > 30) {
      return interaction.reply({ content: '❌ Tiene que ser un número entero entre 2 y 30.', ephemeral: true });
    }
    if (session.type === 'ffa') {
      session.teams = n;
      session.playersPerTeam = 1;
      return showConfirmScreen(interaction, session, true, true);
    }
    session.teams = n;
    session.step = 'players';
    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`Add a ${TYPE_LABELS[session.type]} queue`)
      .setDescription(`And now we got **${n}** teams, we need to know how many **players** will be in the teams.`);
    const rows = numberButtons('mw_players', [1, 2, 3, 4, 5], 'mw_playersmore');
    return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }

  if (interaction.customId === 'mwmodal_players') {
    const raw = interaction.fields.getTextInputValue('value');
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      return interaction.reply({ content: '❌ Tiene que ser un número entero entre 1 y 30.', ephemeral: true });
    }
    session.playersPerTeam = n;
    return showConfirmScreen(interaction, session, true, true);
  }

  if (interaction.customId === 'mwmodal_rename') {
    const raw = interaction.fields.getTextInputValue('value').trim();
    if (!raw) return interaction.reply({ content: '❌ El nombre no puede estar vacío.', ephemeral: true });
    session.customName = raw.slice(0, 60);
    return showConfirmScreen(interaction, session, true, true);
  }

  if (interaction.customId === 'mwmodal_season') {
    const raw = interaction.fields.getTextInputValue('value');
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1) {
      return interaction.reply({ content: '❌ Tiene que ser un número entero de 1 en adelante.', ephemeral: true });
    }
    session.chosenSeason = n;
    return showConfirmScreen(interaction, session, true, true);
  }

  if (interaction.customId === 'mwmodal_championcolor') {
    const { parseColorList } = require('../utils/color');
    const raw = interaction.fields.getTextInputValue('value');
    const parsed = parseColorList(raw, 3);
    if (!parsed.ok) {
      return interaction.reply({ content: `❌ ${parsed.message}`, ephemeral: true });
    }
    session.championEnabled = true;
    [session.championColor, session.secondColor, session.thirdColor] = parsed.colors;
    return showConfirmScreen(interaction, session, true, true);
  }
}

// ---------- Pantalla de confirmación ----------

function computeModeName(session) {
  if (session.customName) return session.customName;
  const chunk = Array(session.teams).fill(String(session.playersPerTeam)).join('v');
  return `${chunk}-${session.type}`;
}

async function showConfirmScreen(interaction, session, isUpdate, isReply) {
  const guildData = getGuild(interaction.guildId);
  const name = computeModeName(session);
  session.step = 'confirm';
  const seasonToApply = session.chosenSeason || guildData.season || 1;

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`Add a ${TYPE_LABELS[session.type]} queue`)
    .setDescription(
      `I now have got the mode \`${name}\`.\n` +
      `Temporada: **${seasonToApply}**${session.chosenSeason ? ' (se va a aplicar a TODO el servidor, no solo a este modo)' : ''}.\n` +
      `Roles de podio (🥇 campeón, 🥈 2º, 🥉 3º): **${session.championEnabled ? 'sí' : 'no'}**.\n` +
      `We have several options now:\n\n` +
      `> Confirm and finish the set up\n` +
      `> Edit some settings about this new mode\n` +
      `> Add another mode`
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mw_rename').setLabel('Rename mode').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mw_streak').setLabel(session.streakBoost ? 'Streak boost ✅' : 'Enable streak boost').setEmoji('🔥').setStyle(session.streakBoost ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mw_ranks').setLabel(session.defaultRanks ? 'Default ranks ✅' : 'Add default ranks').setEmoji('🏅').setStyle(session.defaultRanks ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mw_season').setLabel(session.chosenSeason ? `Temporada: ${session.chosenSeason}` : 'Temporada').setEmoji('🗓️').setStyle(session.chosenSeason ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mw_champion').setLabel(session.championEnabled ? 'Campeón: ON 🏆' : 'Rol de campeón').setEmoji('🏆').setStyle(session.championEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mw_finish').setLabel('Finish').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mw_cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );

  const payload = { embeds: [embed], components: [row1, row2] };
  if (isReply) return interaction.reply({ ...payload, ephemeral: true });
  if (isUpdate) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function toggleStreak(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  session.streakBoost = !session.streakBoost;
  return showConfirmScreen(interaction, session, true);
}

async function toggleRanks(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  session.defaultRanks = !session.defaultRanks;
  return showConfirmScreen(interaction, session, true);
}

async function toggleChampion(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);

  if (session.championEnabled) {
    // Se está apagando: no hace falta preguntar nada más.
    session.championEnabled = false;
    return showConfirmScreen(interaction, session, true);
  }

  // Se está prendiendo: primero pedimos el color del rol.
  const modal = new ModalBuilder()
    .setCustomId('mwmodal_championcolor')
    .setTitle('Colores del podio (🥇 🥈 🥉)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('3 colores separados por coma (1º, 2º, 3º)').setPlaceholder('amarillo, azul, verde').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
      )
    );
  return interaction.showModal(modal);
}

async function askRename(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  const modal = new ModalBuilder()
    .setCustomId('mwmodal_rename')
    .setTitle('Nombre del modo')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('Nombre (ej. ranked-4v4)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)
      )
    );
  return interaction.showModal(modal);
}

async function askSeason(interaction) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);
  const modal = new ModalBuilder()
    .setCustomId('mwmodal_season')
    .setTitle('Temporada')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('¿En qué temporada están? (ej. 1)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)
      )
    );
  return interaction.showModal(modal);
}

async function cancel(interaction) {
  clearSession(interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder().setColor(COLOR_DANGER).setDescription('❌ Se canceló la creación del modo.');
  return interaction.update({ embeds: [embed], components: [] });
}

// Baja el mensaje de bienvenida del init (el de los botones "Add Solo queue",
// etc.) al fondo del canal: se borra el viejo y se publica uno nuevo, para que
// siga a mano sin tener que subir a buscarlo.
async function bumpInitPanel(client, guildId) {
  const { initWelcomeEmbed, initWelcomeButtons } = require('../utils/embeds');
  const guildData = getGuild(guildId);
  const ref = guildData.initMessage;
  if (!ref) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  if (!channel) return;
  const old = await channel.messages.fetch(ref.messageId).catch(() => null);
  if (old) await old.delete().catch(() => {});
  const msg = await channel.send({ embeds: [initWelcomeEmbed()], components: initWelcomeButtons() }).catch(() => null);
  if (msg) {
    guildData.initMessage = { channelId: channel.id, messageId: msg.id };
    saveGuild(guildId, guildData);
  }
}

async function finish(interaction, guildData) {
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return expiredReply(interaction);

  const { getLimits } = require('../utils/vip');
  const limits = getLimits(guildData);
  const currentModeCount = Object.keys(guildData.modes || {}).length;
  if (currentModeCount >= limits.maxModes) {
    clearSession(interaction.guildId, interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(COLOR_DANGER)
      .setTitle('❌ Límite de modos alcanzado')
      .setDescription(
        `El plan **${limits.label}** de este servidor permite hasta **${limits.maxModes}** modo(s) creado(s), y ya hay ${currentModeCount}.\n` +
        `Necesitás VIP para crear más — hablá con un administrador del servidor.`
      );
    return interaction.update({ embeds: [embed], components: [] });
  }

  let name = computeModeName(session);
  let key = name.toLowerCase().replace(/\s+/g, '-');
  let suffix = 2;
  while (guildData.modes[key]) {
    key = `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}`;
    suffix++;
  }

  guildData.modes[key] = {
    key,
    name,
    type: session.type,
    teams: session.teams,
    playersPerTeam: session.playersPerTeam,
    totalPlayers: session.teams * session.playersPerTeam,
    streakBoost: session.streakBoost,
    defaultRanks: session.defaultRanks,
    pickSystem: 'classic',   // 'classic' = draft snake (1-2-2-1...) | 'single' = cada capitán elige 1 por turno, sin dobles picks
    championEnabled: session.championEnabled || false, // roles de podio (🥇 1º, 🥈 2º, 🥉 3º) cuando se resetea la temporada (botón "Rol de campeón" del wizard, o /campeon_configurar)
    championColor: session.championColor || null,
    championRoleId: null,
    currentChampionId: null,
    secondColor: session.secondColor || null, secondRoleId: null, currentSecondId: null,   // rol 🥈 del 2º puesto
    thirdColor: session.thirdColor || null, thirdRoleId: null, currentThirdId: null,      // rol 🥉 del 3º puesto
    createdAt: Date.now(),
    createdBy: interaction.user.id,
    // Estado de cola propio de este modo (Etapa 3b):
    channelId: null,
    queueMessage: null,
    queue: [],
    players: {}   // elo independiente de este modo — nada que ver con la cola de siempre ni con otros modos
  };
  saveGuild(interaction.guildId, guildData);

  // La temporada elegida en el wizard (botón "Temporada") es GLOBAL — se
  // aplica a todo el servidor, no solo a este modo nuevo. Si ya la habías
  // puesto en 1 al crear una cola anterior, esa sigue siendo la vigente
  // para esta también (no hace falta re-elegirla cada vez).
  let seasonChanged = false;
  if (session.chosenSeason && session.chosenSeason !== guildData.season) {
    const { ensureSeasonDividerRole, announceSeasonChange } = require('../utils/seasonDivider');
    guildData.season = session.chosenSeason;
    guildData.seasonResetQueues = {}; // temporada fijada a mano: ciclo de reset nuevo
    await ensureSeasonDividerRole(interaction.guild, guildData, guildData.season).catch(() => {});
    await announceSeasonChange(interaction.client, guildData, guildData.season).catch(() => {});
    seasonChanged = true;
  }

  // Crear el canal de este modo dentro de la categoría "Elo Queues", y
  // publicar ahí su propio mensaje de cola con los botones Unirse/Salir/etc.
  const { ChannelType } = require('discord.js');
  const { CATEGORY_NAME } = require('../config');
  const { modeQueueButtons, queueEmbed } = require('../utils/embeds');
  const { peekNextGameNumber } = require('./draftManager');

  const guild = interaction.guild;
  let category = guild.channels.cache.get(guildData.categoryId);
  if (!category) {
    category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME)
      || await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory });
    guildData.categoryId = category.id;
  }

  let channelCreationFailed = false;
  try {
    const channel = await guild.channels.create({
      name: key,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Cola de ${name} — ${session.teams}x${session.playersPerTeam} (${session.type})`
    });
    guildData.modes[key].channelId = channel.id;

    const embed = queueEmbed(guildData, peekNextGameNumber(guildData, key), null, [], guildData.modes[key].totalPlayers);
    const msg = await channel.send({ embeds: [embed], components: modeQueueButtons(key) });
    guildData.modes[key].queueMessage = { channelId: channel.id, messageId: msg.id };
  } catch (err) {
    channelCreationFailed = true;
  }

  saveGuild(interaction.guildId, guildData);
  clearSession(interaction.guildId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setTitle('✅ Modo creado')
    .setDescription(
      (channelCreationFailed
        ? `Se creó el modo \`${key}\` (${session.teams} equipos x ${session.playersPerTeam} jugadores, ${session.type}), ` +
          `pero no pude crear su canal (revisá que el bot tenga permiso de "Gestionar canales"). Avisale a un admin.`
        : `Se creó el modo \`${key}\` (${session.teams} equipos x ${session.playersPerTeam} jugadores, ${session.type}).\n` +
          `Ya está listo para jugar en <#${guildData.modes[key].channelId}>.`) +
      (seasonChanged ? `\n\n🗓️ La temporada del servidor quedó en **${guildData.season}** (aplica a todas las colas).` : '')
    );
  await interaction.update({ embeds: [embed], components: [] });

  // Con la cola ya creada, el panel del init baja al fondo del canal.
  await bumpInitPanel(interaction.client, interaction.guildId).catch(() => {});
}

function viewModesEmbed(guildData) {
  const modes = Object.values(guildData.modes || {});
  const embed = new EmbedBuilder().setColor(COLOR_PRIMARY).setTitle('📋 Modos de este servidor');
  if (!modes.length) {
    embed.setDescription('Todavía no hay ningún modo creado. Usá los botones de arriba para crear el primero.');
    return embed;
  }
  embed.setDescription(
    modes.map(m =>
      `**${m.name}** (\`${m.key}\`) — ${TYPE_LABELS[m.type]}, ${m.teams} equipos x ${m.playersPerTeam} jugadores` +
      `${m.streakBoost ? ' · streak boost' : ''}${m.defaultRanks ? ' · ranks' : ''}`
    ).join('\n')
  );
  return embed;
}

async function viewModes(interaction, guildData) {
  return interaction.reply({ embeds: [viewModesEmbed(guildData)], ephemeral: true });
}

/** Cuántos modos (mapas) hay creados vs. el límite del plan VIP del server. */
function countModesEmbed(guildData) {
  const { getLimits } = require('../utils/vip');
  const limits = getLimits(guildData);
  const count = Object.keys(guildData.modes || {}).length;
  const max = limits.maxModes === Infinity ? '∞' : limits.maxModes;
  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle('🗺️ Modos (mapas) de este servidor')
    .setDescription(`Hay **${count} / ${max}** modo(s) creado(s) — plan **${limits.label}**.`);
}

/** Borra un modo (mapa): su canal de cola y todo su registro. No se puede
 *  si ese modo tiene una partida en curso (drafting o pendiente de voto). */
async function removeMode(interaction, guildData, key) {
  const mode = guildData.modes[key];
  if (!mode) {
    return { ok: false, embed: new EmbedBuilder().setColor(COLOR_DANGER).setDescription(`⚠️ Ese modo ya no existe. Usá \`/mode list\` para ver los actuales.`) };
  }

  const activeGame = Object.values(guildData.games || {}).find(
    g => g.modeKey === key && (g.status === 'drafting' || g.status === 'pending')
  );
  if (activeGame) {
    return { ok: false, embed: new EmbedBuilder().setColor(COLOR_DANGER).setDescription(`⚠️ No podés borrar \`${key}\`: la partida n°${activeGame.number ?? activeGame.id} de ese modo todavía está en curso. Esperá a que termine o cancelala.`) };
  }

  if (mode.channelId) {
    const channel = await interaction.guild.channels.fetch(mode.channelId).catch(() => null);
    if (channel) await channel.delete('Modo eliminado con /mode remove').catch(() => {});
  }

  delete guildData.modes[key];
  saveGuild(interaction.guildId, guildData);

  return { ok: true, embed: new EmbedBuilder().setColor(COLOR_SUCCESS).setDescription(`✅ Se eliminó el modo \`${key}\` (${mode.name}) y su canal.`) };
}

function expiredReply(interaction, isModal) {
  const payload = { content: '⏱️ Esta configuración expiró o ya no es válida (quizás el bot se reinició). Empezá de nuevo desde el canal init.', ephemeral: true };
  if (isModal) return interaction.reply(payload);
  return interaction.reply(payload);
}

module.exports = {
  start, chooseTeams, askTeamsMore, choosePlayers, askPlayersMore,
  handleModalSubmit, toggleStreak, toggleRanks, toggleChampion, askRename, askSeason, cancel, finish, viewModes,
  countModesEmbed, removeMode, bumpInitPanel
};
