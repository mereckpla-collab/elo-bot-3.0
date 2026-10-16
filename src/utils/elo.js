const { ELO_START, ELO_FLOOR, MAX_LOSS, WIN_BASE_ELO, LOSS_BASE_ELO } = require('../config');

/**
 * Ya NO hay bonus fijo para el primer partido de un jugador (antes daba
 * ±12 siempre, sin importar el rival) — ahora el primer partido se calcula
 * exactamente igual que cualquier otro, con el mismo diff/streak de siempre.
 *
 * Balance ganar/perder: ganar da más de lo que perder cuesta (WIN_BASE_ELO
 * > LOSS_BASE_ELO en config.js), así que en partidas parejas el jugador
 * gana más de lo que arriesga a perder.
 *
 * La racha SOLO da bonus cuando es positiva y estás ganando (racha anterior
 * × 2, tope 15) — venir de una racha negativa y perder NO te castiga extra,
 * la pérdida es siempre la misma base según la diferencia de elo entre
 * equipos, sin importar tu racha.
 */
function calculateEloChange({ player, teamAvgElo, opponentAvgElo, won, draw }) {
  if (draw) return 0;

  const diff = opponentAvgElo - teamAvgElo; // positivo = rival más fuerte
  const streak = player.streak || 0;

  if (won) {
    let base = WIN_BASE_ELO + diff / 20;
    base = Math.max(5, base);

    const streakBonus = streak > 0 ? Math.min(streak * 2, 15) : 0;
    let gain = base + streakBonus;

    if (diff < -100 && streak < 3) {
      gain = Math.max(4, gain * 0.35);
    }

    return Math.round(gain);
  }

  let loss = LOSS_BASE_ELO - diff / 25;
  loss = Math.min(Math.max(loss, 3), MAX_LOSS);
  return -Math.round(loss);
}

function avgElo(players) {
  if (!players.length) return ELO_START;
  return players.reduce((sum, p) => sum + p.elo, 0) / players.length;
}

/** Aplica un delta de elo sin dejar que baje del piso (ELO_FLOOR). Devuelve
 *  el delta REALMENTE aplicado (puede ser menor en valor absoluto si el
 *  jugador ya estaba pegado al piso). */
function applyDeltaWithFloor(player, delta) {
  const before = player.elo;
  let after = before + delta;
  if (after < ELO_FLOOR) after = ELO_FLOOR;
  player.elo = after;
  return { before, after, appliedDelta: after - before };
}

/**
 * Guarda una "foto" completa del jugador ANTES de tocarlo, para que
 * revertGameResult pueda restaurar el estado exacto en el que estaba —
 * no solo el elo y la racha, sino también wins/losses/draws/gamesPlayed/
 * firstGamePlayed. Esto evita que un revert deje al jugador en un estado
 * a medias (como pasaba antes: firstGamePlayed quedaba en true después de
 * revertir, y un recálculo posterior ya no calificaba para el bonus de
 * primer partido que sí se había aplicado la primera vez).
 */
function snapshotBefore(p) {
  if (!p.history) p.history = [];
  return {
    elo: p.elo,
    streak: p.streak || 0,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    gamesPlayed: p.gamesPlayed,
    firstGamePlayed: p.firstGamePlayed,
    historyLength: p.history.length
  };
}

function applyGameResult(guildData, team1Players, team2Players, outcome) {
  const changes = {};
  const team1Avg = avgElo(team1Players);
  const team2Avg = avgElo(team2Players);

  const process = (teamPlayers, teamAvg, oppAvg, won, draw) => {
    for (const p of teamPlayers) {
      const snapshot = snapshotBefore(p);
      const streakBefore = snapshot.streak;

      const rawDelta = calculateEloChange({
        player: p,
        teamAvgElo: teamAvg,
        opponentAvgElo: oppAvg,
        won,
        draw
      });

      const { before, after, appliedDelta } = applyDeltaWithFloor(p, rawDelta);
      p.gamesPlayed += 1;
      p.firstGamePlayed = true;
      p.history.push(after);

      if (draw) {
        p.draws += 1;
      } else if (won) {
        p.wins += 1;
        p.streak = streakBefore > 0 ? streakBefore + 1 : 1;
      } else {
        p.losses += 1;
        p.streak = streakBefore < 0 ? streakBefore - 1 : -1;
      }

      p.bestElo = Math.max(p.bestElo, p.elo);
      p.worstElo = Math.min(p.worstElo, p.elo);
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.worstStreak = Math.min(p.worstStreak, p.streak);

      changes[p.userId] = { before, after, delta: appliedDelta, streakBefore, streakAfter: p.streak, snapshot };
    }
  };

  if (outcome === 'draw') {
    process(team1Players, team1Avg, team2Avg, false, true);
    process(team2Players, team2Avg, team1Avg, false, true);
  } else if (outcome === 'team1') {
    process(team1Players, team1Avg, team2Avg, true, false);
    process(team2Players, team2Avg, team1Avg, false, false);
  } else if (outcome === 'team2') {
    process(team1Players, team1Avg, team2Avg, false, false);
    process(team2Players, team2Avg, team1Avg, true, false);
  }

  return changes;
}

