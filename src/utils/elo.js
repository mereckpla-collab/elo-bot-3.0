const { ELO_START, ELO_FLOOR } = require('../config');
const C = require('../eloConfig');

/**
 * Elo estilo "clásico" (probabilidad de ganar), con ajustes para 4v4:
 *
 *  1) Se calcula la probabilidad esperada de que tu equipo gane según el
 *     promedio de Elo de cada equipo. Ganar siendo el favorito da poco;
 *     ganar siendo el "underdog" da mucho. Perder siendo el favorito cuesta
 *     mucho; perder siendo el underdog cuesta poco. Empatar también mueve
 *     puntos si los equipos eran desparejos.
 *  2) El K (cuánto se puede mover) depende de cuántas partidas llevas: los
 *     nuevos suben/bajan rápido, los veteranos son más estables.
 *  3) Rachas: ganar seguido suma un % extra a lo que ganas; perder cuando
 *     venías con racha de 3+ victorias cuesta un % extra. Perder seguido NO
 *     te castiga extra: desde la 3ª derrota seguida cada una te quita menos.
 *
 *  2) (Ajuste personal) Tu Elo contra el promedio de la partida: si estás
 *     por debajo ganas más y pierdes menos; si estás por encima, al revés.
 *
 *  4) Impulso en rangos bajos: ganas más y pierdes menos mientras tu Elo es
 *     bajo; se apaga solo al acercarte a BOOST_UNTIL.
 *
 * Todos los números viven en src/eloConfig.js.
 */
function expectedScore(teamAvgElo, opponentAvgElo) {
  return 1 / (1 + Math.pow(10, (opponentAvgElo - teamAvgElo) / C.ELO_SCALE));
}

function kFactor(gamesPlayed) {
  const n = gamesPlayed || 0;
  for (const tier of C.K_TIERS) if (n < tier.upTo) return tier.k;
  return C.K_TIERS[C.K_TIERS.length - 1].k;
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function calculateEloChange({ player, teamAvgElo, opponentAvgElo, won, draw }) {
  const expected = expectedScore(teamAvgElo, opponentAvgElo);
  const score = draw ? 0.5 : won ? 1 : 0;
  let delta = kFactor(player.gamesPlayed) * (score - expected);
  if (delta === 0) return 0;

  const playerElo = typeof player.elo === 'number' ? player.elo : 0;

  // 2) Ajuste personal: tu Elo contra el promedio de la partida. Por debajo
  //    del promedio ganas más y pierdes menos; por encima, al revés.
  if (!draw) {
    const lobbyAvg = (teamAvgElo + opponentAvgElo) / 2;
    const offset = clamp((lobbyAvg - playerElo) / C.PERSONAL_SCALE, -C.PERSONAL_MAX, C.PERSONAL_MAX);
    delta *= won ? 1 + offset : 1 - offset;
  }

  // 3) Rachas.
  const streak = player.streak || 0;
  if (!draw) {
    if (won && streak > 0) {
      delta *= 1 + Math.min(streak * C.STREAK_WIN_STEP, C.STREAK_WIN_MAX);
    } else if (!won && streak >= C.STREAK_BREAK_MIN) {
      delta *= 1 + Math.min((streak - C.STREAK_BREAK_MIN + 1) * C.STREAK_BREAK_STEP, C.STREAK_BREAK_MAX);
    } else if (!won && streak <= -C.LOSS_RELIEF_MIN) {
      // Ya venías perdiendo: cada derrota seguida (desde la 3ª) cuesta menos.
      const lossesInRow = -streak - C.LOSS_RELIEF_MIN + 1;
      delta *= 1 - Math.min(lossesInRow * C.LOSS_RELIEF_STEP, C.LOSS_RELIEF_MAX);
    }
  }

  // 4) Impulso en rangos bajos: con poco Elo ganas más y pierdes menos, y el
  //    efecto se apaga solo al llegar a BOOST_UNTIL. Así subir los primeros
  //    rangos es rápido, y los rangos altos miden nivel real.
  const fade = clamp(1 - playerElo / C.BOOST_UNTIL, 0, 1);
  delta *= delta > 0 ? 1 + (C.BOOST_WIN - 1) * fade : 1 - (1 - C.BOOST_LOSS) * fade;

  delta = clamp(delta, -C.MAX_LOSS, C.MAX_GAIN);
  const rounded = Math.round(delta);
  if (!draw && rounded === 0) return won ? C.MIN_CHANGE : -C.MIN_CHANGE;
  return rounded;
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
