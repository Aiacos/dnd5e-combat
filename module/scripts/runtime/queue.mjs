/**
 * File d'attente par clé. Plusieurs évènements touchant le même document arrivent presque en
 * même temps (sauvegardes simultanées, effets sur soi demandés par deux chemins) ; chacun lit un
 * flag, le modifie et le réécrit. Sans mise en série, la dernière écriture écrase les autres.
 */
const queues = new Map();

export function enqueue(key, task) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  // Le maillon de la file ne se rejette jamais : une tâche qui échoue ne bloque pas les suivantes.
  queues.set(key, run.then(() => {}, () => {}));
  // Ce maillon traite le rejet de `run` : rendre `run` lui-même ferait passer pour traitée l'erreur d'une tâche dont personne
  // n'attend la promesse, et elle disparaîtrait sans trace. La promesse rendue n'a pas d'autre abonné que l'appelant.
  return run.then(value => value);
}