/**
 * Resultado por RANKING (3+ equipos, Etapa 3c). rankedTeams = array de
 * arrays de jugadores, en orden de puesto (index 0 = 1°, el último = el
 * peor puesto). Cada equipo se compara contra TODOS los demás con la misma
 * fórmula de siempre (calculateEloChange), y el cambio final es el
 * promedio de esas comparaciones — así el 1° gana bastante, el 2° gana
 * poco, el anteúltimo pierde poco, y el último pierde más.
 *
 * Para las estadísticas de wins/losses/racha: el 1er puesto cuenta como
 * victoria, cualquier otro puesto cuenta como derrota (el matiz de "casi
 * ganaste" ya queda reflejado en el propio número de elo, no en la racha).
 */
function applyRankedGameResult(guildData, rankedTeams) {
  const changes = {};
  const teamAvgs = rankedTeams.map(avgElo);

  rankedTeams.forEach((teamPlayers, i) => {
    const opponents = teamAvgs.map((_, j) => j).filter(j => j !== i);
    const isFirstPlace = i === 0;

    for (const p of teamPlayers) {
      const snapshot = snapshotBefore(p);
      const streakBefore = snapshot.streak;

      let totalDelta = 0;
      for (const j of opponents) {
        totalDelta += calculateEloChange({
          player: p,
          teamAvgElo: teamAvgs[i],
          opponentAvgElo: teamAvgs[j],
          won: i < j, // terminó por delante del equipo j
          draw: false
        });
      }
      const rawDelta = Math.round(totalDelta / opponents.length);
      const { before, after, appliedDelta } = applyDeltaWithFloor(p, rawDelta);

      p.gamesPlayed += 1;
      p.firstGamePlayed = true;
      p.history.push(after);

      if (isFirstPlace) {
        p.wins += 1;
        p.streak = streakBefore > 0 ? streakBefore + 1 : 1;
      } else {
        p.losses += 1;
        p.streak = streakBefore < 0 ? streakBefore - 1 : -1;
      }

      p.bestElo = Math.max(p.bestElo, p.elo);
      p.worstElo = Math.min(p.worstElo, p.elo);
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.worstStreak = Math.min(p.worstStreak, p.streak);

      changes[p.userId] = { before, after, delta: appliedDelta, streakBefore, streakAfter: p.streak, snapshot };
    }
  });

  return changes;
}

/**
 * Restaura al jugador EXACTAMENTE como estaba antes de esta partida —
 * elo, racha, wins/losses/draws, gamesPlayed y firstGamePlayed — usando la
 * "foto" guardada en cada change. Si un change viejo (de antes de este
 * arreglo) no tiene snapshot, se hace un mejor-esfuerzo con lo que había
 * antes (solo elo/racha/gamesPlayed), como funcionaba hasta ahora.
 */
function revertGameResult(guildData, previousChanges) {
  for (const userId of Object.keys(previousChanges)) {
    const p = guildData.players[userId];
    if (!p) continue;
    const c = previousChanges[userId];

    if (c.snapshot) {
      p.elo = c.snapshot.elo;
      p.streak = c.snapshot.streak;
      p.wins = c.snapshot.wins;
      p.losses = c.snapshot.losses;
      p.draws = c.snapshot.draws;
      p.gamesPlayed = c.snapshot.gamesPlayed;
      p.firstGamePlayed = c.snapshot.firstGamePlayed;
      if (p.history && typeof c.snapshot.historyLength === 'number') {
        p.history.length = c.snapshot.historyLength;
      }
    } else {
      p.elo = c.before;
      p.streak = c.streakBefore;
      p.gamesPlayed = Math.max(0, p.gamesPlayed - 1);
    }
  }
}

module.exports = { calculateEloChange, applyGameResult, applyRankedGameResult, revertGameResult, avgElo };