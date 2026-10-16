const { COMMAND_CHANNEL_MAP } = require('../config');
const { errorEmbed } = require('./embeds');

/**
 * Verifica que el comando se use en el canal correcto para ese servidor.
 * `commandKey` es la clave base (ej. 'queue', 'bans', 'stats'). Si es null/'any',
 * se permite en cualquier canal. Si guildData no tiene ese canal configurado
 * (bot no instalado en ese canal todavía), también se permite para no romper nada.
 * Devuelve true si puede continuar, o responde con error ephemeral y devuelve false.
 */
async function assertChannel(interaction, guildData, commandKey, explicitChannelKey) {
  const channelKey = explicitChannelKey || COMMAND_CHANNEL_MAP[commandKey];
  if (!channelKey || channelKey === 'any') return true;

  const expectedChannelId = guildData.channels[channelKey];
  if (!expectedChannelId) return true; // aún no instalado / no configurado

  if (interaction.channelId !== expectedChannelId) {
    await interaction.reply({
      embeds: [errorEmbed(`Este comando solo se puede usar en <#${expectedChannelId}>.`)],
      ephemeral: true
    });
    return false;
  }
  return true;
}

module.exports = { assertChannel };
