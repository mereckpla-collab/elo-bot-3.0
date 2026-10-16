const { EmbedBuilder } = require('discord.js');
const { VIP_TIERS, VIP_DURATION_MS, COLOR_PRIMARY, COLOR_WARN } = require('../config');

/**
 * Devuelve el tier efectivo del servidor, ya teniendo en cuenta si el VIP
 * venció. No modifica nada (chequeo "perezoso"): si venció, se comporta
 * como 'free' aunque el campo todavía diga 'basic'/'pro' hasta que alguien
 * lo actualice explícitamente.
 */
function getEffectiveTier(guildData) {
  const vip = guildData.vip;
  if (!vip || vip.tier === 'free') return 'free';
  if (vip.expiresAt && Date.now() > vip.expiresAt) return 'free';
  return vip.tier;
}

function getLimits(guildData) {
  const tier = getEffectiveTier(guildData);
  return VIP_TIERS[tier] || VIP_TIERS.free;
}

function totalRegisteredPlayers(guildData) {
  return Object.keys(guildData.players || {}).length;
}

async function isBotOwner(interaction) {
  const app = interaction.client.application;
  if (!app.owner) await app.fetch().catch(() => null);
  const owner = app.owner;
  if (!owner) return false;
  if (owner.members) return owner.members.has(interaction.user.id); // equipo de desarrolladores
  return owner.id === interaction.user.id;
}

function vipPromoEmbed(guildData) {
  const tier = getEffectiveTier(guildData);
  const current = VIP_TIERS[tier];
  const basic = VIP_TIERS.basic;
  const pro = VIP_TIERS.pro;

  return new EmbedBuilder()
    .setColor(COLOR_WARN)
    .setTitle('⚠️ Este servidor llegó al límite de jugadores del plan actual')
    .setDescription(
      `Plan actual: **${current.label}** (hasta ${current.maxPlayers} jugadores registrados, ${current.maxModes === Infinity ? 'modos ilimitados' : `hasta ${current.maxModes} modos`}).\n\n` +
      `**VIP Basic — $${basic.priceUSD}/mes**\n` +
      `> Hasta ${basic.maxPlayers} jugadores · hasta ${basic.maxModes} modos\n\n` +
      `**VIP Pro — $${pro.priceUSD}/mes**\n` +
      `> Jugadores ilimitados · modos ilimitados\n\n` +
      `Hablá con un administrador del servidor para comprar VIP.`
    );
}

module.exports = { getEffectiveTier, getLimits, totalRegisteredPlayers, isBotOwner, vipPromoEmbed, VIP_DURATION_MS };