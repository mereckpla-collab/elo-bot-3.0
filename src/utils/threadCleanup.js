/**
 * Avisa en el hilo que se va a OCULTAR en 10 minutos, y lo programa.
 * Se usa tanto cuando un draft se cancela por capitán AFK como cuando una
 * partida termina normal (por voto o por ranking).
 *
 * El hilo NO se borra: a los 10 minutos se archiva y se bloquea, así
 * desaparece de la lista de hilos abiertos del canal pero se puede seguir
 * viendo en los hilos archivados (para revisar la partida después). Con el
 * bloqueo, un jugador no lo reabre sin querer escribiendo ahí; solo un
 * moderador puede reabrirlo.
 *
 * El conteo vive en la memoria del proceso: si el bot se reinicia antes de
 * que se cumplan los 10 minutos, el hilo no se oculta solo (Discord lo
 * archiva igual a las 24hs, así que no queda "roto").
 */
const HIDE_IN_MS = 10 * 60 * 1000;

async function scheduleThreadArchive(client, threadId, reason) {
  if (!threadId) return;
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) return;

  const hideAt = Math.floor((Date.now() + HIDE_IN_MS) / 1000);

  // <t:...:R> es un timestamp dinámico de Discord: el cliente lo muestra como
  // "en 10 minutos" y lo va actualizando solo (cuenta regresiva en vivo),
  // sin que el bot tenga que editar el mensaje.
  await thread.send({ content: `🗂️ Este hilo se ocultará <t:${hideAt}:R>. No se borra: queda en los hilos archivados.` }).catch(() => {});

  setTimeout(async () => {
    const t = await client.channels.fetch(threadId).catch(() => null);
    if (!t) return;
    const why = reason || 'Ocultado automáticamente a los 10 minutos';
    // Primero se bloquea y después se archiva (si se archivara primero, el
    // bloqueo ya no se podría aplicar).
    await t.setLocked(true, why).catch(() => {});
    await t.setArchived(true, why).catch(() => {});
  }, HIDE_IN_MS);
}

// Nombre viejo: sigue existiendo para que los demás archivos que lo llaman
// (resultManager, draftManager) no tengan que cambiar. Ya no borra nada.
module.exports = { scheduleThreadArchive, scheduleThreadDeletion: scheduleThreadArchive };