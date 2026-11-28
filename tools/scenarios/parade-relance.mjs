/**
 * §489: the forced reroll of an attack roll (`reroll` step, a monster's Parry). A synthetic item lent to the Wizard, its rule
 * placed in the world overlay (`api.mcp.overrideContent`):
 *   { on: "isHit", if: { "hit.critical": false }, do: [{ type: "use" }, { type: "reroll" }] }
 *   { on: "isMissed", free: true, if: { "attack.rerolled": true, "attack.fumble": true },
 *     do: [{ type: "use", activity: <riposte>, target: "source", free: true }] }
 * The Zombie hits the Wizard in contact until it hits (Reaction taken automatically, `autoReact: "first"`):
 *  1. a "reroll" card (`flags["dnd5e-combat"].forcedReroll`) in the Zombie's name, after the original roll, the old total noted;
 *  2. the resolution notes the rerolled roll on the target (`rerolled`) and rejudges with it: hit if and only if the new total
 *     reaches the AC (apart from Critical Hit / critical miss), "Parry" Reaction;
 *  3. a first critical roll does not open the window (no card); a natural 1 on the new roll sets off the riposte (use card
 *     of the Wizard's "Riposte" activity) — checked only if the dice give them.
 * Restores HP, position, lent item and overlay.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDENTIFIER = "essai-parade-relance-das";
const PARRY = "essaiParadeRel01";
const RIPOSTE = "essaiParadeRip01";
const RULE = { triggers: [
  { on: "isHit", if: { "hit.critical": false }, do: [{ type: "use", activity: PARRY }, { type: "reroll" }] },
  { on: "isMissed", free: true, if: { "attack.rerolled": true, "attack.fumble": true },
    do: [{ type: "use", activity: RIPOSTE, target: "source", free: true }] }] };

export default {
  name: "parade-relance — Parade d'un monstre : l'attaquant relance son jet, le coup est rejugé (§489)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Magicien", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const mageHp = await ctx.hp(mage);
    const grid = await ctx.gridSize();
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    ctx.restore(() => ctx.setHp(mage, mageHp));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));

    // --- Item and rule lent -------------------------------------------------------------------------------------------
    const activity = (id, name) => ({ _id: id, type: "utility", name, activation: { type: "reaction", value: 1 },
      target: { affects: { type: "self" } } });
    const itemData = { name: "Essai : parade", type: "feat", img: "icons/svg/shield.svg",
      system: { identifier: IDENTIFIER, activities: { [PARRY]: activity(PARRY, "Parade"), [RIPOSTE]: activity(RIPOSTE, "Riposte") } } };
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));

    // The Zombie in contact with the Wizard (to the left).
    await ctx.call("move-token", { tokenId: zombi.id, x: magePos.x - grid, y: magePos.y, elevation: zHome.elevation });
    await pause(800);
    const items = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque au corps à corps (${weapon?.name})`) ) return;

    // --- The Zombie strikes until a Parry (20 attempts at most) ----------------------------------------------------------
    let parried = null;
    let critSeen = false;
    let fumbleSeen = false;
    for ( let i = 0; (i < 20) && !(parried && (fumbleSeen || (i >= 8))); i++ ) {
      await ctx.setHp(mage, mageHp);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [mage.id],
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const messages = await ctx.messagesSince(since);
      const card = messages.find(m => m.flags?.[MODULE_ID]?.forcedReroll);
      const target = r?.targets?.find(t => t.name === "Magicien");
      if ( !target ) continue;
      // 3a. A first critical roll: "no effect if the first attack was a Critical Hit" — the window does not open.
      if ( target.critical && !target.rerolled ) {
        critSeen = true;
        ctx.expect(!card, "premier jet critique : pas de relance");
        continue;
      }
      if ( !card ) continue;   // missed outright: no window
      const flag = card.flags[MODULE_ID].forcedReroll;
      parried ??= { r, target, flag };
      // 3b. A natural 1 on the new roll: the free riposte goes off (use card of the "Riposte" activity).
      if ( flag.fumble ) {
        fumbleSeen = true;
        const riposte = messages.find(m => (m.type === "usage") && String(m.system?.activity?.uuid ?? m.flags?.dnd5e?.activity?.uuid ?? "").endsWith(RIPOSTE));
        ctx.expect(!!riposte, `nouveau jet à 1 naturel : la riposte part (${riposte ? "carte présente" : "absente"})`);
      }
    }
    if ( !ctx.expect(!!parried, "le Zombi touche le Magicien et la Parade force une relance (20 essais au plus)") ) return;

    // --- 1 and 2. The card, then the rejudging -----------------------------------------------------------------------
    const { r, target, flag } = parried;
    ctx.expect(flag.from === r.attack?.roll?.total, `la carte note l'ancien total (${flag.from} ; jet d'origine ${r.attack?.roll?.total})`);
    ctx.expect(target.rerolled?.total === flag.total, `la résolution porte le jet relancé (${target.rerolled?.total} ; carte ${flag.total})`);
    ctx.expect(target.reaction === "Essai : parade" || /Parade/.test(String(target.reaction)), `réaction notée (${target.reaction})`);
    const expected = target.rerolled.isFumble ? false : (target.rerolled.isCritical ? true : (target.rerolled.total >= target.ac));
    ctx.expect(target.hit === expected, `coup rejugé avec le nouveau jet : ${target.rerolled.total} contre CA ${target.ac} → ${target.hit ? "touché" : "raté"}`);
    if ( !critSeen ) ctx.log("aucun premier jet critique dans ces essais : l'exclusion « coup critique » n'a pas été jouée (tests unitaires)");
    if ( !fumbleSeen ) ctx.log("aucun 1 naturel au nouveau jet : la riposte n'a pas été jouée (tests unitaires)");
  }
};
