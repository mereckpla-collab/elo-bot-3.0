// Un solo rol de temporada para todo el servidor (la temporada es UNA sola,
// compartida por todas las colas/modos). Se crea UNA vez y después solo se le
// cambia el número del nombre ("───── TEMPORADA 3 ─────"): nunca se vuelve
// a crear, mover ni recolorear, así que queda exactamente donde lo dejó el
// admin. Lo único que el bot cuida solo es que los roles de logro (de
// cualquier cola, /crear_rol) queden SIEMPRE por debajo de este rol.

// Ids de todos los roles de logro del servidor (cola de siempre + cada modo).
function achievementRoleIds(guildData) {
  const ids = new Set();
  const collect = store => {
    for (const a of Object.values(store?.roleAchievements || {})) if (a.roleId) ids.add(a.roleId);
  };
  collect(guildData);
  for (const mode of Object.values(guildData.modes || {})) collect(mode);
  return [...ids];
}

async function fetchRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.fetch(roleId, { force: true }).catch(() => null);
}

// Si un rol de logro quedó por encima (o al mismo nivel) del rol de
// temporada, lo baja justo debajo. No toca el rol de temporada.
async function placeBelowSeasonRole(guild, guildData, role) {
  if (!role) return;
  let divider = await fetchRole(guild, guildData.seasonDividerRoleId);
  if (!divider || role.id === divider.id) return;
  if (role.position < divider.position) return; // ya está debajo
  await role.setPosition(Math.max(1, divider.position - 1)).catch(() => {});
}

async function keepAchievementRolesBelow(guild, guildData) {
  for (const roleId of achievementRoleIds(guildData)) {
    const role = await fetchRole(guild, roleId);
    await placeBelowSeasonRole(guild, guildData, role);
  }
}

async function ensureSeasonDividerRole(guild, guildData, seasonNumber) {
  const name = `───── TEMPORADA ${seasonNumber} ─────`;

  let role = await fetchRole(guild, guildData.seasonDividerRoleId);

  if (role) {
    // Solo cambia el número. Ni la posición ni el color se tocan: quedan
    // como los dejó el admin.
    await role.edit({ name }).catch(() => {});
  } else {
    // Sin color: así, al quedar ARRIBA de los roles de logro, no les tapa
    // el color del nombre a quienes lo tienen puesto.
    role = await guild.roles.create({
      name,
      color: 0,
      permissions: [],
      mentionable: false,
      hoist: false,
      reason: 'Rol de temporada (/temporada)'
    }).catch(() => null);
    if (role) {
      guildData.seasonDividerRoleId = role.id;
      // Primera vez: se pone justo arriba del rol de logro más alto que ya
      // exista (sin pasarse del rol del bot). Si no hay ninguno todavía,
      // queda donde Discord lo crea, y los roles de logro que se creen
      // después caen por debajo solos.
      let highestAch = 0;
      for (const roleId of achievementRoleIds(guildData)) {
        const r = await fetchRole(guild, roleId);
        if (r && r.position > highestAch) highestAch = r.position;
      }
      if (highestAch > 0) {
        const botTop = guild.members?.me?.roles?.highest?.position ?? Infinity;
        await role.setPosition(Math.min(highestAch + 1, botTop - 1)).catch(() => {});
      }
    }
  }

  if (role) await keepAchievementRolesBelow(guild, guildData);
  return role;
}

// Publica en #anuncios un mensaje "separador" avisando que arrancó una
// temporada nueva — para que quede marcado en el historial del canal, igual
// que el rol gris lo marca en la lista de roles. La temporada es UNA sola,
// compartida por todas las colas/modos (no hay una por cada una), así que
// el mensaje no menciona ninguna cola en particular — eso ya lo indican por
// separado los anuncios de logros de cada una.
async function announceSeasonChange(client, guildData, seasonNumber) {
  const channelId = guildData.channels?.anuncios;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(0x99AAB5) // gris, a tono con el rol separador
    .setDescription(`\u200b\n### ───────── 🗓️ TEMPORADA ${seasonNumber} ─────────\n\u200b`);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

// Le pone el rol de temporada actual a quien se une a una cola — así el rol
// deja de ser solo un separador que nadie tiene, y pasa a marcar quién
// jugó ESTA temporada. Si todavía no existe (nadie corrió /temporada ni
// /reset_season nunca), se crea solo en Temporada 1 la primera vez que
// hace falta. Si la persona ya está marcada esta temporada, no hace nada
// (evita pegarle al API de Discord de más en cada re-join).
async function tagSeasonParticipant(guild, guildData, userId) {
  guildData.seasonParticipants = guildData.seasonParticipants || {};
  if (guildData.seasonParticipants[userId]) return;

  let role = guildData.seasonDividerRoleId
    ? await guild.roles.fetch(guildData.seasonDividerRoleId).catch(() => null)
    : null;
  if (!role) role = await ensureSeasonDividerRole(guild, guildData, guildData.season || 1);
  if (!role) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await member.roles.add(role).catch(() => {});
  guildData.seasonParticipants[userId] = true;
}

// Se corre al resetear la temporada (antes de renombrar el rol): le saca
// el rol a todos los que lo tenían marcado de la temporada que termina, y
// vacía la lista — así el rol, ya renombrado a la temporada nueva, arranca
// sin nadie puesto, y se va llenando de nuevo con quien se una de ahora en
// más.
async function clearSeasonParticipants(guild, guildData) {
  if (!guildData.seasonDividerRoleId) return;
  const participants = Object.keys(guildData.seasonParticipants || {});
  for (const userId of participants) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(guildData.seasonDividerRoleId).catch(() => {});
  }
  guildData.seasonParticipants = {};
}

module.exports = { ensureSeasonDividerRole, announceSeasonChange, tagSeasonParticipant, clearSeasonParticipants, placeBelowSeasonRole };