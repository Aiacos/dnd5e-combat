/**
 * §503 (B23) — after an ability, "no other spell this turn, except a one-action cantrip": `afterUse: { onlyCantrips: { castTime:
 * "action" } }`. Test Arena: Sorcerer (Fire Bolt on his sheet, Bless lent at will), Zombie, in a scenario combat
 * (the Sorcerer plays first). A test trait (utility activity, Bonus Action) is lent to the Sorcerer; its rule is in the world
 * overlay (`overrideContent`, never as an item flag). Nothing is cast: legality is read through `api.mcp.issues`.
 *  1. Before the trait: Bless does not have this refusal.
 *  2. The trait used (his turn): Bless is refused ("except a cantrip"), Fire Bolt (one-action cantrip) is not.
 * Trait, lent spell, overlay, combat put back. No window expected (any "do it anyway" window is closed).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-sorts-mineurs-seuls";
const ACTIVITY = "dasEssaiMineurs0";
// Name as a constant: the bench and the reference take the first "name:" indented by two spaces as the scenario's title.
const ITEM_NAME = "Essai : vitesse qui ferme les sorts";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/magic/nature/snake-tail-green.webp",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §503.</p>" },
    activities: { [ACTIVITY]: { _id: ACTIVITY, type: "utility", activation: { type: "bonus", value: 1 }, range: { units: "self" },
      target: { affects: { type: "self" } } } } } };
const RULE = { afterUse: { onlyCantrips: { castTime: "action" } } };
const REFUSED = /cantrip|sort mineur|truque|trucchetto/i;

export default {
  name: "sorts-mineurs-seuls — après une capacité, plus de sort ce tour sauf un sort mineur d'une action : Bénédiction refusée, Trait de feu permis (§503, brique B23)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Ensorceleur", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombie = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: sorc.id });
    if ( !tok.actorLink ) { ctx.log("Ensorceleur non lié : non applicable (le trait prêté irait à l'acteur de base)"); return; }

    const fireBolt = await ctx.itemId(sorc.id, "fire-bolt").catch(() => null);
    if ( !ctx.expect(!!fireBolt, `Trait de feu sur la fiche de l'Ensorceleur (${fireBolt})`) ) return;
    const bless = await ctx.ensureItem(sorc, PHB + "phbsplBless00000", { system: { method: "atwill" } });
    await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(sorc.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));

    await ctx.startCombat([sorc, zombie]);
    await pause(1200);
    const issues = (itemId, activityType) => ctx.engine("issues", { tokenId: sorc.id, itemId, activityType });

    const blessBefore = await issues(bless);
    ctx.expect(!blessBefore.some(l => REFUSED.test(l)), `avant le trait, Bénédiction n'est pas limitée (${blessBefore.join(" ; ") || "aucun souci"})`);

    const used = await ctx.use({ tokenId: sorc.id, itemId: lent, activityType: "utility", consume: false });
    ctx.expect(!!used?.used, "trait utilisé (action Bonus)");
    await pause(1800);
    const budget = await ctx.engine("budget", { tokenId: sorc.id });
    ctx.expect(budget?.onlyCantrips?.castTime === "action", `restriction posée pour le tour (${JSON.stringify(budget?.onlyCantrips)})`);

    const blessAfter = await issues(bless);
    ctx.expect(blessAfter.some(l => REFUSED.test(l)), `Bénédiction refusée : ${blessAfter.join(" ; ") || "aucun souci"}`);
    const boltAfter = await issues(fireBolt, "attack");
    ctx.expect(!boltAfter.some(l => REFUSED.test(l)), `Trait de feu permis (${boltAfter.join(" ; ") || "aucun souci"})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
