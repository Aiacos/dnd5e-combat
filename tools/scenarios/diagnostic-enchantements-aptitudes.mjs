/**
 * §453 : le diagnostic « Enchantements des aptitudes » (progression « ModifyItem » de dnd5e 6.1). Un acteur reçoit, posés directement
 * (sans la progression, comme une aptitude remplacée par sa version 3.0.0 ou un objet obtenu après), Frappes renforcées et l'attaque à
 * mains nues du Moine, Frappe rusée et Armes empoisonnées du Roublard. L'analyse trouve les deux enchantements manquants ; la réparation
 * (sauvegarde d'abord) les pose comme dnd5e — sur l'attaque à mains nues et sur Frappe rusée, marqués par la progression — et dnd5e
 * crée le rider d'Armes empoisonnées (l'activité « Poison » sur Frappe rusée), inscrit dans la progression ; une nouvelle analyse ne
 * trouve plus rien. Acteur et sauvegarde retirés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.classes.Item.";
const CHECK = "modify-item";

export default {
  name: "diagnostic — enchantements des aptitudes (ModifyItem)",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const actors = [];
    const backups = [];
    const hadPack = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => [])) ?? "").includes("world.das-backups");
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));

    /** Un objet du Manuel, tel quel, avec son origine. */
    const entry = async id => {
      const uuid = PHB + id;
      const res = await ctx.call("get-compendium-entry", { uuid }).catch(() => null);
      if ( !res?.data ) return null;
      const { _id, folder, ownership, _stats, ...d } = JSON.parse(JSON.stringify(res.data));
      d._stats = { compendiumSource: uuid };
      return d;
    };
    const items = [await entry("phbmnkUnarmedStr"), await entry("phbmnkEmpoweredS"), await entry("phbrgeCunningStr"),
      await entry("phbrgeEnvenomWea")];
    if ( items.some(i => !i) ) { ctx.log("Manuel des joueurs 3.0.0 absent (aptitudes introuvables) : non applicable"); return; }
    const modifies = items.filter(i => Object.values(i.system?.advancement ?? {}).some(a => a.type === "ModifyItem"));
    if ( !ctx.expect(modifies.length === 2, `deux aptitudes à progression ModifyItem (${modifies.map(i => i.name).join(", ")})`) ) return;

    const created = await ctx.call("create-actor", { actorData: { name: "Enchantements (diagnostic)", type: "character",
      flags: { [MODULE_ID]: { scenario: "diagnostic-enchantements-aptitudes" } }, items } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur créé avec ses quatre objets") ) return;

    const sheet = async () => (await ctx.call("get-actor", { actorId })).items ?? [];
    const byIdent = (list, ident) => list.find(i => i.system?.identifier === ident);
    const effectsOf = item => item?.effects ?? [];
    const marked = (item, feature) => effectsOf(item).filter(e => String(e.flags?.dnd5e?.advancementOrigin ?? "").startsWith(`${feature?._id}.`));
    const before = await sheet();
    const fist0 = byIdent(before, "unarmed-strike");
    const cunning0 = byIdent(before, "cunning-strike");
    ctx.expect(!marked(fist0, byIdent(before, "empowered-strikes")).length && !marked(cunning0, byIdent(before, "envenom-weapons")).length,
      "avant : aucun enchantement posé (aptitudes posées sans leur progression)");
    const activities0 = Object.keys(cunning0?.system?.activities ?? {}).length;

    const root = `Actor.${actorId}`;
    const scan = await api("diagnosticScan", { checks: [CHECK] });
    const mine = (scan[CHECK] ?? []).filter(t => t.root?.uuid === root);
    ctx.log(`analyse : ${mine.map(t => t.text).join(" | ") || "rien"}`);
    ctx.expect((mine.length === 1) && mine[0].fixable, "analyse : une tâche pour la fiche, réparable");
    ctx.expect((mine[0]?.text.match(/✨/g) ?? []).length === 2, "deux enchantements manquants : mains nues et Frappe rusée");

    const repaired = await api("diagnosticRepair", { checks: [CHECK], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(!!repaired.backup?.uuid, "une sauvegarde est faite avant la réparation");
    ctx.expect((repaired.results.length === 1) && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line ?? r.error).join(" | ") || "aucune"}`);

    const after = await sheet();
    const empowered = byIdent(after, "empowered-strikes");
    const envenom = byIdent(after, "envenom-weapons");
    const fist = byIdent(after, "unarmed-strike");
    const cunning = byIdent(after, "cunning-strike");
    const onFist = marked(fist, empowered);
    const onCunning = marked(cunning, envenom);
    ctx.log(`après : mains nues ${onFist.map(e => `${e.name}/${e.type}/transfer=${e.transfer}`).join(", ") || "rien"} ; Frappe rusée ${onCunning.map(e => `${e.name}/${e.type}`).join(", ") || "rien"}`);
    ctx.expect((onFist.length === 1) && (onFist[0].type === "enchantment") && onFist[0].transfer, "l'attaque à mains nues porte l'enchantement de Frappes renforcées");
    ctx.expect((onFist[0]?.system?.origin?.item ?? "").endsWith(`Item.${empowered?._id}`), "son origine est l'aptitude");
    ctx.expect(onCunning.length === 1, "Frappe rusée porte l'enchantement d'Armes empoisonnées");
    const riderActs = Object.values(cunning?.system?.activities ?? {}).filter(a => a.flags?.dnd5e?.dependentOn === onCunning[0]?._id);
    ctx.expect((riderActs.length === 1) && (Object.keys(cunning?.system?.activities ?? {}).length === activities0 + 1),
      `dnd5e a créé le rider : l'activité « ${riderActs[0]?.name ?? "?"} » sur Frappe rusée`);
    const advOf = feature => Object.values(feature?.system?.advancement ?? {}).find(a => a.type === "ModifyItem");
    const noted = advOf(envenom)?.value?.modified ?? [];
    ctx.expect((noted.length === 1) && (noted[0].item === cunning?._id) && (noted[0].riders ?? []).some(r => r.includes(".Activity.")),
      "la progression d'Armes empoisonnées note l'enchantement et son rider (une redescente de niveau les retire)");
    ctx.expect((advOf(empowered)?.value?.modified ?? []).length === 1, "la progression de Frappes renforcées note l'enchantement");

    const again = await api("diagnosticScan", { checks: [CHECK] });
    ctx.expect(!(again[CHECK] ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien");
  }
};
