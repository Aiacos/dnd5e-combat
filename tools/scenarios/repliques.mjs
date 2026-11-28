/**
 * Mirror Image (SPEC §16.25): the spell places three duplicates on the caster, with no target; an attack that hits it makes
 * it roll 1d6 per duplicate — a 3 or more: the duplicate takes the blow (miss, HP intact, one duplicate fewer); otherwise the
 * blow lands. A miss against AC rolls nothing.
 * World `dnd-6`: the Wizard receives the spell from the compendium, the Zombie attacks. World `ravenloft`: Kaalisti (who knows it),
 * attacked by Rahadin with a saber.
 */
const SPELL = "Compendium.dnd5e.spells24.Item.phbsplMirrorImag";
const CASTERS = ["Kaalisti", "Magicien"];
const ATTACKERS = [{ name: "Rahadin, chambellan du château", identifier: "saber" }, { name: "Zombi", identifier: null }];

export default {
  name: "répliques — Image miroir",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const casterName = CASTERS.find(n => tokens.some(t => t.name === n));
    const attackerRule = ATTACKERS.find(a => tokens.some(t => t.name === a.name));
    if ( !casterName || !attackerRule ) { ctx.log("ni lanceur ni attaquant connus sur la scène : non applicable"); return; }
    const caster = await ctx.token(casterName);
    const attacker = await ctx.token(attackerRule.name);
    await ctx.ensureItem(caster, SPELL);

    // The attacker in contact with the caster, to the east (the safety net puts it back in place).
    const grid = await ctx.gridSize();
    const at = await ctx.position(caster);
    await ctx.call("move-token", { tokenId: attacker.id, x: at.x + grid, y: at.y });

    const before = new Set((await ctx.effects(caster)).map(e => e._id));
    const cast = await ctx.use({ tokenId: caster.id, identifier: "mirror-image" });
    ctx.expect(cast.used, "Image miroir lancée");
    await ctx.settle(cast.usageMessageId).catch(() => null);
    // Mirror Image's effects only: a hit that lands can add "Bloodied" (dnd5e, `bloodied`), which is not one of them
    // (seen in `dnd-6` on 2026-09-26: "duplicates intact (4)").
    const duplicates = () => ctx.effects(caster).then(list => list.filter(e => !before.has(e._id) && !(e.statuses ?? []).length));
    let count = (await duplicates()).length;
    ctx.expect(count === 3, `trois répliques posées sur ${casterName}, sans cible (${count})`);

    const items = (await ctx.call("get-actor", { actorId: attacker.actorId })).items ?? [];
    const weapon = items.find(i => (i.system?.identifier === attackerRule.identifier))
      ?? items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    ctx.expect(!!weapon, `${attackerRule.name} a une attaque (${weapon?.name})`);
    if ( !weapon ) return;
    let taken = 0, kept = 0;
    for ( let n = 1; (n <= 20) && (count > 0) && !(taken && kept); n++ ) {
      const hp = await ctx.hp(caster);
      const used = await ctx.use({ tokenId: attacker.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [caster.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets[0];
      const { total, isCritical, isFumble } = r.attack.roll;
      const beatsAc = isCritical || (!isFumble && (total >= t.ac));
      const now = (await duplicates()).length;
      if ( !beatsAc ) {
        ctx.expect(!t.duplicate && (now === count), `attaque ${n} : ${total} contre CA ${t.ac}, ratée — aucun dé de réplique`);
      } else if ( t.duplicate?.taken ) {
        taken++;
        ctx.expect(t.duplicate.dice.length === count, `attaque ${n} : ${count} d6 lancés (${t.duplicate.dice.join(", ")})`);
        ctx.expect(!t.hit && (r.step === "missed"), `attaque ${n} : une réplique prend le coup, ${casterName} est raté`);
        ctx.expect(now === count - 1, `attaque ${n} : une réplique de moins (${count} → ${now})`);
        ctx.expect((await ctx.hp(caster)) === hp, `attaque ${n} : PV intacts`);
      } else {
        kept++;
        ctx.expect(!!t.duplicate && t.duplicate.dice.every(d => d < 3), `attaque ${n} : dés ${t.duplicate?.dice?.join(", ")} sous 3, le coup porte`);
        ctx.expect(t.hit && (now === count), `attaque ${n} : ${casterName} touché, répliques intactes (${now})`);
      }
      count = now;
    }
    ctx.expect(taken > 0, "au moins une réplique a pris un coup");
    if ( !kept ) ctx.log("aucun coup porté malgré les répliques (tirage) : branche non exercée");
  }
};
