/**
 * Devuelve el nombre "de arriba" que se debe mostrar en los embeds: el nombre
 * guardado en el bot (editable con /rename), o si el jugador nunca se renombró,
 * su apodo del servidor (nickname) o su nombre global de Discord — NUNCA el
 * username/tag (ej. "marckcv.").
 */
function displayName(guildData, userId, discordMember) {
  const p = guildData.players[userId];
  if (p && p.name) return p.name;
  if (discordMember) {
    return discordMember.nickname || discordMember.user.globalName || discordMember.user.username;
  }
  return userId;
}

function fmtElo(elo) {
  return `${elo}`;
}

module.exports = { displayName, fmtElo };
