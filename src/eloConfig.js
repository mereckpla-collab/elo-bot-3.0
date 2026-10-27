// Todos los números del cálculo de Elo en un solo lugar. Para afinar el
// balance NO hace falta tocar elo.js: cambia los valores de acá.
//
// Cómo funciona (resumen):
//   cambio = K × (resultado − probabilidad de ganar)
//            × ajuste personal  × racha  × impulso de rangos bajos
//   y al final se limita con MAX_GAIN / MAX_LOSS.

module.exports = {
  // Qué tan "grande" es una diferencia de Elo entre equipos. Más bajo = las
  // diferencias pesan MÁS. Con 350, un equipo +200 de promedio es favorito
  // con ~79% (ganarle da mucho, perder contra él casi no quita).
  ELO_SCALE: 350,

  // K = cuántos puntos se mueven como máximo por partida. Alto al principio
  // para que los nuevos suban rápido (llegar a Plata ya no es una odisea) y
  // más bajo con experiencia. `upTo` = partidas jugadas MENOS que ese número.
  K_TIERS: [
    { upTo: 10, k: 56 },
    { upTo: 30, k: 44 },
    { upTo: 80, k: 34 },
    { upTo: Infinity, k: 28 }
  ],

  // Ajuste personal: compara TU Elo con el promedio de la partida.
  // Si estás por debajo del promedio ganas más y pierdes menos; si estás por
  // encima, ganas menos y pierdes más. Así el que ya tiene mucho Elo no se
  // infla fácil, y el que viene abajo se recupera. Con esto las pérdidas ya
  // no son siempre el mismo número.
  PERSONAL_SCALE: 900, // cada 900 de diferencia = ±100% (se limita con el tope)
  PERSONAL_MAX: 0.30,  // tope: ±30%

  // Rachas GANANDO: cada victoria seguida suma un % extra a lo que ganas.
  STREAK_WIN_STEP: 0.10, // +10% por victoria previa seguida
  STREAK_WIN_MAX: 0.60,  // tope: +60% (racha de 6 o más)
  // Perdiendo CON racha ganadora (de 3+): cortarla cuesta un poco más.
  STREAK_BREAK_MIN: 3,
  STREAK_BREAK_STEP: 0.05, // +5% por cada victoria seguida desde la 3ª
  STREAK_BREAK_MAX: 0.25,  // tope: +25%
  // Rachas PERDIENDO: desde la 3ª derrota seguida, cada derrota extra te
  // quita un % MENOS (protección para que no te hundas sin salida).
  LOSS_RELIEF_MIN: 3,
  LOSS_RELIEF_STEP: 0.07, // -7% por cada derrota seguida desde la 3ª
  LOSS_RELIEF_MAX: 0.28,  // tope: -28%

  // Impulso en rangos bajos. Con Elo 0 (o menos) ganas BOOST_WIN veces lo
  // normal y pierdes BOOST_LOSS veces lo normal; baja de forma lineal y
  // desaparece al llegar a BOOST_UNTIL (700 = Oro II). Neutro: 1, 1.
  BOOST_UNTIL: 700,
  BOOST_WIN: 1.7,
  BOOST_LOSS: 0.6,

  // Topes de seguridad por partida.
  MAX_GAIN: 60,
  MAX_LOSS: 32,
  MIN_CHANGE: 1 // nunca un cambio de 0 en una victoria/derrota
};
