const { EmbedBuilder } = require('discord.js');
const { ELO_START } = require('../config');

// Roles de PODIO por cola: 🥇 Campeón (1º), 🥈 Subcampeón (2º) y 🥉 Tercer lugar (3º).
// Cada uno se reutiliza y se renombra cada temporada (igual que el separador
// gris) — nunca lo tiene más de una persona a la vez: se lo sacamos al viejo
// y se lo damos al nuevo. Los IDs viejos (championRoleId / currentChampionId)
// siguen siendo los del 1º, así que las colas ya creadas no se rompen.
const PODIUM_SLOTS = [
  { key: 'first',  medal: '🥇', title: 'Campeón',    roleField: 'championRoleId', holderField: 'currentChampionId', colorField: 'championColor',   defaultColor: 0xFFD700 }, // dorado
  { key: 'second', medal: '🥈', title: 'Subcampeón', roleField: 'secondRoleId',   holderField: 'currentSecondId',   colorField: 'secondColor',     defaultColor: 0xC0C0C0 }, // plata
  { key: 'third',  medal: '🥉', title: '3er lugar',  roleField: 'thirdRoleId',    holderField: 'currentThirdId',    colorField: 'thirdColor',      defaultColor: 0xCD7F32 }  // bronce
];

async function ensurePodiumRole(guild, store, slot, modeLabel, season) {
  const name = `${slot.medal} ${slot.title} ${modeLabel} — Temporada ${season}`.slice(0, 100);
  const color = store[slot.colorField] || slot.defaultColor;

  let role = store[slot.roleField] ? await guild.roles.fetch(store[slot.roleField]).catch(() => null) : null;

  if (role) {
    await role.edit({ name, color }).catch(() => {});
  } else {
    role = await guild.roles.create({
      name,
      color,
      permissions: [],
      mentionable: true,
      hoist: true, // se muestra aparte en la lista de miembros, para que se note
      reason: `Rol de ${slot.title.toLowerCase()} de temporada`
    }).catch(() => null);
    if (role) store[slot.roleField] = role.id;
  }

  return role;
}

// Se mantiene por compatibilidad: el rol del campeón (1º).
async function ensureChampionRole(guild, store, modeLabel, season) {
  return ensurePodiumRole(guild, store, PODIUM_SLOTS[0], modeLabel, season);
}

/**
 * Corre justo ANTES de resetear el elo de una cola (necesita el elo tal
 * como está, no el ya reseteado). Determina el top 3 por elo y, si esa cola
 * tiene los roles de campeón activados, crea/actualiza los 3 roles
 * (🥇 1º, 🥈 2º, 🥉 3º) y se los reasigna a los nuevos ganadores.
 * Devuelve los datos del podio (con los roles en roles.first/second/third).
 */
async function awardChampionRole(guild, guildData, modeKey) {
  const store = modeKey ? guildData.modes[modeKey] : guildData;
  if (!store) return null;

  // Cuenta quien jugó partidas O tiene el elo distinto del inicial (por
  // ejemplo, cargado con /stats edit): así el podio sale igual.
  const ranked = Object.values(store.players || {})
    .filter(p => p.gamesPlayed > 0 || p.elo !== ELO_START)
    .sort((a, b) => b.elo - a.elo);

  const modeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'Cola por defecto';
  const season = guildData.season || 1; // la temporada que está terminando, no la que arranca
  const winners = { first: ranked[0] || null, second: ranked[1] || null, third: ranked[2] || null };
  const podium = { modeLabel, season, ...winners };

  // Si nadie jugó, igual se devuelve un podio (vacío) para que el reset de
  // ESTA cola siempre se anuncie. Sin ganador no hay roles ni @everyone.
  // Tampoco hay roles/@everyone si la cola no tiene el rol de campeón activado
  // (/campeon_configurar): el podio sale igual.
  if (!winners.first || !store.championEnabled) {
    return { ...podium, role: null, roles: {}, hasChampionRole: false };
  }

  // Si algo falla con los roles (permisos, jerarquía), el podio se anuncia
  // igual: no se pierde por eso. Cada puesto se maneja por separado.
  const roles = {};
  for (const slot of PODIUM_SLOTS) {
    try {
      const winner = winners[slot.key];
      const role = await ensurePodiumRole(guild, store, slot, modeLabel, season);
      roles[slot.key] = role;
      if (!role) continue;

      // Sacarle el rol a quien lo tenía antes (si cambió).
      const prevId = store[slot.holderField];
      if (prevId && (!winner || prevId !== winner.userId)) {
        const prevMember = await guild.members.fetch(prevId).catch(() => null);
        if (prevMember) await prevMember.roles.remove(role).catch(() => {});
      }

      // Dárselo al nuevo (si ese puesto tiene a alguien).
      if (winner) {
        const member = await guild.members.fetch(winner.userId).catch(() => null);
        if (member) await member.roles.add(role).catch(() => {});
        store[slot.holderField] = winner.userId;
      } else {
        store[slot.holderField] = null;
      }
    } catch (err) {
      console.error(`[campeon] No pude dar el rol de ${slot.title}:`, err.message);
    }
  }

  // "role" (singular) = el del campeón, por compatibilidad con código viejo.
  return { ...podium, role: roles.first || null, roles, hasChampionRole: true };
}

/** Publica en #anuncios el podio (top 3) de la temporada que terminó. Con @everyone solo si ese modo tiene rol de campeón. */
async function announceChampions(client, guildData, result) {
  const channelId = guildData.channels?.anuncios;
  if (!channelId || !result) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const podiumLine = (medal, player) => {
    if (!player) return `${medal} —`;
    return `${medal} **${player.name}** — ${Math.round(player.elo)} de Elo`;
  };

  const embed = new EmbedBuilder()
    .setColor(result.role?.color || 0xFFD700)
    .setTitle(result.hasChampionRole
      ? `🏆 ¡Campeón de la Temporada ${result.season} — ${result.modeLabel}!`
      : `🏆 Podio de la Temporada ${result.season} — ${result.modeLabel}`)
    .setDescription(
      result.first
        ? `${podiumLine('🥇', result.first)}${result.roles?.first ? ` — <@&${result.roles.first.id}>` : ''}\n` +
          `${podiumLine('🥈', result.second)}${result.roles?.second && result.second ? ` — <@&${result.roles.second.id}>` : ''}\n` +
          `${podiumLine('🥉', result.third)}${result.roles?.third && result.third ? ` — <@&${result.roles.third.id}>` : ''}\n\n` +
          `¡Felicidades a todos!`
        : `Nadie jugó en **${result.modeLabel}** esta temporada.`
    )
    .setTimestamp();

  if (result.hasChampionRole) {
    await channel.send({
      content: '@everyone',
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] }
    }).catch(() => {});
  } else {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

module.exports = { ensureChampionRole, ensurePodiumRole, PODIUM_SLOTS, awardChampionRole, announceChampions };
