/**
 * File d'attente par clé. Plusieurs évènements touchant le même document arrivent presque en
 * même temps (sauvegardes simultanées, effets sur soi demandés par deux chemins) ; chacun lit un
 * flag, le modifie et le réécrit. Sans mise en série, la dernière écriture écrase les autres.
 */
const queues = new Map();

export function enqueue(key, task) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  // Le maillon de l'appelant, créé AVANT celui de la file : `await enqueue(k, A); suite()` reprend ainsi avant que la tâche
  // suivante de la même clé ne commence, comme toujours. Rendre `run` lui-même ferait passer pour traitée (par le maillon de la
  // file) l'erreur d'une tâche dont personne n'attend la promesse, et elle disparaîtrait sans trace.
  const out = run.then(value => value);
  // Le maillon de la file ne se rejette jamais : une tâche qui échoue ne bloque pas les suivantes.
  queues.set(key, run.then(() => {}, () => {}));
  return out;
}
