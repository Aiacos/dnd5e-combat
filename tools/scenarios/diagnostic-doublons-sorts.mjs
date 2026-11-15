/**
 * §449 : le diagnostic « Sorts en double ». Un acteur porte Guiding Bolt deux fois pour la même classe — la copie du SRD 5.2 préparée,
 * portant un réglage du moteur, et celle du Manuel des joueurs non préparée (ce qu'un module de préparation laisse quand il ne reconnaît
 * pas le sort du SRD) —, plus des sorts qui ne sont PAS des doublons : une copie « rituel seulement », Bless donné par une sous-classe à
 * côté de Bless de classe, Bane seul. L'analyse trouve le seul doublon ; la réparation (sauvegarde d'abord) garde la copie du Manuel,
 * préparée, avec le réglage de l'autre, et supprime celle du SRD ; le reste ne bouge pas ; une nouvelle analyse ne trouve plus rien.
 * Acteur et sauvegarde retirés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const SRD = "Compendium.dnd5e.spells24.Item.";
const CHECK = "spell-duplicates";

export default {
  name: "diagnostic — sorts en double",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const actors = [];
    const backups = [];
    const hadPack = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => [])) ?? "").includes("world.das-backups");
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));

    /** Un sort d'un compendium, prêt à poser sur la fiche avec son origine (`_stats.compendiumSource`) et des retouches. */
    const spell = async (uuid, system, flags={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...d } = JSON.parse(JSON.stringify(data));
      Object.assign(d.system ??= {}, system);
      d.flags = { ...(d.flags ?? {}), ...flags };
      d._stats = { compendiumSource: uuid };
      return d;
    };
    const cls = { sourceItem: "class:cleric", method: "spell" };
    const srdBolt = await spell(SRD + "phbsplGuidingBol", { ...cls, prepared: 1 }, { [MODULE_ID]: { scenario: "diagnostic-doublons-sorts" } });
    const items = [
      srdBolt,
      await spell(PHB + "phbsplGuidingBol", { ...cls, prepared: 0 }),
      await spell(PHB + "phbsplGuidingBol", { sourceItem: "class:cleric", method: "ritual", prepared: 0 }),
      await spell(PHB + "phbsplBless00000", { sourceItem: "subclass:life", method: "spell", prepared: 2 }),
      await spell(PHB + "phbsplBless00000", { ...cls, prepared: 1 }),
      await spell(PHB + "phbsplBane000000", { ...cls, prepared: 1 })
    ];
    const created = await ctx.call("create-actor", { actorData: { name: "Doublons (diagnostic)", type: "character",
      flags: { [MODULE_ID]: { scenario: "diagnostic-doublons-sorts" } }, items } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur créé avec ses six sorts") ) return;
    const spells = async () => ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => i.type === "spell");
    const describe = s => `${s.system.identifier}:${s.system.method}/${s.system.prepared}:${s.system.sourceItem}:${(s._stats?.compendiumSource ?? "").split(".")[1]}`;
    const before = await spells();
    ctx.log(`avant : ${before.map(describe).join(" | ")}`);
    ctx.expect(before.length === 6, `six sorts sur la fiche (${before.length})`);
    ctx.expect(before.some(s => (s.system.identifier === "guiding-bolt") && (s._stats?.compendiumSource ?? "").startsWith(SRD)),
      "la copie du SRD garde son origine");

    const root = `Actor.${actorId}`;
    const scan = await api("diagnosticScan", { checks: [CHECK] });
    const mine = (scan[CHECK] ?? []).filter(t => t.root?.uuid === root);
    ctx.log(`analyse : ${mine.map(t => t.text).join(" | ") || "rien"}`);
    ctx.expect((mine.length === 1) && mine[0].fixable, "analyse : une tâche pour la fiche, réparable");
    ctx.expect(mine.length === 1 && (mine[0].text.match(/♊/g) ?? []).length === 1, "un seul groupe : Guiding Bolt (ni le rituel, ni Bless de sous-classe, ni Bane)");

    const repaired = await api("diagnosticRepair", { checks: [CHECK], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(!!repaired.backup?.uuid, "une sauvegarde est faite avant la réparation");
    ctx.expect((repaired.results.length === 1) && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line ?? r.error).join(" | ") || "aucune"}`);

    const after = await spells();
    ctx.log(`après : ${after.map(describe).join(" | ")}`);
    const bolts = after.filter(s => (s.system.identifier === "guiding-bolt") && (s.system.method === "spell"));
    ctx.expect(bolts.length === 1, `une seule copie de classe de Guiding Bolt (${bolts.length})`);
    const kept = bolts[0];
    ctx.expect((kept?._stats?.compendiumSource ?? "").startsWith(PHB), "la copie gardée est celle du Manuel des joueurs");
    ctx.expect(kept?.system?.prepared === 1, `elle est préparée, comme l'était la copie retirée (${kept?.system?.prepared})`);
    ctx.expect(kept?.flags?.[MODULE_ID]?.scenario === "diagnostic-doublons-sorts", "elle a repris le réglage de module de la copie retirée");
    ctx.expect(after.length === 5, `le reste ne bouge pas : rituel, deux Bless, Bane (${after.length} sorts)`);
    const again = await api("diagnosticScan", { checks: [CHECK] });
    ctx.expect(!(again[CHECK] ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien");
  }
};
