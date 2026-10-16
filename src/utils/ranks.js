const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { RANKS } = require('../config');

// Insignias de cada rango: assets/ranks/<rankKey>.png (bronce, plata, oro,
// diamante, mitico, legendario, pro). Si un rango no tiene imagen (ej. Maestro),
// simplemente no se muestra miniatura.
const BADGES_DIR = path.join(__dirname, '..', '..', 'assets', 'ranks');

// Al arrancar, el bot dice en la consola cuántas insignias encontró y dónde
// las busca (así se ve enseguida si la carpeta o algún nombre está mal).
(function logBadges() {
  const keys = RANKS.map(r => r.key);
  const found = keys.filter(k => fs.existsSync(path.join(BADGES_DIR, `${k}.png`)));
  const missing = keys.filter(k => !found.includes(k));
  console.log(`[rangos] Buscando insignias en: ${BADGES_DIR}`);
  console.log(`[rangos] Encontradas ${found.length}/${keys.length}` + (missing.length ? ` — sin imagen: ${missing.join(', ')}` : ''));
})();
const warnedMissing = new Set();

// Aplana RANKS (rangos con sub-niveles + "Pro" sin sub-niveles) en una sola
// lista ordenada por elo mínimo, para poder recorrerla de forma simple.
function buildFlatTiers() {
  const flat = [];
  for (const rank of RANKS) {
    if (rank.tiers) {
      for (const t of rank.tiers) {
        flat.push({
          rankKey: rank.key,
          name: rank.name,
          tierLabel: t.label,
          min: t.min,
          emoji: rank.emoji,
          color: rank.color
        });
      }
    } else {
      flat.push({
        rankKey: rank.key,
        name: rank.name,
        tierLabel: null,
        min: rank.min,
        emoji: rank.emoji,
        color: rank.color
      });
    }
  }
  return flat.sort((a, b) => a.min - b.min);
}

const FLAT_TIERS = buildFlatTiers();

function getRankForElo(elo) {
  let current = FLAT_TIERS[0];
  for (const tier of FLAT_TIERS) {
    if (elo >= tier.min) current = tier;
    else break;
  }
  return current;
}

function getNextTier(current) {
  const idx = FLAT_TIERS.findIndex(t => t.rankKey === current.rankKey && t.tierLabel === current.tierLabel);
  return FLAT_TIERS[idx + 1] || null;
}

function rankLabel(tier) {
  return tier.tierLabel ? `${tier.emoji} ${tier.name} ${tier.tierLabel}` : `${tier.emoji} ${tier.name}`;
}

/** Devuelve el rango actual, el siguiente (o null si ya es el tope), y el % de avance hacia el siguiente. */
function rankProgress(elo) {
  const current = getRankForElo(elo);
  const next = getNextTier(current);
  if (!next) return { current, next: null, pct: 100 };
  const span = next.min - current.min;
  const pct = span > 0 ? Math.min(100, Math.max(0, Math.round(((elo - current.min) / span) * 100))) : 100;
  return { current, next, pct };
}

function progressBar(pct, size = 10) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

/** Posición del rango en la escalera (Bronce = 0 ... Pro = el más alto). */
function rankIndex(rankKey) {
  return RANKS.findIndex(r => r.key === rankKey);
}

/**
 * Insignia del rango lista para un embed: { attachment, url } o null si no
 * hay imagen. `url` va en embed.setThumbnail() (queda arriba a la derecha) y
 * `attachment` hay que mandarlo en `files` del mismo mensaje.
 */
function rankBadge(rankKey) {
  const file = path.join(BADGES_DIR, `${rankKey}.png`);
  if (!fs.existsSync(file)) {
    if (!warnedMissing.has(rankKey)) {
      warnedMissing.add(rankKey);
      console.warn(`[rangos] No encuentro la insignia de "${rankKey}": ${file}`);
    }
    return null;
  }
  const name = `rank_${rankKey}.png`;
  return { attachment: new AttachmentBuilder(file, { name }), url: `attachment://${name}` };
}

/** Texto del historial del jugador: cuántas temporadas estuvo en cada rango. */
function rankHistoryText(player) {
  const hist = player?.rankHistory || {};
  const parts = [];
  for (const rank of RANKS) {
    const seasons = hist[rank.key];
    if (seasons && seasons.length) parts.push(`${rank.emoji} ${rank.name} ×${seasons.length}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

module.exports = { FLAT_TIERS, getRankForElo, getNextTier, rankLabel, rankProgress, progressBar, rankIndex, rankBadge, rankHistoryText };