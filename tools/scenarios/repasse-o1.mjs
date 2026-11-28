/**
 * §335, batch O1 of the item pass: the faulty data of premium items fixed by identifier (`dataFixes`).
 *  1. A test actor created with a dozen items from the Guide and the Manual: the active GM fixes each on creation (cost,
 *     charges, fixed DC, damage, carried effects, missing effect, added activity); the Manual's Unarmed Strike, correct,
 *     does not move.
 *     §457: Boots of the Zephyr (effect recreated, link correct), Manual of Vitality and Treatise on Insight (link to the
 *     effect of another book removed), Staff of Thunder and Lightning (empty damage part removed).
 *  2. Fix turned off (`dataFixes` setting), a second actor with the Wand of Webs: the diagnostic "Premium data to fix"
 *     finds it, repairs it after saving, and no longer finds it.
 *  3. Staff of Power equipped and attuned on the first actor: its AC goes up by 2.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item";
const PHB = "Compendium.dnd-players-handbook.equipment.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Item → paths and values expected after the fix (`effect:<id>:<chemin>` for an effect of the item). */
const CHECKS = [
  [`${DMG}.dmgGemOfSeeing00`, "Gemme de vision", { "effect:z8fm5PbP5qz4iJuP:system.changes.0.key": "system.attributes.senses.ranges.truesight" }],
  [`${DMG}.dmgWandOfWeb0000`, "Baguette des toiles", { "system.activities.P7PnWcum8exAm2EG.consumption.targets.0.type": "itemUses" }],
  [`${DMG}.dmgScimitarOfSpe`, "Cimeterre de célérité", { "system.activities.bV5R1UvwSlRZ3Ffi.activation.type": "action", "system.activities.dasSpeedBonusAtk.activation.type": "bonus" }],
  // §511: Guide 3.0.0, the book carries its own bonus effect (3qnJecDB1SMFTNLw) and the Core no longer creates its own;
  // 2.0.0, the Core's.
  // In both cases, a single bonus effect.
  [`${DMG}.dmgStaffOfPower0`, "Bâton de surpuissance", { "bonusEffects:dasStaffOfPower0,3qnJecDB1SMFTNLw": 1 }],
  [`${DMG}.dmgFortitudeIoun`, "Pierre de Ioun de vigueur", { "effect:hOigjfupZtZR2cy9:system.changes.0.key": "system.abilities.con.value" }],
  [`${DMG}.dmgArmorOfVulner`, "Armure de vulnérabilité", { "effect:4JvSdW6SAx9uNYFH:system.changes.0.value": "bludgeoning" }],
  [`${DMG}.dmgSuperiorPotio`, "Potion de soins supérieurs", { "system.activities.eT46ucSUynLRTs6N.range.units": "touch" }],
  [`${DMG}.dmgEarthRingOfEl`, "Anneau de la terre (source)", { "system.activities.xpuvWA5Jy39MYwCg.spell.challenge.save": "18" }],
  [`${DMG}.dmgRingOfXrayVis`, "Anneau de rayons X", { "effect:InZzuugyN8PbtKGR:statuses.0": "exhaustion" }],
  [`${DMG}.dmgOrbOfDragonki`, "Orbe des dragons", { "system.uses.max": "7" }],
  [`${DMG}.dmgRodOfLordlyMi`, "Sceptre de puissance seigneuriale", { "system.activities.apuqiDlUPRWfQkhf.damage.parts.0.bonus": "@mod" }],
  [`${DMG}.dmgLaserPistol00`, "Pistolet laser", { "system.activities.dasReloadAction0.consumption.targets.0.value": "-50" }],
  [`${DMG}.dmgUnarmedStrike`, "Attaque à mains nues (Guide)", { "system.damage.base.bonus": "1 + @mod", "system.damage.base.custom.enabled": false }],
  [`${PHB}.phbUnarmedStrike`, "Attaque à mains nues (Manuel, déjà juste)", { "system.damage.base.bonus": "1 + @mod" }],
  // §457: effect links copied from another item, empty damage part.
  [`${DMG}.dmgHorseshoesOfA`, "Fers du zéphyr", { "effect:AYtAkgcEHRws0Qeo:system.changes.0.key": "system.attributes.movement.ignoredDifficultTerrain", "system.activities.Bm8dAa2MyA5NhcPU.effects.0._id": "AYtAkgcEHRws0Qeo" }],
  [`${DMG}.dmgManualOfBodil`, "Manuel de vitalité", { "system.activities.L5OnUjZIn27NHd2E.effects.length": 0 }],
  [`${DMG}.dmgTomeOfClearTh`, "Traité de perspicacité", { "system.activities.OCFufJcLGbTJqDqS.effects.length": 0 }],
  [`${DMG}.dmgStaffOfThunde`, "Bâton de tonnerre et de foudre", { "system.activities.EtOETCHaEK0mcw03.damage.parts.length": 1 }]
];

const read = (item, path) => {
  const any = path.match(/^bonusEffects:(.*)$/);
  if ( any ) return any[1].split(",").filter(id => (item.effects ?? []).some(e => e._id === id)).length;
  const m = path.match(/^effect:([^:]+):(.*)$/);
  const at = (o, p) => p.split(".").reduce((x, k) => ((x === null) || (x === undefined)) ? undefined : x[k], o);
  if ( !m ) return at(item, path);
  const effect = (item.effects ?? []).find(e => e._id === m[1]);
  return effect ? at(effect, m[2]) : undefined;
};

