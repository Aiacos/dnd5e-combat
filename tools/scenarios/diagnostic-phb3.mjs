/**
 * §438: the "Player's Handbook 3.0.0" diagnostic. An actor created in one go imitates a sheet made with Handbook 2.2.0: Paladin
 * class, Oath of Vengeance under its old identifier (`vengeance`), Hunter's Mark given by the subclass
 * (`system.sourceItem` "subclass:vengeance"), Smite without its two level 13 options (the old form, before 3.0.0 stored
 * the Improved Smite activities there). Checks:
 *  - `phb3-subclasses`: the subclass is found, checked automatically; the repair (backup first) renames it `oath-vengeance` and
 *    the spell follows (`subclass:oath-vengeance`);
 *  - `phb3-items`: the sheet is offered, unchecked, Smite in the preview; the repair puts back the reference's activities, same
 *    item id; the class and the other items do not move;
 *  - a new analysis finds nothing; restoring the backup gives back the old identifier.
 * Actor and backups removed. Plays nothing without Handbook 3.0.0.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const UUIDS = {
  paladin: `${PHB}.classes.Item.phbpdnPaladin000`,
  vengeance: `${PHB}.classes.Item.phbpdnOathOfVeng`,
  mark: `${PHB}.spells.Item.phbsplHuntersMar`,
  brutal: `${PHB}.classes.Item.phbbrbBrutalStri`
};
const LEVEL13 = ["vcAdrcmUKQWA68QT", "MP1qQsApCj19F2M5"];   // Staggering Blow, Sundering Blow (3.0.0, niveau 13)

export default {
  name: "diagnostic-phb3 — sous-classes et objets du Manuel des joueurs 3.0.0",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 180000 });
    const probe = await ctx.call("get-compendium-entry", { uuid: UUIDS.vengeance }).catch(() => null);
    if ( probe?.data?.system?.identifier !== "oath-vengeance" ) { ctx.log("Manuel des joueurs 3.0.0 absent : non applicable"); return; }
    const actors = [];
    const backups = [];
    const hadPack = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => [])) ?? "").includes("world.das-backups");
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));

    const item = async (uuid, patch=fn => fn) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...rest } = JSON.parse(JSON.stringify(data));
      return patch({ ...rest, _stats: { compendiumSource: uuid } });
    };
    const items = [
      await item(UUIDS.paladin, d => { d.system.levels = 3; return d; }),
      await item(UUIDS.vengeance, d => { d.system.identifier = "vengeance"; return d; }),
      await item(UUIDS.mark, d => { d.system.sourceItem = "subclass:vengeance"; d.system.method = "spell"; d.system.prepared = 2; return d; }),
      await item(UUIDS.brutal, d => { for ( const id of LEVEL13 ) delete d.system.activities[id]; return d; })
    ];
    const created = await ctx.call("create-actor", { actorData: { name: "Fiche 2.2.0 (diagnostic)", type: "character",
      flags: { [MODULE_ID]: { scenario: "diagnostic-phb3" } }, items } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur créé (classe, sous-classe à l'ancien identifiant, sort de sous-classe, Coup brutal ancien)") ) return;
    const sheet = async () => (await ctx.call("get-actor", { actorId })).items ?? [];
    const byId = async id => (await sheet()).find(i => i.system?.identifier === id) ?? null;
    const before = await sheet();
    const brutalId = before.find(i => i.system?.identifier === "brutal-strike")?._id;
    ctx.expect(!!(await byId("vengeance")), "la sous-classe porte l'ancien identifiant « vengeance » (dnd5e 6.1 ne le migre pas)");
    const root = `Actor.${actorId}`;
    const checks = ["phb3-subclasses", "phb3-items"];

    // 1. Sous-classes
    let scan = await api("diagnosticScan", { checks });
    const sub = (scan["phb3-subclasses"] ?? []).filter(t => t.root?.uuid === root);
    ctx.expect((sub.length === 1) && sub[0].fixable && sub[0].preselect && /oath-vengeance/.test(sub[0].text) && /1/.test(sub[0].text),
      `analyse : la sous-classe à renommer, cochée, avec son sort (${sub.map(t => t.text).join(" | ") || "rien"})`);
    const items3 = (scan["phb3-items"] ?? []).filter(t => t.root?.uuid === root);
    ctx.expect((items3.length === 1) && items3[0].fixable && !items3[0].preselect && /Brutal/i.test(items3[0].text),
      `analyse : la fiche proposée pour ses objets, non cochée, Coup brutal dans l'aperçu (${items3.map(t => t.text).join(" | ") || "rien"})`);
    ctx.expect(!/Paladin|Hunter/i.test(items3[0]?.text ?? ""), "aperçu : ni la classe ni le sort à jour n'y figurent");

    const r1 = await api("diagnosticRepair", { checks: ["phb3-subclasses"], roots: [root] });
    if ( r1.backup?.uuid ) backups.push(r1.backup.uuid);
    ctx.expect(!!r1.backup?.uuid && r1.results.length === 1 && r1.results.every(r => r.ok), `réparation des sous-classes : ${r1.results.map(r => r.line).join(" | ") || "aucune"}`);
    const oath = await byId("oath-vengeance");
    const mark = await byId("hunters-mark");
    ctx.expect(!!oath && !(await byId("vengeance")), "la sous-classe s'appelle « oath-vengeance »");
    ctx.expect(mark?.system?.sourceItem === "subclass:oath-vengeance", `le sort suit sa sous-classe (${mark?.system?.sourceItem})`);

    // 2. Items — the sheet just before (the engine may have added its base actions after creation).
    const beforeItems = await sheet();
    const r2 = await api("diagnosticRepair", { checks: ["phb3-items"], roots: [root] });
    if ( r2.backup?.uuid ) backups.push(r2.backup.uuid);
    ctx.expect(!!r2.backup?.uuid && r2.results.length === 1 && r2.results.every(r => r.ok), `réparation des objets : ${r2.results.map(r => r.line).join(" | ") || "aucune"}`);
    const after = await sheet();
    const brutal = after.find(i => i._id === brutalId);
    ctx.expect(!!brutal && LEVEL13.every(id => brutal.system?.activities?.[id]), "Coup brutal : même id, les activités du niveau 13 de la référence sont là");
    ctx.expect(after.length === beforeItems.length, `aucun objet en plus ni en moins (${beforeItems.length} → ${after.length})`);
    ctx.expect(after.find(i => i.type === "class")?.system?.levels === 3, "la classe n'est pas touchée (niveau 3)");

    scan = await api("diagnosticScan", { checks });
    ctx.expect(!checks.some(c => (scan[c] ?? []).some(t => t.root?.uuid === root)), "une nouvelle analyse ne trouve plus rien");

    // 3. Restoring the first backup (before the renaming)
    if ( r1.backup?.uuid ) {
      const back = await api("diagnosticRestore", { uuid: r1.backup.uuid });
      if ( back?.before?.uuid ) backups.push(back.before.uuid);
      ctx.expect(!!(await byId("vengeance")) && ((await byId("hunters-mark"))?.system?.sourceItem === "subclass:vengeance"),
        "restauration : l'ancien identifiant et l'ancien lien du sort reviennent");
    }
  }
};
