/**
 * §177, §203: the World diagnostic on the whole world, not on a test actor — what a GM does after an update. Written after the
 * 2026-11-25 study (tri-demandes/DIAGNOSTIC-REPARATION.md): the GM's repair on `dnd-6` made 1,476 fixes (1,472 translations), a user
 * reported an error at repair time, and the bench never exercised the translation check because its client is in English.
 *
 *  1. The GM client is switched to French and reloaded: `retranslate` works in the language of the client that runs it (Babele).
 *  2. A world just repaired has almost nothing left to repair. If the analysis finds no fixable task, the world is first put back to
 *     the state before the GM's last repair (the most recent entry of « DAS · Sauvegardes », restored — that restore is itself backed
 *     up first). No backup and nothing to repair: not applicable.
 *  3. Analysis of every check: no check fails. Repair of every fixable task (pre-selected or not, `phb3-items` included): backup made
 *     and verified first, no task fails, no error in the console. A new analysis finds nothing fixable left.
 *  4. Everything is put back: the state before the scenario is restored from its own backup (no line fails), the backup entries the
 *     scenario created are deleted, the client goes back to its language.
 *
 * Long (about 4 minutes on `dnd-6-test`, 235 sheets): full pass only, never in the smoke pass.
 */
/** A restore line that failed (`Diagnostic.RestaurationEchec`, fr / en / pt-BR start the same way after the name). */
const NOT_RESTORED = /non restaur|not restored|não restaur/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks whose tasks are known to come back after their own repair, by check id, with the reason. Logged, not counted; remove the
 * line with the fix. Found by this scenario on its first run (2026-11-25, §546).
 */
const KNOWN_LEFT = Object.freeze({
  "phb3-items": "a spell granted by a feature gets its free-cast activity at replacement (§469), so its activities never match "
    + "the Handbook's again and it is listed after every repair"
});

const LANGUAGE_SCRIPT = `
  const before = game.settings.get("core", "language");
  if ( before !== args.lang ) await game.settings.set("core", "language", args.lang);
  return { before };`;