export default {
  name: "repasse-o1 — donnée premium des objets corrigée à la création et par le diagnostic",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const entry = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = JSON.parse(JSON.stringify(data));
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      return itemData;
    };
    const actors = [];
    const backups = [];
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    const setting = await api("setting", { key: "dataFixes" });
    ctx.restore(() => api("setting", { key: "dataFixes", value: setting.before }));
    await api("setting", { key: "dataFixes", value: true });

    // 1. Creation: each item fixed by the active GM.
    const items = [];
    for ( const [uuid] of CHECKS ) items.push(await entry(uuid));
    const created = await ctx.call("create-actor", { actorData: {
      name: "Repasse O1", type: "character", flags: { [MODULE_ID]: { scenario: "repasse-o1" } }, items } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur de test créé avec les objets") ) return;
    let actor = null;
    // The items are fixed one after the other: wait until everything is written (each check holds), 20 s at most.
    const allHeld = a => CHECKS.every(([uuid, , expected]) => {
      const item = (a.items ?? []).find(it => it.flags?.dnd5e?.sourceId === uuid);
      return item && Object.entries(expected).every(([path, value]) => String(read(item, path)) === String(value));
    });
    for ( let i = 0; i < 40; i++ ) {
      await pause(500);
      actor = await ctx.call("get-actor", { actorId });
      if ( allHeld(actor) ) break;
    }
    for ( const [uuid, label, expected] of CHECKS ) {
      const item = (actor.items ?? []).find(it => it.flags?.dnd5e?.sourceId === uuid);
      if ( !ctx.expect(!!item, `${label} présent`) ) continue;
      for ( const [path, value] of Object.entries(expected) ) {
        const got = read(item, path);
        ctx.expect(got === value, `${label} : ${path} = ${JSON.stringify(got)} (attendu ${JSON.stringify(value)})`);
      }
    }

    // 3. Staff of Power: +2 to AC once equipped and attuned.
    const staff = (actor.items ?? []).find(it => it.flags?.dnd5e?.sourceId === `${DMG}.dmgStaffOfPower0`);
    const acOf = async () => (await ctx.call("get-actor", { actorId, prepared: true, preparedPaths: ["attributes.ac.value"] }).catch(() => null));
    const before = await acOf();
    await ctx.call("upsert-actor-item", { actorId, itemData: { _id: staff._id, "system.equipped": true, "system.attuned": true }, match: { path: "_id", value: staff._id } }).catch(() => null);
    await pause(800);
    const after = await acOf();
    const acOfPrepared = r => r?.prepared?.system?.["attributes.ac.value"] ?? r?.prepared?.["attributes.ac.value"] ?? undefined;
    const acBefore = acOfPrepared(before) ?? undefined;
    const acAfter = acOfPrepared(after) ?? undefined;
    if ( (acBefore === undefined) || (acAfter === undefined) || (acBefore === null) ) ctx.log(`CA préparée illisible par le connecteur (${JSON.stringify(after?.prepared ?? null)}) : étape sautée`);
    else ctx.expect(acAfter === acBefore + 2, `Bâton de surpuissance équipé et harmonisé : CA ${acBefore} → ${acAfter}`);

    // 2. Diagnostic: with the fix turned off, the Wand of Webs stays faulty on creation; the analysis finds it, the repair
    // fixes it.
    await api("setting", { key: "dataFixes", value: false });
    const second = await ctx.call("create-actor", { actorData: {
      name: "Repasse O1 (diagnostic)", type: "character", flags: { [MODULE_ID]: { scenario: "repasse-o1" } }, items: [await entry(`${DMG}.dmgWandOfWeb0000`)] } });
    const secondId = second.id ?? second.actorId ?? second.actor?._id;
    if ( secondId ) actors.push(secondId);
    await api("setting", { key: "dataFixes", value: true });
    if ( !ctx.expect(!!secondId, "second acteur créé, correction coupée") ) return;
    const root = `Actor.${secondId}`;
    const wandOf = async () => ((await ctx.call("get-actor", { actorId: secondId })).items ?? [])[0];
    ctx.expect(!(await wandOf())?.system?.activities?.P7PnWcum8exAm2EG?.consumption?.targets?.length, "correction coupée : la baguette reste sans consommation");
    const scan = await api("diagnosticScan", { checks: ["data-fixes"] });
    const mine = (scan["data-fixes"] ?? []).filter(t => t.root?.uuid === root);
    ctx.expect((mine.length === 1) && mine[0].fixable, `analyse : la baguette est trouvée (${mine.map(t => t.text).join(" | ") || "rien"})`);
    const repaired = await api("diagnosticRepair", { checks: ["data-fixes"], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect((repaired.results.length === 1) && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line).join(" | ") || "aucune"}`);
    ctx.expect((await wandOf())?.system?.activities?.P7PnWcum8exAm2EG?.consumption?.targets?.[0]?.type === "itemUses", "après réparation : 1 charge par lancer");
    const again = await api("diagnosticScan", { checks: ["data-fixes"] });
    ctx.expect(!(again["data-fixes"] ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien");
  }
};
