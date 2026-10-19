const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { COLOR_PRIMARY } = require('../config');

const hex = c => `#${Number(c).toString(16).padStart(6, '0').toUpperCase()}`;

// Misma descripción de meta que usa /ver_roles.
function metaLabel(ach) {
  const ping = ach.pingEveryone ? ' 📢' : '';
  if (ach.negative) return `caer a ${ach.threshold} de Elo o menos 💀${ping}`;
  switch (ach.metric) {
    case 'elo': return `alcanzar ${ach.threshold} de Elo${ping}`;
    case 'racha': return `racha de ${ach.threshold} partidos ganados${ping}`;
    case 'winrate': return `${ach.threshold}% de WR, mín. ${ach.minGames} partidas${ping}`;
    case 'partidas': return `${ach.threshold} partidas jugadas${ping}`;
    default: return ping.trim();
  }
}

function roleLine(guild, ach) {
  const exists = guild.roles.cache.has(ach.roleId);
  return exists
    ? `<@&${ach.roleId}> — ${metaLabel(ach)}`
    : `⚠️ ~~rol borrado~~ \`${ach.roleId}\` — ${metaLabel(ach)}`;
}

// Corta el texto para no pasar el límite de Discord (4096 por descripción).
function clip(lines, max = 3800) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if ((out + lines[i] + '\n').length > max) return out + `…y ${lines.length - i} más`;
    out += lines[i] + '\n';
  }
  return out.trim();
}

function podiumLines(store) {
  if (!store.championEnabled) return ['Desactivados (se activan con `/campeon_configurar`).'];
  const slots = [
    ['🥇 Campeón', store.championRoleId, store.championColor ?? 0xFFD700, store.currentChampionId],
    ['🥈 Subcampeón', store.secondRoleId, store.secondColor ?? 0xC0C0C0, store.currentSecondId],
    ['🥉 3er lugar', store.thirdRoleId, store.thirdColor ?? 0xCD7F32, store.currentThirdId]
  ];
  return slots.map(([label, roleId, color, holderId]) => {
    const role = roleId ? `<@&${roleId}>` : '_(se crea en el próximo reset)_';
    const holder = holderId ? ` — lo tiene <@${holderId}>` : '';
    return `${label}: ${role} \`${hex(color)}\`${holder}`;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ver_categorias')
    .setDescription('Ve todo: categorías de roles (color, roles que tienen) y los roles de podio de una cola/modo.')
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'ver_categorias'))) return;

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const categories = Object.values(store.roleCategories || {});
    const allRoles = Object.values(store.roleAchievements || {});
    const guild = interaction.guild;

    const embeds = [];
    const MAX_CAT_EMBEDS = 7; // Discord permite 10 embeds por mensaje; quedan sitio para el resumen
    const shown = categories.slice(0, MAX_CAT_EMBEDS);
    const hidden = categories.slice(MAX_CAT_EMBEDS);

    // Discord limita a 6000 caracteres el TOTAL de todos los embeds de un mensaje,
    // así que cada categoría recibe una parte del presupuesto.
    const catBudget = Math.max(150, Math.min(1200, Math.floor(2800 / Math.max(1, shown.length))));

    // Un embed por categoría: la barra lateral lleva el color REAL de la categoría.
    for (const cat of shown) {
      const roles = allRoles.filter(a => !a.negative && a.categoryKey === cat.key);
      const lines = roles.length ? roles.map(a => roleLine(guild, a)) : ['_Sin roles todavía._'];
      const embed = new EmbedBuilder()
        .setColor(cat.color)
        .setTitle(`🔹 ${cat.name}`)
        .setDescription(
          `**Color:** \`${hex(cat.color)}\` · **Roles:** ${roles.length} · **Clave:** \`${cat.key}\`\n` +
          (cat.createdBy ? `**Creada por:** <@${cat.createdBy}>${cat.createdAt ? ` · <t:${Math.floor(cat.createdAt / 1000)}:d>` : ''}\n` : '') +
          `\n${clip(lines, catBudget)}`
        );
      embeds.push(embed);
    }

    // Resumen: categorías que no entraron, roles sueltos, negativos y podio.
    const summary = [];
    if (hidden.length) {
      summary.push('**Otras categorías:**');
      for (const cat of hidden) {
        const n = allRoles.filter(a => !a.negative && a.categoryKey === cat.key).length;
        summary.push(`🔹 **${cat.name}** \`${hex(cat.color)}\` — ${n} rol(es)`);
      }
      summary.push('');
    }

    const uncategorized = allRoles.filter(a => !a.negative && (!a.categoryKey || !store.roleCategories?.[a.categoryKey]));
    if (uncategorized.length) {
      summary.push('**SIN CATEGORÍA:**');
      for (const a of uncategorized) summary.push(roleLine(guild, a));
      summary.push('');
    }

    const negatives = allRoles.filter(a => a.negative).sort((a, b) => b.threshold - a.threshold);
    if (negatives.length) {
      summary.push('**NEGATIVOS 💀:**');
      for (const a of negatives) summary.push(roleLine(guild, a));
      summary.push('');
    }

    summary.push('**ROLES DE PODIO (fin de temporada):**');
    summary.push(...podiumLines(store));
    if (allRoles.some(a => a.pingEveryone)) summary.push('\n-# 📢 = el bot menciona @everyone en anuncios cuando alguien lo consigue');

    embeds.push(
      new EmbedBuilder()
        .setColor(COLOR_PRIMARY)
        .setTitle(`🗂️ Categorías y roles — ${resolved.label}`)
        .setDescription(
          `**${categories.length}** categoría(s) · **${allRoles.length}** rol(es) de logro · Temporada **${guildData.season || 1}**\n\n` +
          clip(summary, 1400)
        )
    );

    // El resumen va primero y las categorías después.
    embeds.unshift(embeds.pop());

    // Red de seguridad: si aun así se pasa de 6000 caracteres, se recorta lo último.
    const size = e => (e.data.title || '').length + (e.data.description || '').length;
    let total = embeds.reduce((n, e) => n + size(e), 0);
    for (let i = embeds.length - 1; i > 0 && total > 5900; i--) {
      const d = embeds[i].data.description || '';
      const cut = Math.min(d.length - 200, total - 5900);
      if (cut > 0) { embeds[i].setDescription(d.slice(0, d.length - cut - 1) + '…'); total -= cut; }
    }

    await interaction.reply({ embeds: embeds.slice(0, 10) });
  }
};
