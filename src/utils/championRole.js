const { EmbedBuilder } = require('discord.js');
const { ELO_START } = require('../config');

// Un solo rol de "campeón" por cola (se reutiliza y se renombra cada
// temporada, igual que el separador gris) — nunca lo tiene más de una
// persona a la vez: se lo sacamos al campeón viejo y se lo damos al nuevo.
async function ensureChampionRole(guild, store, modeLabel, season) {
  const name = `🏆 Campeón ${modeLabel} — Temporada ${season}`.slice(0, 100);
  const color = store.championColor || 0xFFD700; // dorado por default

  let role = store.championRoleId ? await guild.roles.fetch(store.championRoleId).catch(() => null) : null;

  if (role) {
    await role.edit({ name, color }).catch(() => {});
  } else {
    role = await guild.roles.create({
      name,
      color,
      permissions: [],
      mentionable: true,
      hoist: true, // se muestra aparte en la lista de miembros, para que se note
      reason: 'Rol de campeón de temporada'
    }).catch(() => null);
    if (role) store.championRoleId = role.id;
  }

  return role;
}

/**
 * Corre justo ANTES de resetear el elo de una cola (necesita el elo tal
 * como está, no el ya reseteado). Si esa cola tiene el rol de campeón
 * activado, determina el top 3 por elo, actualiza/crea el rol y se lo
 * reasigna al nuevo n°1. Devuelve los datos del podio (o null si está
 * desactivado o todavía nadie jugó ahí).
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
  const champion = ranked[0] || null;
  const podium = { modeLabel, season, first: champion, second: ranked[1] || null, third: ranked[2] || null };

  // Si nadie jugó, igual se devuelve un podio (vacío) para que el reset de
  // ESTA cola siempre se anuncie. Sin ganador no hay rol ni @everyone.
  // Tampoco hay rol/@everyone si la cola no tiene el rol de campeón activado
  // (/campeon_configurar): el podio sale igual.
  if (!champion || !store.championEnabled) return { ...podium, role: null, hasChampionRole: false };

  // Si algo falla con el rol de campeón (permisos, jerarquía), el podio se
  // anuncia igual: no se pierde por eso.
  let role = null;
  try {
    role = await ensureChampionRole(guild, store, modeLabel, season);
    if (role) {
      if (store.currentChampionId && store.currentChampionId !== champion.userId) {
        const prevMember = await guild.members.fetch(store.currentChampionId).catch(() => null);
        if (prevMember) await prevMember.roles.remove(role).catch(() => {});
      }
      const member = await guild.members.fetch(champion.userId).catch(() => null);
      if (member) await member.roles.add(role).catch(() => {});
      store.currentChampionId = champion.userId;
    }
  } catch (err) {
    console.error('[campeon] No pude dar el rol de campeón:', err.message);
  }

  return { ...podium, role, hasChampionRole: true };
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
        ? `${podiumLine('🥇', result.first)}${result.role ? ` — <@&${result.role.id}>` : ''}\n` +
          `${podiumLine('🥈', result.second)}\n` +
          `${podiumLine('🥉', result.third)}\n\n` +
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

module.exports = { ensureChampionRole, awardChampionRole, announceChampions };