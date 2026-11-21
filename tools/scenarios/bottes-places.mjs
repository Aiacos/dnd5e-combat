/**
 * §222, retour Discord (2026-11-19) : le nombre de places de bottes d'arme. Depuis dnd5e 6.1 et le PHB 3.0, les paliers ne sont plus
 * sur la classe mais sur l'aptitude « Weapon Mastery » (objet `feat`, identifiant `weapon-mastery`) que la classe donne ; dnd5e
 * relie l'aptitude à sa classe par `flags.dnd5e.advancementRoot` (`system.advancementRootItem`). Acteurs créés d'un bloc, sans
 * compendium, avec la même forme que les données du PHB 3.0 :
 *  - Guerrier 1 → 3 places (et non 6), une seule botte changée au Repos long, étiquette de la classe ; Guerrier 4 → 4 ;
 *  - Barbare 1 → 2 places, corps à corps seulement ;
 *  - un don Maître d'armes rattaché à la classe (palier de don) reste compté en entier, sans la règle du Guerrier ;
 *  - une aptitude sans classe d'origine ne plante pas et compte tous ses paliers ;
 *  - §510 (Discord, Fanarie) : fenêtre des bottes du Guerrier 4 après un Repos long (une botte à changer) — la ligne verte l'annonce ;
 *    une botte remplacée dans la sélection, la ligne disparaît (le changement permis est déjà pris).
 * Acteurs retirés.
 */
const MODULE_ID = "dnd5e-combat";

const trait = (id, level, count) => ({ _id: id, type: "Trait", level,
  configuration: { mode: "mastery", grants: [], choices: [{ count, pool: ["weapon:sim:*", "weapon:mar:*"] }] } });
const classItem = (id, name, identifier, levels) => ({ _id: id, name, type: "class", system: { identifier, levels } });
const feature = (id, name, identifier, root, advancements, kind="class") => ({ _id: id, name, type: "feat",
  flags: root ? { dnd5e: { advancementOrigin: `${root}.grantGrantGrant0`, advancementRoot: `${root}.grantGrantGrant0` } } : {},
  system: { identifier, type: { value: kind }, advancement: Object.fromEntries(advancements.map(a => [a._id, a])) } });

const FIGHTER_TRAITS = [trait("mastFtr1Lvl01aaa", 1, 3), trait("mastFtr4Lvl04aaa", 4, 1), trait("mastFtr10Lvl10aa", 10, 1),
  trait("mastFtr16Lvl16aa", 16, 1)];
const BARBARIAN_TRAITS = [trait("mastBrb1Lvl01aaa", 1, 2), trait("mastBrb4Lvl04aaa", 4, 1), trait("mastBrb10Lvl10aa", 10, 1)];

export default {
  name: "bottes — places selon la classe d'origine de l'aptitude (dnd5e 6.1, PHB 3.0)",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 60000 });
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { actors }));
    const create = async (name, items) => {
      const created = await ctx.call("create-actor", { actorData: { name, type: "character",
        flags: { [MODULE_ID]: { scenario: "bottes-places" } }, items } });
      const actorId = created.id ?? created.actorId ?? created.actor?._id;
      if ( actorId ) actors.push(actorId);
      return actorId;
    };
    const masteries = actorId => api("masteries", { actorId });

    // Guerrier niveau 1 : la classe sans palier, l'aptitude qu'elle donne avec ses quatre paliers.
    const fighter = await create("Bottes (Guerrier)", [classItem("bottesFighter001", "Fighter", "fighter", 1),
      feature("bottesFtrMastery", "Weapon Mastery", "weapon-mastery", "bottesFighter001", FIGHTER_TRAITS)]);
    if ( !ctx.expect(!!fighter, "Guerrier créé") ) return;
    let m = await masteries(fighter);
    ctx.expect(m.slots === 3, `Guerrier 1 : 3 places (vu ${m.slots})`);
    ctx.expect(m.sources[0]?.changes === 1, `Guerrier : une seule botte changée au Repos long (vu ${m.sources[0]?.changes})`);
    ctx.expect(m.sources[0]?.label === "Fighter 1", `étiquette de la classe (vu « ${m.sources[0]?.label} »)`);
    await ctx.call("upsert-actor-item", { actorId: fighter, itemData: { "system.levels": 4 }, match: { path: "_id", value: "bottesFighter001" } });
    m = await masteries(fighter);
    ctx.expect(m.slots === 4, `Guerrier 4 : 4 places (vu ${m.slots})`);

    // §510 : la ligne verte du Repos long décompte le changement en cours.
    const chosen = ["greatsword", "flail", "javelin", "longsword"];
    await ctx.call("update-actor", { actorId: fighter, actorData: { "system.traits.weaponProf.mastery.value": chosen,
      [`flags.${MODULE_ID}.masteryRest`]: { allowance: 1 } } });
    m = await masteries(fighter);
    ctx.expect((m.allowance === 1) && (m.chosen.length === 4), `Guerrier 4 : 4 bottes choisies, une à changer (vu ${m.chosen.length}, ${m.allowance})`);
    const before = await api("masteryWindow", { actorId: fighter });
    ctx.expect(/1/.test(before.rest ?? ""), `fenêtre : la ligne verte annonce une botte à changer (« ${before.rest} »)`);
    const after = await api("masteryWindow", { actorId: fighter, keys: ["greatsword", "flail", "javelin", "shortsword"] });
    ctx.expect(after.rest === null, `fenêtre : une botte remplacée, plus de ligne verte (« ${after.rest} »)`);

    // Barbare niveau 1.
    const barbarian = await create("Bottes (Barbare)", [classItem("bottesBarbarian1", "Barbarian", "barbarian", 1),
      feature("bottesBrbMastery", "Weapon Mastery", "weapon-mastery", "bottesBarbarian1", BARBARIAN_TRAITS)]);
    if ( !ctx.expect(!!barbarian, "Barbare créé") ) return;
    m = await masteries(barbarian);
    ctx.expect(m.slots === 2, `Barbare 1 : 2 places (vu ${m.slots})`);
    ctx.expect(m.sources[0]?.melee === true, "Barbare : corps à corps seulement");

    // Un don (type « feat ») rattaché à la classe par un palier : dnd5e ne le lie pas à la classe, il compte en entier.
    const feat = await create("Bottes (don)", [classItem("bottesFighter002", "Fighter", "fighter", 4),
      feature("bottesWpnMaster1", "Weapon Master", "weapon-master", "bottesFighter002", [trait("mastFeatLvl0aaaa", 0, 1)], "feat")]);
    if ( !ctx.expect(!!feat, "acteur au don créé") ) return;
    m = await masteries(feat);
    ctx.expect(m.slots === 1, `don Maître d'armes : 1 place (vu ${m.slots})`);
    ctx.expect(m.sources[0]?.changes === 1 && m.sources[0]?.label === "Weapon Master",
      `don : son propre nom, sans la règle du Guerrier (vu « ${m.sources[0]?.label} », ${m.sources[0]?.changes})`);

    // Une aptitude sans classe d'origine (ajoutée à la main) : pas d'erreur, tous les paliers comptés.
    const loose = await create("Bottes (sans origine)", [feature("bottesLooseMast1", "Weapon Mastery", "weapon-mastery", null, FIGHTER_TRAITS)]);
    if ( !ctx.expect(!!loose, "acteur sans origine créé") ) return;
    m = await masteries(loose);
    ctx.expect(m.slots === 6, `aptitude sans origine : tous les paliers (vu ${m.slots})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
