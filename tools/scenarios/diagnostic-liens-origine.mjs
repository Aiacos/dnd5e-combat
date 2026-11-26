/**
 * §553: the world diagnostic's backup survives an item whose `_stats.compendiumSource` Foundry refuses ("must contain a valid document
 * ID"; Discord "Diagnostic Repair Error": the whole Adventure was refused, so no repair could run).
 *
 * Fixture: such a value cannot be written through Foundry (client and server both validate it). The scenario stores a VALID UUID,
 * then adds, on the GM client only, a compendium UUID redirect (`game.compendiumUUIDRedirects`, read by parseUuid,
 * common/utils/helpers.mjs:1329) that points it to an id of the wrong shape: from then on the client refuses that value exactly as
 * RG's client did, while the actor in memory stays loaded. The redirect is removed at the end.
 *
 *  1. the old behaviour is reproduced: an Adventure holding the actor is refused, naming the item's `_stats.compendiumSource`;
 *  2. a repair (clean-midi) on that actor now makes its backup (the copy kept as raw data in the flags) and runs;
 *  3. "Broken source links" finds the item; its repair clears the link, after its own backup;
 *  4. restoring the first backup brings the sheet back exactly, the damaged item untouched;
 *  5. restoring the second one restores what Foundry accepts, and says it could not write back the refused link.
 * Cleans up: redirect, actor, backup entries, and the compendium if it did not exist before.
 */
const MODULE_ID = "dnd5e-combat";
const LINK = "Compendium.world.das-diag-old.Item.DasDiagLink00001";
const BROKEN = "Compendium.world.das-diag-old.Item.not-a-valid-id";

const REDIRECT = `
  const { LINK, BROKEN, on } = args;
  if ( on ) {
    globalThis.__dasDiagRedirects ??= game.compendiumUUIDRedirects;
    const tree = new foundry.utils.StringTree();
    for ( const [prefix, target] of Object.entries(CONFIG.compendium.uuidRedirects ?? {}) ) {
      if ( prefix.startsWith("Compendium.") ) tree.addLeaf(prefix.split("."), target.split("."));
    }
    tree.addLeaf(LINK.split("."), BROKEN.split("."));
    game.compendiumUUIDRedirects = tree;
  } else if ( globalThis.__dasDiagRedirects ) {
    game.compendiumUUIDRedirects = globalThis.__dasDiagRedirects;
    delete globalThis.__dasDiagRedirects;
  }
  return { documentId: foundry.utils.parseUuid(LINK)?.documentId ?? null };
`;

const TRIAL = `
  const actor = game.actors.get(args.actorId);
  try {
    new Adventure.implementation({ name: "trial", actors: [actor.toObject()] }, { strict: true });
    return { refused: false };
  } catch(err) {
    return { refused: true, paths: Object.keys(err.getAllFailures?.() ?? {}) };
  }
`;

const ENTRY = `
  const entry = await fromUuid(args.uuid);
  const meta = entry?.getFlag("${MODULE_ID}", "backup") ?? {};
  return { actors: entry?.actors?.size ?? 0, raw: (meta.raw ?? []).map(r => r.uuid),
    rawLink: (meta.raw ?? [])[0]?.data?.items?.find(i => i.name === "Old axe")?._stats?.compendiumSource ?? null };
`;

