// Convierte lo que escribe el admin (un hex como "#57F287"/"57F287", o un
// nombre común en español) a un entero de color válido para Discord.js.
// Devuelve null si no se pudo reconocer.
const NAMED_COLORS = {
  rojo: 0xED4245,
  azul: 0x3498DB,
  verde: 0x57F287,
  amarillo: 0xFEE75C,
  morado: 0x9B59B6,
  purpura: 0x9B59B6,
  violeta: 0x9B59B6,
  naranja: 0xE67E22,
  rosa: 0xEB459E,
  negro: 0x23272A,
  blanco: 0xFFFFFF,
  gris: 0x95A5A6,
  dorado: 0xFFD700,
  oro: 0xFFD700,
  plata: 0xC0C0C0,
  turquesa: 0x1ABC9C,
  celeste: 0x59D8E6,
  marron: 0x8B4513,
  cyan: 0x1ABC9C
};

function parseColor(input) {
  if (!input) return null;
  const raw = input.trim();

  const key = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (NAMED_COLORS[key] !== undefined) return NAMED_COLORS[key];

  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('');
    return parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }

  return null;
}

const COLOR_NAMES_HELP = Object.keys(NAMED_COLORS).join(', ');

module.exports = { parseColor, COLOR_NAMES_HELP };
