module.exports = {
  ELO_START: 0,
  ELO_FLOOR: -300,     // el elo de un jugador nunca baja de acá, por más rachas negativas que tenga
  MAX_LOSS: 20,        // tope de cuánto se puede perder en UNA sola partida
  WIN_BASE_ELO: 13,    // ganar da un poco más...
  LOSS_BASE_ELO: 10,   // ...de lo que perder cuesta, pero ya no tan desparejo como antes
  PICK_TIMEOUT_MS: 2 * 60 * 1000, // 2 minutos
  AFK_CAPTAIN_COOLDOWN_MS: 60 * 60 * 1000, // 1 hora — cuánto tiempo queda sin poder ser sorteado como capitán alguien que se quedó AFK pickeando
  QUEUE_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutos
  QUEUE_SIZE: 8,
  // Rol rainbow (/rainbow): nombre del rol, cada cuánto cambia de color y cuántos
  // grados avanza en cada cambio. Cuanto más seguido se edita un rol, más fácil
  // es que Discord limite al bot (error 429): 12 s es seguro, no lo bajes de ~5 s.
  RAINBOW_ROLE_NAME: '🌈Raimbow',
  RAINBOW_INTERVAL_MS: 12000,
  RAINBOW_HUE_STEP: 15,

  // Salas de Haxball para el comando /salas. El bot no tiene forma de saber
  // en tiempo real si tienen jugadores adentro (Haxball no tiene API pública
  // para eso), así que se maneja con un sistema de "reporte": se entrega una
  // sala libre, se marca como ocupada automáticamente, y queda a que la gente
  // avise con los botones cuando se desocupa, se cae, etc. Si nadie avisa,
  // se libera sola pasado un tiempo (ver SALA_*_AUTO_FREE_MS abajo).
  HAXBALL_ROOMS: [
    { code: 'LJUEbyJcSt0', name: 'Miami 1' },
    { code: 'v6CEOkrnqAk', name: 'Miami 2' },
    { code: 'Slu1cExzsdQ', name: 'Miami 3' },
    { code: 'OvpsaLROGzA', name: 'Miami 4' },
    { code: 'lSEC3-vOj38', name: 'Miami 5' },
    { code: 'ZEV7pIC6bpU', name: 'Miami 6' },
    { code: 'eMd4GaTY6PA', name: 'Miami 7' },
    { code: 'od5212R52iY', name: 'Miami 8' },
    { code: '1ujsdX7c_7U', name: 'Miami 9' },
    { code: 'qM01Yi65TAM', name: 'Miami 10' },
    { code: '_xvuUgkWmg0', name: 'Miami 11' },
    { code: '9NJZzW1uEdo', name: 'Miami 12' },
    { code: 'Toi9Fy90Sgw', name: 'Miami 13' },
    { code: 'r8qEOVXnk48', name: 'Miami 14' },
    { code: 'PZlAjWjS3K0', name: 'Miami 15' },
    { code: 'wOCJTrG4WbU', name: 'Miami 16' },
    { code: '_9ucNhK9XxY', name: 'Miami 17' },
    { code: 'py7AQkwDyNw', name: 'Miami 18' },
    { code: 'C9WVFXvrz3s', name: 'Miami 19' },
    { code: 'CjNbJN3OTpU', name: 'Miami 20' }
  ],
  SALA_OCCUPIED_AUTO_FREE_MS: 20 * 60 * 1000, // 20 min: si nadie avisa, se asume que ya terminó y se libera sola
  SALA_CLOSED_AUTO_FREE_MS: 60 * 60 * 1000,   // 1 hora: una sala "caída" vuelve a intentarse pasado este tiempo

  CHANNEL_KEYS: {
    INIT: 'init',
    INFO_CHAT: 'info_chat',
    SUBMIT: 'submit',
    GAME_ANNOUNCEMENT: 'game_announcement',
    BANS: 'bans',
    ANUNCIOS: 'anuncios', // logros/roles desbloqueados
    QUEUE: 'queue' // canal "4v4-solo" dentro de la categoría "Elo Queues"
  },

  CATEGORY_NAME: 'Elo Queues',
  ADMIN_CATEGORY_NAME: 'Elo Admin',
  QUEUE_CHANNEL_NAME: '4v4-solo',
  ADMIN_ROLE_NAME: 'Elo Admin',

  // Tiers de VIP: qué límites tiene cada servidor según lo que haya pagado.
  // Se activa a mano con /vip set (solo lo puede usar el dueño del bot).
  VIP_TIERS: {
    free:  { key: 'free',  label: 'Free',      maxPlayers: 200,      maxModes: 2,        priceUSD: 0 },
    basic: { key: 'basic', label: 'VIP Basic', maxPlayers: 300,      maxModes: 3,        priceUSD: 5 },
    pro:   { key: 'pro',   label: 'VIP Pro',   maxPlayers: Infinity, maxModes: Infinity, priceUSD: 12 }
  },
  VIP_DURATION_MS: 30 * 24 * 60 * 60 * 1000, // 1 mes

  COLOR_PRIMARY: 0x5865F2,
  COLOR_SUCCESS: 0x57F287,
  COLOR_DANGER: 0xED4245,
  COLOR_WARN: 0xFEE75C,

  // Sistema de rangos por elo. 8 rangos principales; los primeros 7 tienen
  // 3 sub-niveles (I, II, III) y "Pro" es el rango tope, único, sin sub-niveles.
  // El elo mínimo de cada sub-nivel es inclusive (>= min). Se puede reajustar
  // libremente sin tocar el resto del bot: todo pasa por src/utils/ranks.js.
  RANKS: [
    { key: 'bronce', name: 'Bronce', emoji: '🥉', color: 0xAD8A56,
      tiers: [{ label: 'I', min: 0 }, { label: 'II', min: 100 }, { label: 'III', min: 200 }] },
    { key: 'plata', name: 'Plata', emoji: '⚪', color: 0xC0C0C0,
      tiers: [{ label: 'I', min: 300 }, { label: 'II', min: 400 }, { label: 'III', min: 500 }] },
    { key: 'oro', name: 'Oro', emoji: '🟡', color: 0xFFD700,
      tiers: [{ label: 'I', min: 600 }, { label: 'II', min: 700 }, { label: 'III', min: 800 }] },
    { key: 'diamante', name: 'Diamante', emoji: '💎', color: 0x59D8E6,
      tiers: [{ label: 'I', min: 900 }, { label: 'II', min: 1000 }, { label: 'III', min: 1100 }] },
    { key: 'mitico', name: 'Mítico', emoji: '🔮', color: 0xB35CFF,
      tiers: [{ label: 'I', min: 1200 }, { label: 'II', min: 1300 }, { label: 'III', min: 1400 }] },
    { key: 'legendario', name: 'Legendario', emoji: '🔥', color: 0xFF7A1A,
      tiers: [{ label: 'I', min: 1500 }, { label: 'II', min: 1600 }, { label: 'III', min: 1700 }] },
    { key: 'maestro', name: 'Maestro', emoji: '👑', color: 0xFF3B6B,
      tiers: [{ label: 'I', min: 1800 }, { label: 'II', min: 1900 }, { label: 'III', min: 2000 }] },
    { key: 'pro', name: 'Pro', emoji: '🏆', color: 0xFFFFFF, min: 2100 }
  ],

  // Mapa de qué comando (nombre base) funciona en qué canal. 'any' = cualquier canal.
  COMMAND_CHANNEL_MAP: {
    queue: 'queue',
    force_join: 'queue',
    reset_queue: 'queue',
    tag: 'queue',
    tag_activar: 'queue',
    tag_ver: 'info_chat',
    tag_eliminar: 'init',
    room: 'any',
    force_leave: 'queue',
    substitute: 'queue',
    revertir: 'submit',
    result: 'submit',
    stats: null, // se resuelve por subcomando en el propio handler
    reset_season: 'submit',
    reset_season_autorizar: 'submit',
    ban: 'bans',
    bans: 'bans',
    captainban: 'bans',
    install: 'any',
    uninstall: 'any',
    help: 'any',
    rename: 'info_chat',
    logros: 'info_chat',
    logros_progreso: 'info_chat',
    historial: 'info_chat',
    dm: 'any',
    mode: 'init',
    pick_time: 'init',
    rainbow: 'init',
    afk_time: 'init',
    crear_rol_negativo: 'init',
    rol_everyone: 'init',
    crear_categoria: 'init',
    eliminar_categoria: 'init',
    ver_categorias: 'init',
    crear_rol: 'init',
    eliminar_rol: 'init',
    ver_roles: 'init',
    temporada: 'init',
    campeon_configurar: 'init'
  }
};