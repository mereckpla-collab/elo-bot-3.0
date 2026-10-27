// Mini-semáforo en memoria: ejecuta las tareas que comparten la misma `key`
// de UNA EN UNA, en el orden en que llegaron. Si una tarea falla, la
// siguiente igual corre. Sirve para que, cuando varias personas tocan
// "Unirse" casi al mismo tiempo, el bot las atienda por turnos en vez de
// pisarse los datos entre sí (que era lo que creaba 2 colas / partidas
// perdidas).
const tails = new Map();

function withLock(key, task) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.then(() => task());
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

module.exports = { withLock };