export default {
  name: "diagnostic — backup and repair despite a broken source link, exact restore",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result;
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    ctx.restore(() => script(REDIRECT, { LINK, BROKEN, on: false }));

    const created = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic links (test)", type: "npc",
      flags: { "midi-qol": { test: true }, [MODULE_ID]: { scenario: "diagnostic-liens-origine" } },
      items: [
        { name: "Old axe", type: "weapon", _stats: { compendiumSource: LINK } },
        { name: "Home-made amulet", type: "loot", flags: { dae: { macro: "x" } } }
      ]
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "test actor created, its Old axe linked to a compendium entry") ) return;
    const uuid = `Actor.${actorId}`;
    const read = async () => (await ctx.call("get-actor", { actorId })) ?? {};
    const axeOf = a => (a.items ?? []).find(i => i.name === "Old axe");
    const itemIds = a => (a.items ?? []).map(i => i._id).sort().join(",");
    const before = await read();
    ctx.expect(axeOf(before)?._stats?.compendiumSource === LINK, `link stored as given (${axeOf(before)?._stats?.compendiumSource})`);

    // The client now refuses that value, like RG's.
    const redirected = await script(REDIRECT, { LINK, BROKEN, on: true });
    ctx.expect(redirected?.documentId === "not-a-valid-id", `the client reads the link as a broken id (${redirected?.documentId})`);
    const trial = await script(TRIAL, { actorId });
    ctx.expect(trial?.refused && trial.paths.some(p => /items\.\d+\._stats\.compendiumSource/.test(p)),
      `old behaviour reproduced: an Adventure with this actor is refused (${(trial?.paths ?? []).join(", ") || "accepted"})`);

    // 1. A repair on that actor: its backup is made anyway.
    const repaired = await api("diagnosticRepair", { checks: ["clean-midi"], roots: [uuid] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    if ( !ctx.expect(!!repaired.backup?.uuid, `repair: backup made first (${repaired.backup?.name ?? "none"})`) ) return;
    ctx.expect(repaired.results.length === 1 && repaired.results[0].ok, `repair: task done (${repaired.results.map(r => r.line).join(" | ")})`);
    const entry = await script(ENTRY, { uuid: repaired.backup.uuid });
    ctx.expect(entry?.raw?.includes(uuid) && entry.actors === 0, `backup: the actor kept as raw data in the entry (${JSON.stringify(entry)})`);
    ctx.expect(entry?.rawLink === LINK, `backup: the link kept exactly (${entry?.rawLink})`);
    const repairedActor = await read();
    ctx.expect(!repairedActor.flags?.["midi-qol"], "repair: Midi-QOL flag removed");

    // 2. The new check finds the link.
    const scan = await api("diagnosticScan", { checks: ["source-links"] });
    const task = (scan["source-links"] ?? []).find(t => t.root?.uuid === uuid);
    ctx.expect(!!task?.fixable && /Old axe/.test(task.text ?? ""), `check: broken link found (${task?.text ?? "nothing"})`);

    // 3. Restore the first backup: the sheet as it was, the damaged item untouched.
    const restored = await api("diagnosticRestore", { uuid: repaired.backup.uuid });
    if ( restored.before?.uuid ) backups.push(restored.before.uuid);
    ctx.expect(!!restored.before?.uuid, `restore: current state backed up first (${restored.before?.name ?? "no"})`);
    ctx.expect(!(restored.lines ?? []).some(l => /not restored|non restauré/i.test(l)), `restore: ${(restored.lines ?? []).join(" | ")}`);
    const back = await read();
    ctx.expect(!!back.flags?.["midi-qol"]?.test, "restore: Midi-QOL flag back");
    ctx.expect(itemIds(back) === itemIds(before), `restore: same items (${itemIds(back)})`);
    ctx.expect(axeOf(back)?._stats?.compendiumSource === LINK, `restore: link unchanged (${axeOf(back)?._stats?.compendiumSource})`);

    // 4. Repair the link, after a backup.
    const fixed = await api("diagnosticRepair", { checks: ["source-links"], roots: [uuid] });
    if ( fixed.backup?.uuid ) backups.push(fixed.backup.uuid);
    ctx.expect(!!fixed.backup?.uuid && fixed.results.length === 1 && fixed.results[0].ok,
      `link repair: ${fixed.results.map(r => r.line).join(" | ") || "nothing"} (backup ${fixed.backup?.name ?? "none"})`);
    const cleared = await read();
    ctx.expect(axeOf(cleared)?._stats?.compendiumSource === null, `link repair: link cleared (${axeOf(cleared)?._stats?.compendiumSource})`);
    ctx.expect(itemIds(cleared) === itemIds(before), "link repair: the item is kept");
    const rescan = await api("diagnosticScan", { checks: ["source-links"] });
    ctx.expect(!(rescan["source-links"] ?? []).some(t => t.root?.uuid === uuid), "link repair: nothing left to find");

    // 5. Restore it: everything Foundry accepts, and a word about the link it refuses.
    const undone = await api("diagnosticRestore", { uuid: fixed.backup.uuid });
    if ( undone.before?.uuid ) backups.push(undone.before.uuid);
    const lines = (undone.lines ?? []).join(" | ");
    ctx.expect(/source link not written back|lien d'origine non réécrit/i.test(lines), `restore: the refused link is reported (${lines})`);
    ctx.expect(!/not restored|non restauré/i.test(lines), "restore: the actor itself is restored");
    const last = await read();
    ctx.expect(itemIds(last) === itemIds(before), "restore: same items");
  }
};
