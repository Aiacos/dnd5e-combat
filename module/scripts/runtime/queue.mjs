/**
 * Queue by key. Several events touching the same document arrive almost at
 * the same time (simultaneous saves, self effects requested through two paths); each reads a
 * flag, modifies it and writes it back. Without serialization, the last write overwrites the others.
 */
const queues = new Map();

export function enqueue(key, task) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  // The caller's link, created BEFORE the queue's: `await enqueue(k, A); suite()` thus resumes before the next
  // task of the same key starts, as always. Returning `run` itself would make the error of a task whose promise nobody awaits
  // pass for handled (by the queue's link), and it would vanish without a trace.
  const out = run.then(value => value);
  // The queue's link never rejects: a task that fails does not block the following ones.
  queues.set(key, run.then(() => {}, () => {}));
  return out;
}
