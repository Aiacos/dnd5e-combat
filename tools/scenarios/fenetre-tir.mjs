/**
 * §518 (Discord, SpitFire, 2026-11-22 : Restored Keep de Baileywiki) : tirer par une fenêtre. « Arène des refus » (`node tools/arene-refus.mjs`) :
 * le Mage (Trait de feu), le Mannequin à cinq cases à l'est, un mur « fenêtre » du cœur (déplacement et son pleins, vue et lumière
 * « proximité », seuil deux cases : `canvas/layers/walls.mjs:474`) nord-sud à une case devant le Mage.
 *  1. Mage près de la fenêtre : la cible est en vue (pas de refus « hors de vue »), aucun abri dû à la fenêtre ;
 *  2. le même mur choisi « mur plein » (une vitre fermée) : abri total ; remis « selon le réglage » ;
 *  3. Mage reculé de trois cases (au-delà du seuil) : hors de vue, abri total — comme la vision de Foundry ;
 *  4. de là, attaque forcée (fenêtre de légalité « hors de vue », « Utiliser quand même ») : la carte est marquée, l'abri total y vaut
 *     trois quarts (+5), le verdict n'est plus un échec d'office (« cover ») et, touché (CA du Mannequin ramenée à 1), les dégâts sont lancés.
 * Remet le Mage, le Mannequin (place, PV, CA), retire le mur.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "fenêtre — tirer par une fenêtre, attaque forcée malgré un abri total (§518)",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const ray = await ctx.ensureItem(mage, `${PHB}phbsplFireBolt00`);
    const g = await ctx.gridSize();
    const script = async code => (await ctx.call("run-script", { code }))?.result;
    const where = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data;
    const blink = (t, x, y) => script(`await canvas.scene.tokens.get("${t.id}").move([{ x: ${x}, y: ${y}, action: "blink" }],
      { "${MODULE_ID}": { cleared: true } }); return true;`);

    const home = await where(mage);
    const dHome = await where(dummy);
    const hp = await ctx.hp(dummy);
    ctx.restore(async () => {
      await blink(mage, home.x, home.y).catch(() => {});
      await blink(dummy, dHome.x, dHome.y).catch(() => {});
      await ctx.setHp(dummy, hp).catch(() => {});
    });
    // CA du Mannequin ramenée à 1 le temps de l'essai : l'attaque forcée touche (sauf 1 naturel), on voit ses dégâts.
    const ac = await script(`const a = canvas.scene.tokens.get("${dummy.id}").actor; const before = foundry.utils.deepClone(a._source.system.attributes.ac);
      await a.update({ "system.attributes.ac.calc": "flat", "system.attributes.ac.flat": 1 }); return before;`);
    ctx.restore(() => script(`await canvas.scene.tokens.get("${dummy.id}").actor.update({ "system.attributes.ac": ${JSON.stringify(ac ?? {})} }); return true;`).catch(() => {}));
    await blink(dummy, home.x + (5 * g), home.y);
    await pause(1000);

    // Un mur « fenêtre » du cœur, nord-sud, au bord est de la case devant le Mage (centre du Mage à 1,5 case : sous le seuil de 2 cases).
    const x = home.x + (2 * g);
    const distance = await script(`return canvas.dimensions.distance;`);
    const created = await ctx.call("create-walls", { walls: [{ c: [x, home.y - (3 * g), x, home.y + (4 * g)].map(Math.round),
      move: 20, sound: 20, sight: 30, light: 30, threshold: { sight: 2 * distance, light: 2 * distance, attenuation: true } }] });
    const wallId = (created?.walls ?? []).map(w => w.id ?? w._id).find(Boolean);
    if ( !wallId ) throw new Error(`mur non créé (${JSON.stringify(created).slice(0, 200)})`);
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Wall", objectId: wallId }).catch(() => {}));
    await pause(800);
    const wall = await script(`const w = canvas.scene.walls.get("${wallId}"); return { sight: w.sight, move: w.move, threshold: w.threshold?.sight };`);
    if ( !ctx.expect(wall?.sight === 30 && wall?.move === 20 && wall?.threshold > 0, `mur fenêtre posé (${JSON.stringify(wall)})`) ) return;

    const cover = () => ctx.engine("cover", { attackerId: mage.id, targetId: dummy.id });
    const blind = () => script(`const { rangeStatus } = await import("/modules/${MODULE_ID}/scripts/runtime/actions.mjs");
      const token = canvas.scene.tokens.get("${mage.id}"); const target = canvas.scene.tokens.get("${dummy.id}");
      const activity = token.actor.items.get("${ray}").system.activities.find(a => a.type === "attack");
      return rangeStatus(token, target, activity)?.blind ?? null;`);

    // 1. Près de la fenêtre.
    ctx.expect((await blind()) === false, "près de la fenêtre : le Mannequin est en vue (pas de refus « hors de vue »)");
    const near = await cover();
    ctx.expect(!near || near.degree === "none", `près de la fenêtre : aucun abri dû à la fenêtre (${near?.degree ?? "aucun"})`);

    // 2. Le même mur choisi « mur plein » (une vitre fermée).
    const mode = value => ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data: { "flags.dnd5e-combat.grateMode": value } }).then(() => pause(600));
    await mode("solid");
    const glass = await cover();
    ctx.expect(glass?.degree === "total", `mur choisi « mur plein » : abri total (${glass?.degree ?? "aucun"})`);
    await mode("auto");

    // 3. Trois cases en arrière : la fenêtre est à 4,5 cases du centre du Mage, au-delà du seuil.
    await blink(mage, home.x - (3 * g), home.y);
    await pause(1000);
    ctx.expect((await blind()) === true, "loin de la fenêtre : hors de vue (comme la vision de Foundry)");
    const far = await cover();
    ctx.expect(far?.degree === "total", `loin de la fenêtre : abri total (${far?.degree ?? "aucun"})`);

    // 4. L'attaque forcée : « Utiliser quand même » dans la fenêtre de légalité, puis le verdict.
    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${mage.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => { const d = await legality(300); if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {}); });
    const since = await ctx.lastMessageId();
    await script(`const { engage } = await import("/modules/${MODULE_ID}/scripts/runtime/actions.mjs");
      const token = canvas.scene.tokens.get("${mage.id}"); const target = canvas.scene.tokens.get("${dummy.id}");
      const activity = token.actor.items.get("${ray}").system.activities.find(a => a.type === "attack");
      engage(token, target, activity, { fast: true }); return true;`);
    const d = await legality();
    const text = [d?.title, d?.content, d?.text].filter(Boolean).join(" ");
    ctx.expect(!!d && /sight|vue/i.test(text), `attaque hors de vue : la fenêtre de légalité le dit (${text.slice(0, 160)})`);
    if ( !d ) return;
    await ctx.call("answer-dialog", { id: d.id, button: "go" });
    let usage = null;
    for ( let i = 0; (i < 20) && !usage; i++ ) {
      await pause(500);
      usage = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.forcedThrough);
    }
    if ( !ctx.expect(!!usage, "forcée : la carte d'utilisation part, marquée « passée outre »") ) return;
    const r = await ctx.settle(usage.id);
    const t = r.targets?.[0];
    const attack = (await ctx.messagesSince(usage.id)).find(m => m.type === "attack");
    const rolledAc = attack?.targets?.[0]?.ac ?? null;
    ctx.log(`forcée : CA du jet ${rolledAc}, CA du verdict ${t?.ac}, abri ${t?.cover?.degree ?? "aucun"}, ${t?.reason}, jet ${r.attack?.roll?.total}`);
    ctx.expect(t?.cover?.degree === "threeQuarters", `forcée : l'abri total vaut trois quarts (${t?.cover?.degree ?? "aucun"})`);
    ctx.expect((t?.ac !== null) && (t?.reason !== "cover"), `forcée : pas d'échec d'office (${t?.reason}, CA ${t?.ac})`);
    if ( Number.isFinite(rolledAc) ) ctx.expect(t.ac === rolledAc + 5, `forcée : CA corrigée +5 (${rolledAc} → ${t.ac})`);
    if ( t?.hit ) {
      const damage = (await ctx.messagesSince(usage.id)).find(m => m.type === "damage");
      ctx.expect(!!damage, "forcée et touchée : les dégâts sont lancés");
    } else ctx.log(`forcée, ratée au dé (${r.attack?.roll?.total} contre ${t?.ac}) : les dégâts ne se vérifient pas cette fois`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
