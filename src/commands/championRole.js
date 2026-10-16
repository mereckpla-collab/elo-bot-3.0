const { EmbedBuilder } = require('discord.js');

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
  if (!store || !store.championEnabled) return null;

  const ranked = Object.values(store.players || {})
    .filter(p => p.gamesPlayed > 0)
    .sort((a, b) => b.elo - a.elo);
  if (!ranked.length) return null;

  const modeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'Cola por defecto';
  const season = guildData.season || 1; // la temporada que está terminando, no la que arranca
  const champion = ranked[0];

  const role = await ensureChampionRole(guild, store, modeLabel, season);

  if (role) {
    if (store.currentChampionId && store.currentChampionId !== champion.userId) {
      const prevMember = await guild.members.fetch(store.currentChampionId).catch(() => null);
      if (prevMember) await prevMember.roles.remove(role).catch(() => {});
    }
    const member = await guild.members.fetch(champion.userId).catch(() => null);
    if (member) await member.roles.add(role).catch(() => {});
    store.currentChampionId = champion.userId;
  }

  return { role, modeLabel, season, first: champion, second: ranked[1] || null, third: ranked[2] || null };
}

/** Publica en #anuncios el podio de la temporada que terminó, con @everyone. */
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
    .setTitle(`🏆 ¡Campeón de la Temporada ${result.season} — ${result.modeLabel}!`)
    .setDescription(
      `${podiumLine('🥇', result.first)}${result.role ? ` — <@&${result.role.id}>` : ''}\n` +
      `${podiumLine('🥈', result.second)}\n` +
      `${podiumLine('🥉', result.third)}\n\n` +
      `¡Felicidades a todos! Arranca la próxima temporada 👇`
    )
    .setTimestamp();

  await channel.send({
    content: '@everyone',
    embeds: [embed],
    allowedMentions: { parse: ['everyone'] }
  }).catch(() => {});
}

module.exports = { ensureChampionRole, awardChampionRole, announceChampions };