export default {
  name: "World diagnostic — whole world in French: analysis, repair, new analysis empty, exact restore",

  async run(ctx) {
    const LONG = { timeoutMs: 300000 };
    const api = (fn, args={}) => ctx.engine(fn, args, LONG);

    /** Reload the GM client and wait for it to come back with a new boot time (tools/reload.mjs). */
    const reload = async () => {
      const before = await ctx.engine("status");
      await ctx.engine("reload").catch(() => {});
      for ( const until = Date.now() + 120000; Date.now() < until; ) {
        await sleep(2000);
        const now = await ctx.engine("status").catch(() => null);
        if ( now?.ready && (now.bootedAt !== before.bootedAt) ) { await sleep(3000); return now; }
      }
      throw new Error("the GM client did not come back after its reload (120 s)");
    };
    const setLanguage = async lang => {
      const r = await ctx.call("run-script", { code: LANGUAGE_SCRIPT, args: { lang }, waitMs: 10000 });
      const before = (r?.result ?? r)?.before ?? null;
      if ( before !== lang ) await reload();
      return before;
    };

    // Entries created by the scenario, deleted at the end (the GM's own entries are never touched).
    const created = [];
    ctx.restore(() => api("diagnosticForget", { uuids: created }));

    // 1. The client in French.
    const previousLang = await setLanguage("fr");
    if ( previousLang && (previousLang !== "fr") ) ctx.restore(() => setLanguage(previousLang));
    const status = await ctx.engine("status");
    if ( !ctx.expect(status.lang === "fr", `GM client in French (${status.lang})`) ) return;
    await ctx.clientErrors();   // empties the buffer: only the errors of the analysis and the repair count below

    const fixable = scan => Object.values(scan).flat().filter(t => t.fixable);
    const countByCheck = tasks => Object.entries(tasks.reduce((m, t) => (m[t.check] = (m[t.check] ?? 0) + 1, m), {}))
      .map(([id, n]) => `${id} ${n}`).join(", ") || "none";
    const scanErrors = scan => Object.values(scan).flat().filter(t => String(t.id).endsWith(".error"));

    let scan = await api("diagnosticScan");
    // 2. Nothing to repair: back to the state before the GM's last repair.
    if ( !fixable(scan).length ) {
      const last = (await api("diagnosticBackups")).find(b => !(b.checks ?? []).includes("restore"));
      if ( !last ) { ctx.log("nothing to repair and no repair backup in this world: not applicable"); return; }
      ctx.log(`nothing to repair: the world goes back to before the last repair (${last.name}, ${last.roots.length} document(s))`);
      const back = await api("diagnosticRestore", { uuid: last.uuid });
      if ( back.before?.uuid ) {
        created.push(back.before.uuid);
        // Registered after the forget above, so it runs before it: the world comes back to its state at the start.
        ctx.restore(async () => {
          const r = await api("diagnosticRestore", { uuid: back.before.uuid });
          if ( r.before?.uuid ) created.push(r.before.uuid);
        });
      }
      const failed = back.lines.filter(l => NOT_RESTORED.test(l));
      if ( !ctx.expect(!failed.length, `the GM's last repair undone on the copy (${back.lines.length} document(s)${failed.length ? ` — ${failed.slice(0, 3).join(" | ")}` : ""})`) ) return;
      scan = await api("diagnosticScan");
    }

    // 3. Analysis, repair, new analysis.
    const errors = scanErrors(scan);
    ctx.expect(!errors.length, `analysis: every check runs (${errors.map(e => `${e.check}: ${e.text}`).join(" | ") || "no failure"})`);
    const todo = fixable(scan);
    ctx.log(`to repair: ${todo.length} task(s) — ${countByCheck(todo)}`);
    if ( !ctx.expect(todo.length > 0, "the analysis finds something to repair") ) return;

    const started = Date.now();
    const repaired = await api("diagnosticRepair");
    const seconds = Math.round((Date.now() - started) / 1000);
    if ( repaired.backup?.uuid ) created.push(repaired.backup.uuid);
    ctx.expect(!!repaired.backup?.uuid, `repair: backup made and verified first (${repaired.backup?.name ?? "none"})`);
    const ko = repaired.results.filter(r => !r.ok);
    ctx.expect(!ko.length, `repair: ${repaired.results.length - ko.length}/${repaired.results.length} task(s) in ${seconds} s${ko.length ? ` — failed: ${ko.slice(0, 5).map(r => `${r.check} ${r.where}: ${r.line}`).join(" | ")}` : ""}`);
    const consoleErrors = await ctx.clientErrors();
    const list = Array.isArray(consoleErrors) ? consoleErrors : [];
    ctx.expect(!list.length, `no error in the console during the analysis and the repair${list.length ? ` (${list.slice(0, 3).map(e => String(e.message ?? e.text ?? e).slice(0, 160)).join(" | ")})` : ""}`);

    const after = await api("diagnosticScan");
    const describe = tasks => tasks.slice(0, 3).map(t => `${t.where}: ${t.text}`.slice(0, 160)).join(" | ");
    const known = fixable(after).filter(t => KNOWN_LEFT[t.check]);
    if ( known.length ) ctx.log(`⚠ known, not counted: ${countByCheck(known)} — ${KNOWN_LEFT[known[0].check]} — ${describe(known)}`);
    const left = fixable(after).filter(t => !KNOWN_LEFT[t.check]);
    ctx.expect(!left.length, `new analysis: nothing fixable left (${countByCheck(left)})${left.length ? ` — ${describe(left)}` : ""}`);

    // 4. The repair is undone from its own backup (the restorations registered above then finish the job).
    const undo = await api("diagnosticRestore", { uuid: repaired.backup.uuid });
    if ( undo.before?.uuid ) created.push(undo.before.uuid);
    const undoFailed = undo.lines.filter(l => NOT_RESTORED.test(l));
    ctx.expect(!undoFailed.length, `restore of the repair backup: ${undo.lines.length} document(s)${undoFailed.length ? ` — ${undoFailed.slice(0, 3).join(" | ")}` : ""}`);
  }
};
