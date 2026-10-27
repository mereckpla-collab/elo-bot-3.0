require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) client.commands.set(command.data.name, command);
}

const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  // Si un evento falla, se muestra el error en la consola pero el bot NO se
  // apaga (antes, cualquier error sin atrapar cerraba todo el proceso).
  const run = (...args) => Promise.resolve()
    .then(() => event.execute(...args))
    .catch(err => {
      console.error(`[error] Falló el evento "${event.name}":`, err);
      const i = args[0];
      if (i && typeof i.isRepliable === 'function' && i.isRepliable() && !i.replied && !i.deferred) {
        i.reply({ content: '⚠️ Algo falló con esa acción. Avísale a un admin.', ephemeral: true }).catch(() => {});
      }
    });
  if (event.once) client.once(event.name, run);
  else client.on(event.name, run);
}

// Red de seguridad: por defecto Node.js CIERRA el programa si una promesa falla
// y nadie atrapó el error (por ejemplo, un permiso que falta al crear un canal,
// o un botón que tardó más de 3 segundos en contestarse). Acá solo se muestra
// el error en la consola y el bot sigue encendido.
process.on('unhandledRejection', err => {
  console.error('[error] Promesa rechazada sin atrapar (el bot sigue encendido):', err);
});
process.on('uncaughtException', err => {
  console.error('[error] Excepción sin atrapar (el bot sigue encendido):', err);
});
client.on('error', err => console.error('[error] Error del cliente de Discord:', err));

if (!process.env.DISCORD_TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

const { startPolling } = require('./utils/mrhost');
startPolling();
   require('./utils/webSync').start();

client.login(process.env.DISCORD_TOKEN);
