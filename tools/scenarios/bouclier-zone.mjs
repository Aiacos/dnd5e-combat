/**
 * §493 (B13) — Reaction against an area: the creature caught in a Cone or a Line imposes a saving throw on the caster; on a
 * failure, it alone avoids the damage. Synthetic example lent to the Zombie, its rule placed in the world overlay
 * (`overrideContent`; no item flag):
 *   { on: "inArea", if: { "activity.isSpell": true, "activity.areaShape": ["cone", "line"] },
 *     do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: true }] }
 * The item: a Reaction saving-throw activity, DC 17, Intelligence, Wisdom or Charisma at the caster's choice.
 *  1. The Sorcerer casts Burning Hands (Cone), area placed on the Zombie, `autoReact: "first"`: the Reaction goes off, the
 *     Sorcerer's saving throw decides — failed: card "spared", Zombie HP unchanged; succeeded: card "the damage goes through",
 *     HP down by the applied amount. We replay until both outcomes have been seen (12 tries at most).
 *  2. Fireball (Sphere) on the Zombie: no Reaction, the damage goes through.
 * The setting "Saving throw with several abilities of an NPC" is set to "the best" for the length of the scenario (no window on the
 * GM's side), the NPC Mage hidden (its Counterspell would react). Conditions left on the Zombie and the Sorcerer removed first; HP,
 * items, setting, overlay reset.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-bouclier-zone";
const ACTIVITY = "dasEssaiBoucZone";
// Names as constants: the test bench and the reference take the first indented "name:" (two spaces) as the scenario's title.
const ITEM_NAME = "Essai : bouclier de zone";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/creatures/invertebrates/fly-wasp-mosquito-green.webp",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "save",
    activation: { type: "reaction", value: 1 }, range: { units: "any", override: true }, target: { affects: { type: "creature", count: "1" } },
    save: { ability: ["int", "wis", "cha"], dc: { calculation: "", formula: "17" } } } } } };
const RULE = { triggers: [{ on: "inArea", if: { "activity.isSpell": true, "activity.areaShape": ["cone", "line"] },
  do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: true }] }] };

export default {
  name: "bouclier-zone — réaction contre un cône : la sauvegarde ratée du lanceur épargne la créature seule (§493, brique B13)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Ensorceleur", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");

    // Conditions left over from a previous scenario (Prone, Unconscious…): removed first, on the token's actor.
    for ( const t of [sorc, zombi] ) for ( const s of ["dead", "unconscious", "prone", "incapacitated", "stunned", "paralyzed"] ) {
      await ctx.removeStatusEffects(t, s).catch(() => {});
    }
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    // No one else reacts: the NPC Mage hidden for the length of the scenario.
    for ( const other of tokens.filter(t => (t.name === "Mage") && !t.hidden) ) {
      await ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: false } }).catch(() => {}));
    }

    // Several abilities to choose from: the best, without a window on the GM's side.
    const choice0 = await ctx.call("get-setting", { namespace: MODULE_ID, key: "npcSaveChoice" }).then(r => r?.value ?? r).catch(() => "ask");
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "npcSaveChoice", value: "best" });
    ctx.restore(() => ctx.call("set-setting", { namespace: MODULE_ID, key: "npcSaveChoice", value: (typeof choice0 === "string") ? choice0 : "ask" }).catch(() => {}));

    // --- Lent item and rule ----------------------------------------------------------------------------------------
    const { data: zTok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    await ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(zombi.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: zTok.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await ctx.ensureItem(sorc, `${SRD}phbsplFireball00`, { system: { method: "atwill" } });
    // Enough level 1 slots to replay Burning Hands, returned at the end.
    const { data: sTok } = await ctx.call("get-scene-object", { type: "Token", objectId: sorc.id });
    const slots = (await ctx.call("get-actor", { actorId: sTok.actorId })).system?.spells?.spell1 ?? {};
    await ctx.call("update-actor", { actorId: sTok.actorId, actorData: { "system.spells.spell1.override": 20, "system.spells.spell1.value": 20 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: sTok.actorId, actorData: {
      "system.spells.spell1.override": slots.override ?? null, "system.spells.spell1.value": slots.value ?? 0 } }).catch(() => {}));

    /** An area spell placed on the Zombie (100 HP); returns the resolution, the "shield" card if any and the HP afterwards. */
    const strike = async (identifier) => {
      await ctx.setHp(zombi, 100);
      await pause(400);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: sorc.id, identifier, activityType: "save", area: { shape: "rectangle", ...(await ctx.box(zombi)) },
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 90000 }).catch(() => null);
      await pause(1000);
      const shield = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.areaShield ?? m.flags?.areaShield).find(Boolean) ?? null;
      const target = r?.targets?.find(t => t.name === "Zombi") ?? null;
      return { r, shield, target, hp: await ctx.hp(zombi) };
    };

    // 1. Burning Hands (Cone) until both outcomes of the caster's saving throw have been seen.
    const seen = { spared: null, hurt: null };
    for ( let i = 0; (i < 12) && (!seen.spared || !seen.hurt); i++ ) {
      const s = await strike("burning-hands");
      if ( !s.r ) { ctx.log(`essai ${i + 1} : résolution non tranchée`); continue; }
      if ( !s.shield ) { ctx.expect(false, `essai ${i + 1} : la réaction du Zombi part contre le cône (aucune carte « bouclier »)`); break; }
      const key = s.shield.spared ? "spared" : "hurt";
      if ( !seen[key] ) seen[key] = s;
    }
    if ( ctx.expect(!!seen.spared, "l'Ensorceleur rate au moins une sauvegarde (DD 17, 12 essais au plus)") ) {
      const { shield, hp, target } = seen.spared;
      ctx.expect(shield.ifSourceFails === true && shield.save?.success === false, `sauvegarde du lanceur ratée (${shield.save?.total ?? "?"}) : carte « épargné »`);
      ctx.expect(hp === 100, `épargné : PV du Zombi inchangés (100 → ${hp})`);
      ctx.expect(!target?.damage?.applied, `épargné : aucun dégât appliqué par la résolution (${target?.damage?.applied ?? 0})`);
    }
    if ( ctx.expect(!!seen.hurt, "l'Ensorceleur réussit au moins une sauvegarde (12 essais au plus)") ) {
      const { shield, hp, target } = seen.hurt;
      ctx.expect(shield.save?.success === true, `sauvegarde du lanceur réussie (${shield.save?.total ?? "?"}) : carte « les dégâts passent »`);
      ctx.expect((hp < 100) && ((100 - hp) === target?.damage?.applied), `dégâts appliqués : 100 → ${hp} (${target?.damage?.applied ?? "?"})`);
    }

    // 2. Fireball (Sphere): the "Cone or Line" condition does not hold, no Reaction.
    const sphere = await strike("fireball");
    ctx.expect(!!sphere.r, "Boule de feu : résolution tranchée");
    ctx.expect(!sphere.shield, "Boule de feu (sphère) : aucune réaction du Zombi");
    ctx.expect(sphere.hp < 100, `Boule de feu : les dégâts passent (100 → ${sphere.hp})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
