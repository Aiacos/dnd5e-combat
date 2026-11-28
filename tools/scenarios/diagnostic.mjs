/**
 * The world diagnostic (§177), end to end, on an actor created for the test (marked `flags.dnd5e-combat.scenario`):
 *  - the actor carries Midi-QOL traces (flag on the sheet, Player's Handbook Fire Bolt marked Midi, homebrew item
 *    marked DAE);
 *  - the analysis finds it without writing anything;
 *  - the repair backs it up first ("DAS · Backups" compendium entry, read back and verified), then cleans: flags
 *    removed, Fire Bolt replaced by the official one with the same id;
 *  - the restoration puts it back exactly as before (flags back, same items, same ids), after a "before
 *    restoration" backup.
 * Restores everything: actor, backup entries, and the compendium if it did not exist before.
 */
const MODULE_ID = "dnd5e-combat";
const FIRE_BOLT = "Compendium.dnd-players-handbook.spells.Item.phbsplFireBolt00";

export default {
  name: "diagnostic — analyse, réparation sauvegardée, restauration exacte",

  async run(ctx) {
    // `ctx.engine` resumes a long call (backup, restoration) by its callId: the connector hands control back after 8 s.
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    const actors = [];
    let actorId = null;
    let tokenId = null;
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    ctx.restore(() => tokenId && ctx.call("delete-scene-object", { type: "Token", objectId: tokenId }).catch(() => {}));

    // L'acteur de test, avec ses traces.
    const { data: bolt } = await ctx.call("get-compendium-entry", { uuid: FIRE_BOLT });
    const { _id, folder, ownership, _stats, ...boltData } = bolt;
    boltData.flags = { ...(boltData.flags ?? {}), "midi-qol": { onUseMacroName: "test" } };
    boltData._stats = { compendiumSource: FIRE_BOLT };
    const created = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic (test)", type: "npc",
      flags: { "midi-qol": { test: true }, [MODULE_ID]: { scenario: "diagnostic" } },
      items: [boltData, { name: "Amulette maison", type: "loot", flags: { dae: { macro: "x" } } }]
    } });
    actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur de test créé") ) return;
    const uuid = `Actor.${actorId}`;
    const read = async () => (await ctx.call("get-actor", { actorId })) ?? {};
    const before = await read();
    const itemIds = a => (a.items ?? []).map(i => i._id).sort().join(",");
    const flagsOf = a => Object.keys(a.flags ?? {}).sort().join(",");
    ctx.log(`avant : flags ${flagsOf(before)} ; objets ${itemIds(before)}`);

    // 1. Analysis: nothing is written.
    const scan = await api("diagnosticScan", { checks: ["clean-midi"] });
    const task = (scan["clean-midi"] ?? []).find(t => t.root?.uuid === uuid);
    ctx.expect(!!task?.fixable, `analyse : la fiche est trouvée, réparable (${task?.text ?? "rien"})`);
    ctx.expect(flagsOf(await read()) === flagsOf(before), "analyse : rien n'est écrit");

    // 2. Repair, after backup.
    const repaired = await api("diagnosticRepair", { checks: ["clean-midi"], roots: [uuid] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(!!repaired.backup?.uuid, `réparation : sauvegarde faite d'abord (${repaired.backup?.name ?? "aucune"})`);
    ctx.expect(repaired.results.length === 1 && repaired.results[0].ok, `réparation : tâche réussie (${repaired.results.map(r => r.line).join(" | ")})`);
    const after = await read();
    ctx.expect(!after.flags?.["midi-qol"], `réparation : flag Midi-QOL retiré de la fiche (${flagsOf(after)})`);
    const boltAfter = (after.items ?? []).find(i => i.name === bolt.name || i.system?.identifier === "fire-bolt");
    ctx.expect(!!boltAfter && !boltAfter.flags?.["midi-qol"], "réparation : Trait de feu sans flag Midi");
    ctx.expect(itemIds(after) === itemIds(before), "réparation : mêmes ids d'objets (remplacement sur place)");

    // 3. The backup is there, and contains the sheet.
    const list = await api("diagnosticBackups");
    const entry = list.find(b => b.uuid === repaired.backup?.uuid);
    ctx.expect(!!entry && entry.roots.some(r => r.uuid === uuid), `sauvegarde listée avec la fiche (${entry?.name ?? "absente"})`);

    // 4. Restauration exacte.
    const restored = await api("diagnosticRestore", { uuid: repaired.backup.uuid });
    if ( restored.before?.uuid ) backups.push(restored.before.uuid);
    ctx.expect(!!restored.before?.uuid, `restauration : état actuel sauvegardé d'abord (${restored.before?.name ?? "non"})`);
    const back = await read();
    ctx.expect(!!back.flags?.["midi-qol"]?.test, "restauration : flag Midi-QOL de la fiche revenu");
    ctx.expect(itemIds(back) === itemIds(before), `restauration : mêmes objets (${itemIds(back)})`);
    const boltBack = (back.items ?? []).find(i => i._id === boltAfter?._id);
    ctx.expect(boltBack?.flags?.["midi-qol"]?.onUseMacroName === "test", "restauration : flag Midi du Trait de feu revenu");
    const amulet = (back.items ?? []).find(i => i.name === "Amulette maison");
    ctx.expect(amulet?.flags?.dae?.macro === "x", "restauration : flag DAE de l'objet maison revenu");

    // Part 2: an unlinked token — its own copy of the actor (delta) is backed up and restored apart from the world actor.
    // An Item Piles heap with a base action placed by mistake: on the world actor, and another on the token only.
    const basic = which => ({ name: `Basic ${which}`, type: "feat", flags: { [MODULE_ID]: { basicAction: which } } });
    const pile = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic tas (test)", type: "npc", prototypeToken: { actorLink: false },
      flags: { "item-piles": { data: { enabled: true } }, [MODULE_ID]: { scenario: "diagnostic" } }, items: [basic("dash")]
    } });
    const pileId = pile.id ?? pile.actorId ?? pile.actor?._id;
    if ( pileId ) actors.push(pileId);
    const { sceneId } = await ctx.scene();
    const placed = await ctx.call("place-token", { actorId: pileId, sceneId, x: 140, y: 140 });
    tokenId = placed.id ?? placed.tokenId ?? placed.token?._id;
    if ( !ctx.expect(!!pileId && !!tokenId, "tas de test et son token non lié posés") ) return;
    const tokenUuid = `Scene.${sceneId}.Token.${tokenId}`;
    await ctx.call("upsert-embedded-item", { uuid: `${tokenUuid}.Actor.${pileId}`, itemData: basic("dodge") });
    const tokenItems = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: tokenId });
      return (data.delta?.items ?? []).map(i => `${i.name}:${i._id}`).sort().join(",");
    };
    const deltaBefore = await tokenItems();
    ctx.log(`delta du token avant : ${deltaBefore || "rien"}`);

    const pileScan = await api("diagnosticScan", { checks: ["item-piles"] });
    const roots = (pileScan["item-piles"] ?? []).map(t => t.root?.uuid);
    ctx.expect(roots.includes(`Actor.${pileId}`) && roots.includes(tokenUuid), `analyse : l'acteur et le token sont deux racines (${roots.join(", ")})`);
    const fixed = await api("diagnosticRepair", { checks: ["item-piles"], roots: [`Actor.${pileId}`, tokenUuid] });
    if ( fixed.backup?.uuid ) backups.push(fixed.backup.uuid);
    ctx.expect(fixed.results.length === 2 && fixed.results.every(r => r.ok), `réparation des deux racines (${fixed.results.map(r => `${r.where} : ${r.line}`).join(" | ")})`);
    const deltaFixed = await tokenItems();
    ctx.expect(!deltaFixed.includes("Basic dodge"), `réparation : l'action de base du token retirée (${deltaFixed || "rien"})`);
    const pileAfter = await ctx.call("get-actor", { actorId: pileId });
    ctx.expect(!(pileAfter.items ?? []).length, "réparation : l'action de base de l'acteur retirée");

    const back2 = await api("diagnosticRestore", { uuid: fixed.backup.uuid });
    if ( back2.before?.uuid ) backups.push(back2.before.uuid);
    ctx.expect((await tokenItems()) === deltaBefore, `restauration : le delta du token est revenu (${await tokenItems()})`);
    const pileBack = await ctx.call("get-actor", { actorId: pileId });
    ctx.expect((pileBack.items ?? []).some(i => i.name === "Basic dash"), "restauration : l'action de base de l'acteur est revenue");
  }
};
