/**
 * §245, §257 (issue #21): the "D&D Beyond" check of the diagnostic, on an actor created for the test.
 *  - An Armor of Agathys from the Handbook, marked as imported from DDB (`flags.ddbimporter`) and whose activities received
 *    other ids: the engine's rule cites the Handbook's retaliation activity, absent from the copy → reported, with the pack
 *    of the official item.
 *  - The same, marked DDB but with the Handbook's ids: nothing to report.
 *  - The copy with changed ids, without a DDB mark: not this check's business.
 *  The analysis writes nothing; the repair puts the official item in its place, without then with the DDB Importer lock.
 */
const MODULE_ID = "dnd5e-combat";
const PACK = "dnd-players-handbook.spells";

export default {
  name: "diagnostic-ddb — objet DDB aux ids d'activité changés signalé, puis remplacé par l'officiel, avec et sans verrou",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const index = await ctx.call("list-compendium-entries", { packId: PACK, search: "Agathys" }).catch(() => []);
    const uuid = (Array.isArray(index) ? index : []).find(e => /Agathys/i.test(e.name))?.uuid;
    const ref = uuid ? await ctx.call("get-compendium-entry", { uuid }).catch(() => null) : null;
    const activities = ref?.data?.system?.activities ?? {};
    if ( !Object.keys(activities).length ) { ctx.log(`Armure d'Agathys introuvable dans ${PACK} : non applicable`); return; }

    const { _id, folder, ownership, _stats, ...base } = ref.data;
    const rekeyed = {};
    Object.values(activities).forEach((activity, i) => {
      const id = `ddbTestActivit${String(i).padStart(2, "0")}`;
      rekeyed[id] = { ...activity, _id: id };
    });
    const ddbFlag = { ddbimporter: { id: 123456, dndbeyond: { test: true } } };
    const items = [
      { ...base, name: "DAS DDB renamed", system: { ...base.system, activities: rekeyed }, flags: { ...(base.flags ?? {}), ...ddbFlag } },
      { ...base, name: "DAS DDB intact", flags: { ...(base.flags ?? {}), ...ddbFlag } },
      { ...base, name: "DAS not DDB", system: { ...base.system, activities: rekeyed } }
    ];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));
    const created = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic DDB (test)", type: "npc", flags: { [MODULE_ID]: { scenario: "diagnostic-ddb" } }, items
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur de test créé, avec trois copies de l'Armure d'Agathys") ) return;
    const root = `Actor.${actorId}`;
    const before = JSON.stringify((await ctx.call("get-actor", { actorId })).items?.map(i => [i.name, i.flags, Object.keys(i.system?.activities ?? {})]));

    const scan = await api("diagnosticScan", { checks: ["ddb"] });
    const mine = (scan.ddb ?? []).filter(t => t.root?.uuid === root);
    ctx.expect(mine.length === 1, `une seule ligne pour l'acteur de test (${mine.map(t => t.text).join(" | ") || "aucune"})`);
    ctx.expect(/DAS DDB renamed/.test(mine[0]?.text ?? ""), `la copie DDB aux ids changés est signalée : ${mine[0]?.text ?? "—"}`);
    ctx.expect((mine[0]?.text ?? "").includes(PACK), `la ligne renvoie à l'objet officiel (${PACK})`);
    ctx.expect(!mine.some(t => /DAS DDB intact|DAS not DDB/.test(t.text)), "ni la copie DDB intacte, ni la copie sans marque DDB");
    ctx.expect(mine[0]?.fixable === true, "la copie DDB aux ids changés est réparable");
    const after = JSON.stringify((await ctx.call("get-actor", { actorId })).items?.map(i => [i.name, i.flags, Object.keys(i.system?.activities ?? {})]));
    ctx.expect(after === before, "l'analyse n'a rien écrit");

    // The repair: the official item in its place, same id, DDB flags kept; with the lock, `ignoreItemImport` and the DDB name
    // (no `definitionId` on the test copy: DDB Importer would then only match it by its name).
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors: [] }));
    const officialIds = Object.keys(activities).sort().join(",");
    const itemsOf = async () => (await ctx.call("get-actor", { actorId })).items ?? [];
    const renamedId = (await itemsOf()).find(i => i.name === "DAS DDB renamed")?._id;
    for ( const lock of [false, true] ) {
      if ( lock ) {
        // Put the DDB copy with changed ids back, under the same id, for the second pass.
        await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: renamedId });
        await ctx.engine("restoreItem", { actorId, itemData: { ...items[0], _id: renamedId } });
      }
      const repaired = await api("diagnosticRepair", { checks: ["ddb"], roots: [root], options: { ddb: { lock } } });
      if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
      ctx.expect(repaired.results?.length === 1 && repaired.results[0].ok, `${lock ? "avec" : "sans"} verrou : une réparation réussie (${repaired.results?.map(r => r.line).join(" | ")})`);
      const item = (await itemsOf()).find(i => i._id === renamedId);
      ctx.expect(!!item, `${lock ? "avec" : "sans"} verrou : l'objet garde son id`);
      ctx.expect(Object.keys(item?.system?.activities ?? {}).sort().join(",") === officialIds, `${lock ? "avec" : "sans"} verrou : ids d'activités du Manuel`);
      ctx.expect(item?.flags?.ddbimporter?.id === 123456, `${lock ? "avec" : "sans"} verrou : flags de DDB Importer gardés`);
      ctx.expect(!!item?.flags?.ddbimporter?.ignoreItemImport === lock, `${lock ? "avec" : "sans"} verrou : ignoreItemImport ${lock ? "posé" : "absent"}`);
      if ( lock ) ctx.expect(item?.name === "DAS DDB renamed", `avec verrou : nom DDB gardé (${item?.name})`);
      else ctx.expect(item?.name === ref.data.name, `sans verrou : nom de l'objet officiel (${item?.name})`);
      const rescan = await api("diagnosticScan", { checks: ["ddb"] });
      ctx.expect(!(rescan.ddb ?? []).some(t => t.root?.uuid === root), `${lock ? "avec" : "sans"} verrou : plus rien de signalé pour l'acteur de test`);
    }
  }
};
