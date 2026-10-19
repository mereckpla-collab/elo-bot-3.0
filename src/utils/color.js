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

// Para los roles de podio: "amarillo, azul, verde" -> [1º, 2º, 3º].
// Pide mínimo 3 colores separados por coma (si ponen más, se ignoran los
// de sobra). Devuelve { ok:true, colors:[a,b,c] } o { ok:false, message }.
function parseColorList(input, count = 3) {
  const parts = String(input || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < count) {
    return {
      ok: false,
      message: `Tenés que poner ${count} colores separados por coma, en orden 🥇 1º, 🥈 2º, 🥉 3º (ej. \`amarillo, azul, verde\`). Pusiste ${parts.length}.`
    };
  }
  const colors = [];
  for (let i = 0; i < count; i++) {
    const c = parseColor(parts[i]);
    if (c === null) {
      return {
        ok: false,
        message: `No reconozco el color n°${i + 1}: \`${parts[i]}\`. Usá un hex (ej. \`#FFD700\`) o uno de estos nombres: ${COLOR_NAMES_HELP}.`
      };
    }
    colors.push(c);
  }
  return { ok: true, colors };
}

module.exports = { parseColor, parseColorList, COLOR_NAMES_HELP };
