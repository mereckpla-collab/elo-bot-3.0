const { EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { getRankForElo, rankIndex, rankBadge } = require('../utils/ranks');
const { RANKS } = require('../config');

/** El valor actual del jugador para esa métrica. */
function computeStat(player, metric) {
  switch (metric) {
    case 'elo': return player.elo;
    case 'racha': return player.streak > 0 ? player.streak : 0;
    case 'partidas': return player.gamesPlayed;
    case 'winrate': return player.gamesPlayed > 0 ? (player.wins / player.gamesPlayed) * 100 : 0;
    default: return -Infinity;
  }
}

function statLabel(metric, value) {
  switch (metric) {
    case 'elo': return `${Math.round(value)} de Elo`;
    case 'racha': return `una racha de ${Math.round(value)} partidas ganadas`;
    case 'partidas': return `${Math.round(value)} partidas jugadas`;
    case 'winrate': return `${value.toFixed(1)}% de win rate`;
    default: return `${value}`;
  }
}

// --- Anuncios en #anuncios ---------------------------------------------------
// Como cada modo tiene sus propios roles, en el texto se aclara en qué modo
// fue. La cola "de siempre" (sin modo) no lo menciona.
function modeText(modeKey, modeLabel) {
  return modeKey ? ` en el modo **${modeLabel}**` : '';
}

// En qué temporadas consiguió el jugador este logro (la primera, guardada en
// info.season, más cada temporada en la que se volvió a anunciar). Sirve para
// mostrar "Aprendiz (x2)" en vez de repetir el rol una vez por temporada.
function earnedSeasons(info) {
  if (!info) return [];
  const set = new Set();
  if (info.season != null) set.add(Number(info.season));
  for (const [k, st] of Object.entries(info.seasons || {})) {
    if (st && st.unlocked) set.add(Number(k));
  }
  return [...set].sort((a, b) => a - b);
}

function timesTag(info) {
  const n = earnedSeasons(info).length;
  return n > 1 ? ` (x${n})` : '';
}

function roleText(ach) {
  return ach.roleId ? `<@&${ach.roleId}>` : `**${ach.name}**`;
}

async function sendAnnouncement(channel, { color, description, content, pingEveryone, badge }) {
  if (!channel) {
    console.warn('[logros] No hay canal de anuncios configurado (o no lo encuentro), no se pudo anunciar:', description);
    return;
  }
  const embed = new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
  // Insignia del rango arriba a la derecha del anuncio (como en MrHOST).
  if (badge) embed.setThumbnail(badge.url);
  const payload = { embeds: [embed] };
  if (badge) payload.files = [badge.attachment];
  const text = `${pingEveryone ? '@everyone ' : ''}${content || ''}`.trim();
  if (text) payload.content = text;
  // Solo se permite mencionar @everyone si el admin activó ese rol con
  // /rol_everyone; en cualquier otro caso solo se pingea al jugador.
  payload.allowedMentions = { parse: pingEveryone ? ['users', 'everyone'] : ['users'] };
  await channel.send(payload).catch(err => {
    console.error('[logros] No pude enviar el anuncio al canal (¿permisos?):', err.message);
  });
}

async function announcePublicUnlock(channel, ach, player, modeKey, modeLabel, season, value, userId) {
  await sendAnnouncement(channel, {
    color: ach.color || 0xFEE75C,
    content: `<@${userId}>`,
    pingEveryone: Boolean(ach.pingEveryone),
    description:
      `🎉 **${player.name}** llegó a ${statLabel(ach.metric, value)}${modeText(modeKey, modeLabel)} y desbloqueó el rol ` +
      `${roleText(ach)}${timesTag(player.achievements?.[ach.key])} ${ach.emoji || '🏆'}\n-# ${modeLabel} · Temporada ${season}`
  });
}

// Mensajes de burla para los roles negativos (se elige uno al azar). Un rol
// puede tener su propio mensaje (/crear_rol_negativo mensaje:...) con los
// mismos marcadores: {jugador} {elo} {rol} {modo}.
const MOCK_MESSAGES = [
  '🤡 **{jugador}** cayó a {elo} de Elo en {modo} y se ganó el rol {rol}. ¡Un aplauso para el artista! 👏',
  '💀 Atención a todos: **{jugador}** llegó a {elo} de Elo en {modo}. Le entregamos el rol {rol} con mucho cariño.',
  '📉 **{jugador}** descubrió que el elo también puede ir para abajo: {elo} en {modo}. Bienvenido al club {rol} 🫡',
  '🪦 F por **{jugador}**: {elo} de Elo en {modo}. Se desbloqueó el rol {rol}.',
  '🚑 Llamen a una ambulancia, **{jugador}** está en {elo} de Elo en {modo}. Ya tiene su rol {rol}.',
  '🎪 El circo abrió función en {modo}: **{jugador}** ({elo} de Elo) es el artista principal y se lleva el rol {rol}.'
];

function renderMock(template, vars) {
  return template
    .replaceAll('{jugador}', vars.jugador)
    .replaceAll('{elo}', vars.elo)
    .replaceAll('{rol}', vars.rol)
    .replaceAll('{modo}', vars.modo);
}

async function announceNegativeUnlock(channel, ach, player, modeKey, modeLabel, season, userId) {
  const template = ach.mockMessage || MOCK_MESSAGES[Math.floor(Math.random() * MOCK_MESSAGES.length)];
  const text = renderMock(template, {
    jugador: player.name,
    elo: String(Math.round(player.elo)),
    rol: `${roleText(ach)}${timesTag(player.achievements?.[ach.key])}`,
    modo: modeKey ? `**${modeLabel}**` : modeLabel
  });
  await sendAnnouncement(channel, {
    color: ach.color || 0xED4245,
    content: `<@${userId}>`,
    pingEveryone: Boolean(ach.pingEveryone),
    description: `${text}\n-# ${modeLabel} · Temporada ${season}`
  });
}

async function announceRoleLost(channel, ach, player, modeKey, modeLabel, season, userId) {
  await sendAnnouncement(channel, {
    color: 0xED4245,
    description:
      `📉 **${player.name}** bajó de ${statLabel(ach.metric, ach.threshold)}${modeText(modeKey, modeLabel)} y perdió el rol ` +
      `${roleText(ach)} ${ach.emoji || '🏆'}\n-# ${modeLabel} · Temporada ${season}`
  });
}

async function announceRoleRegained(channel, ach, player, modeKey, modeLabel, season, userId) {
  await sendAnnouncement(channel, {
    color: ach.color || 0x57F287,
    content: `<@${userId}>`,
    description:
      `🔁 **${player.name}** volvió a conseguir el rol ${roleText(ach)} ${ach.emoji || '🏆'}${modeText(modeKey, modeLabel)}\n` +
      `-# ${modeLabel} · Temporada ${season}`
  });
}

// --- Estado de cada logro POR TEMPORADA ---------------------------------------
// player.achievements[key] guarda cuándo se ganó por primera vez (eso lo usan
// /logros y /logros_progreso y sobrevive a /reset_season). Aparte, en
// player.achievements[key].seasons[N] se lleva qué se anunció en la
// temporada N: { unlocked, lost, dropAnnounced, regainAnnounced }. Así, cada
// temporada nueva vuelve a anunciar el desbloqueo, y dentro de una temporada
// la baja y la recuperación se anuncian UNA sola vez cada una.
function newSeasonState() {
  return { unlocked: true, lost: false, dropAnnounced: false, regainAnnounced: false };
}

function getSeasonState(player, key, season) {
  const info = player.achievements[key];
  if (!info) return null;
  if (!info.seasons) info.seasons = {};
  if (!info.seasons[season]) {
    // Logros ganados (y ya anunciados) en esta misma temporada antes de que
    // existiera este seguimiento: se dan por anunciados.
    if (info.season === season) info.seasons[season] = newSeasonState();
    else return null;
  }
  return info.seasons[season];
}

function openSeasonState(player, ach, season, modeKey) {
  if (!player.achievements[ach.key]) {
    player.achievements[ach.key] = { season, modeKey: modeKey || null, earnedAt: Date.now() };
  }
  const info = player.achievements[ach.key];
  if (!info.seasons) info.seasons = {};
  info.seasons[season] = newSeasonState();
  return info.seasons[season];
}

/**
 * Revisa los logros/roles configurados en la cola de esta partida (store) y
 * se lo otorga a cada jugador involucrado. Se llama después de aplicar un
 * resultado (o de que /revertir lo corrija). userIds: a quién revisar
 * (normalmente los jugadores de esa partida). No hace nada si esa cola no
 * tiene ningún rol configurado.
 *
 * Los roles de tipo "elo" son distintos al resto: como el elo sube y baja
 * todo el tiempo, forman UNA sola escalera — el jugador tiene puesto, como
 * mucho, el de su tier ACTUAL (el más alto que su elo de ahora le alcance),
 * nunca varios a la vez (para no llenarle el perfil de roles de tiers
 * viejos). Si el elo baja y deja de alcanzarle para el que tenía, se le
 * saca ese rol y se le avisa por DM (privado, solo lo ve él). Los demás
 * tipos de logro (racha/winrate/partidas) representan una hazaña que ya
 * pasó, así que una vez conseguidos quedan para siempre.
 */
// --- Rangos (Bronce, Plata, Oro...) ------------------------------------------
// Cada jugador guarda `currentRank` (el rango en el que está) y `rankHistory`
// ({ rango: [temporadas en las que estuvo ahí] }, se conserva entre
// temporadas: de ahí sale "Bronce ×2"). Subir a un rango NUEVO se anuncia en
// #anuncios una sola vez por temporada (si baja y vuelve a subir en la misma
// temporada, no se repite). Bajar de rango no se anuncia.
async function announceRankUp(channel, tier, prevKey, player, modeKey, modeLabel, season, userId, times) {
  const prev = RANKS.find(r => r.key === prevKey);
  await sendAnnouncement(channel, {
    color: tier.color,
    content: `<@${userId}>`,
    badge: rankBadge(tier.rankKey),
    description:
      `🆙 **${player.name}** ha conseguido el rango **${tier.name}** ${tier.emoji}${times > 1 ? ` (x${times})` : ''}${modeText(modeKey, modeLabel)}` +
      `${prev ? ` — subió de ${prev.emoji} ${prev.name}` : ''}\n` +
      `-# ${modeLabel} · Temporada ${season}`
  });
}

async function checkRankUps(client, guildId, modeKey, userIds) {
  const guildData = getGuild(guildId);
  const store = modeKey ? guildData.modes[modeKey] : guildData;
  if (!store) return;

  const season = guildData.season || 1;
  const modeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'la cola por defecto';
  let channel = null;
  let changed = false;

  for (const userId of userIds) {
    const player = store.players[userId];
    if (!player) continue;

    const tier = getRankForElo(player.elo);
    player.rankHistory = player.rankHistory || {};
    const hist = player.rankHistory;
    // Anota la temporada en el historial de ese rango; devuelve true si era la primera vez.
    const record = key => {
      hist[key] = hist[key] || [];
      if (hist[key].includes(season)) return false;
      hist[key].push(season);
      return true;
    };

    const prev = player.currentRank;
    if (!prev) {
      // Jugador anterior a este sistema: se anota donde está, sin anunciar nada.
      player.currentRank = tier.rankKey;
      record(tier.rankKey);
      changed = true;
      continue;
    }

    if (prev !== tier.rankKey) {
      const up = rankIndex(tier.rankKey) > rankIndex(prev);
      const firstThisSeason = record(tier.rankKey);
      player.currentRank = tier.rankKey;
      changed = true;
      if (up && firstThisSeason) {
        if (!channel && guildData.channels.anuncios) {
          channel = await client.channels.fetch(guildData.channels.anuncios).catch(() => null);
        }
        await announceRankUp(channel, tier, prev, player, modeKey, modeLabel, season, userId, hist[tier.rankKey].length);
      }
    } else if (record(tier.rankKey)) {
      changed = true;
    }
  }

  if (changed) saveGuild(guildId, guildData);
}

async function checkAndGrantAchievements(client, guildId, modeKey, userIds) {
  if (!userIds || !userIds.length) return;

  // Primero los rangos (funcionan aunque el modo no tenga roles de logro).
  await checkRankUps(client, guildId, modeKey, userIds)
    .catch(err => console.error('[rangos] No pude revisar los rangos:', err.message));

  const guildData = getGuild(guildId);
  const store = modeKey ? guildData.modes[modeKey] : guildData;
  if (!store) {
    console.warn(`[logros] El modo "${modeKey}" no existe en la base de datos, no se revisó nada.`);
    return;
  }
  // Un modo sin roles de logro es normal (los rangos ya se revisaron arriba).
  if (!store.roleAchievements || !Object.keys(store.roleAchievements).length) return;

  const achievements = Object.values(store.roleAchievements);

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.warn('[logros] No pude obtener el servidor (guild) desde Discord, no se revisó nada.');
    return;
  }

  const announceChannelId = guildData.channels.anuncios;
  const announceChannel = announceChannelId
    ? await client.channels.fetch(announceChannelId).catch(() => null)
    : null;

  const modeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'la cola por defecto';
  const season = guildData.season || 1; // la temporada es una sola, compartida por todas las colas

  // Los roles "negativos" (/crear_rol_negativo) son de tipo elo pero con meta
  // por debajo de cero: tienen su propia escalera aparte.
  const eloAchievements = achievements.filter(a => a.metric === 'elo' && !a.negative).sort((a, b) => a.threshold - b.threshold);
  const negativeAchievements = achievements.filter(a => a.metric === 'elo' && a.negative).sort((a, b) => b.threshold - a.threshold);
  const otherAchievements = achievements.filter(a => a.metric !== 'elo');

  let changed = false;

  for (const userId of userIds) {
    const player = store.players[userId];
    if (!player) {
      console.warn(`[logros] Jugador ${userId} no está en ${modeKey || 'default'}, se salta.`);
      continue;
    }
    player.achievements = player.achievements || {};

    // --- Logros permanentes (racha / winrate / partidas jugadas) ---
    // Una vez conseguidos se quedan con el rol para siempre, pero cada
    // temporada nueva se vuelve a anunciar cuando se alcanzan de nuevo.
    for (const ach of otherAchievements) {
      if (ach.metric === 'winrate' && player.gamesPlayed < (ach.minGames || 1)) continue;

      const value = computeStat(player, ach.metric);
      if (value < ach.threshold) continue;
      if (getSeasonState(player, ach.key, season)) continue; // ya anunciado esta temporada

      openSeasonState(player, ach, season, modeKey);
      changed = true;

      if (ach.roleId) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.add(ach.roleId).catch(() => {});
      }
      await announcePublicUnlock(announceChannel, ach, player, modeKey, modeLabel, season, value, userId);
    }

    // --- Escalera de Elo (dinámica, un solo rol puesto a la vez) ---
    if (eloAchievements.length) {
      let target = null;
      for (const ach of eloAchievements) {
        if (player.elo >= ach.threshold) target = ach; // están ordenados de menor a mayor: el último que cumpla es el tier más alto
      }

      const currentKey = player.currentEloRole || null;
      const targetKey = target ? target.key : null;

      if (targetKey !== currentKey) {
        const currentAch = currentKey ? store.roleAchievements[currentKey] : null;
        const isDowngrade = currentAch && (!target || target.threshold < currentAch.threshold);
        const member = await guild.members.fetch(userId).catch(() => null);

        if (currentAch?.roleId && member) {
          await member.roles.remove(currentAch.roleId).catch(() => {});
        }
        if (target?.roleId && member) {
          await member.roles.add(target.roleId).catch(() => {});
        }

        if (isDowngrade) {
          // Se anuncia la baja SOLO la primera vez (por temporada); las
          // siguientes bajas del mismo rol ya no se muestran.
          const st = getSeasonState(player, currentAch.key, season) || openSeasonState(player, currentAch, season, modeKey);
          st.lost = true;
          if (!st.dropAnnounced) {
            st.dropAnnounced = true;
            await announceRoleLost(announceChannel, currentAch, player, modeKey, modeLabel, season, userId);
          }

          if (!player.dmTagDisabled) {
            const dmUser = await client.users.fetch(userId).catch(() => null);
            if (dmUser) {
              const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setDescription(
                  `📉 Bajaste a **${Math.round(player.elo)}** de Elo en **${modeLabel}** y se te quitó el rol **${currentAch.name}** ` +
                  `(hacía falta ${currentAch.threshold}+).` +
                  (target ? ` Ahora te corresponde **${target.name}**.` : '')
                );
              await dmUser.send({ embeds: [embed] }).catch(() => {});
            }
          }
        }

        player.currentEloRole = targetKey;
        changed = true;
      }

      // Anuncio del rol que le corresponde ahora. Se revisa SIEMPRE (no solo
      // cuando cambia de rol) para que, si el rol ya estaba puesto pero nunca
      // se anunció en esta temporada, igual salga.
      if (target) {
        const st = getSeasonState(player, target.key, season);
        if (!st) {
          // Primera vez en esta temporada que alcanza este rol.
          openSeasonState(player, target, season, modeKey);
          changed = true;
          await announcePublicUnlock(announceChannel, target, player, modeKey, modeLabel, season, player.elo, userId);
        } else if (st.lost) {
          // Lo había perdido y lo recuperó: se anuncia UNA sola vez; a partir
          // de la segunda baja/recuperación ya no se muestra nada.
          st.lost = false;
          changed = true;
          if (!st.regainAnnounced) {
            st.regainAnnounced = true;
            await announceRoleRegained(announceChannel, target, player, modeKey, modeLabel, season, userId);
          }
        }
      }
    }

    // --- Escalera NEGATIVA de Elo (roles de burla, un solo rol puesto a la vez) ---
    // Ordenados de menos a más negativo: el último que cumpla es el más grave.
    if (negativeAchievements.length) {
      let negTarget = null;
      for (const ach of negativeAchievements) {
        if (player.elo <= ach.threshold) negTarget = ach;
      }

      const negCurrentKey = player.currentNegRole || null;
      const negTargetKey = negTarget ? negTarget.key : null;

      if (negTargetKey !== negCurrentKey) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          // Se sacan los roles negativos que ya no le corresponden (incluye
          // alguno que haya quedado de una temporada anterior).
          for (const ach of negativeAchievements) {
            if (ach.roleId && (!negTarget || ach.roleId !== negTarget.roleId)) {
              await member.roles.remove(ach.roleId).catch(() => {});
            }
          }
          if (negTarget?.roleId) await member.roles.add(negTarget.roleId).catch(() => {});
        }
        player.currentNegRole = negTargetKey;
        changed = true;
      }

      // Se anuncia (con burla) UNA vez por temporada por cada rol negativo;
      // en las temporadas siguientes se acumula como "(x2)", "(x3)"...
      if (negTarget && !getSeasonState(player, negTarget.key, season)) {
        openSeasonState(player, negTarget, season, modeKey);
        changed = true;
        await announceNegativeUnlock(announceChannel, negTarget, player, modeKey, modeLabel, season, userId);
      }
    }
  }

  if (changed) saveGuild(guildId, guildData);
}

module.exports = { checkAndGrantAchievements, checkRankUps, computeStat, statLabel, earnedSeasons };