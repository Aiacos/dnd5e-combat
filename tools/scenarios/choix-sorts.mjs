/**
 * §401: the choices that a spell's text leaves to the caster, given to the caster (here the Caster, an NPC: the question opens on
 * the GM's side) in the "Spell Arena". `PART=<mot>` only plays the parts whose name contains it.
 *  - Word of Radiance ("each creature of your choice"): the Ally and the Enemy in contact within the Emanation — the question
 *    opens (mixed area); ticking the Ally makes it save, the default answer only takes the Enemy; setting "never": no question.
 *  - Thorn Whip ("up to 3 m"): the distance asked; 1.50 m → one cell.
 *  - Enhance Ability at level 3 (two targets, "a different ability for each target"): two questions.
 *  - Power Word Fortify ("120 Temporary Hit Points that you divide"): the split asked, 100 / 20.
 *  - Power Word Heal on a Prone target: "stand up using its Reaction" asked, yes → no longer Prone.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.PART ?? "").toLowerCase();
const wanted = name => !only || name.toLowerCase().includes(only);

/** Launches `use` and answers the windows that open on the GM's side meanwhile (`answer(dialog)` → answer-dialog parameters, or null). */
async function usingWith(ctx, use, answer) {
  const seen = [];
  const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
  let done = false;
  const using = use().catch(err => ({ used: false, reason: err.message })).finally(() => { done = true; });
  for ( let after = 0; after < 3; ) {
    const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500, details: true }).catch(() => null);
    for ( const d of r?.windows ?? [] ) {
      known.add(d.id);
      seen.push(d);
      const params = answer(d);
      if ( params ) await ctx.call("answer-dialog", { id: d.id, ...params }).catch(() => {});
    }
    if ( done ) after++;
  }
  return { used: await using, seen };
}

/** Temporary HP of a token (delta of an unlinked token, otherwise the sheet). */
async function tempHp(ctx, token) {
  const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
  const own = data.actorLink ? null : (data.delta?.system?.attributes?.hp?.temp ?? null);
  if ( own !== null ) return Number(own) || 0;
  const actor = await ctx.call("get-actor", { actorId: data.actorId ?? token.actorId });
  return Number(actor.system?.attributes?.hp?.temp ?? actor.actor?.system?.attributes?.hp?.temp) || 0;
}
async function setTempHp(ctx, token, value) {
  const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
  if ( data.actorLink ) await ctx.call("update-actor", { actorId: token.actorId, actorData: { "system.attributes.hp.temp": value } });
  else await ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { "delta.system.attributes.hp.temp": value } });
}

/** The checkbox fields of an area choice window, with the creature's name read from the row's label. */
const pickFields = d => (d.fields ?? []).filter(f => /^pick\d+$/.test(f.name ?? ""));

export default {
  name: "choix laissés au lanceur par le texte des sorts (§401)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const ally = await ctx.token("Allié");
    const foe = await ctx.token("Ennemi au contact");
    const target = await ctx.token("Cible");
    const hero = await ctx.token("Héros");
    const grid = await ctx.gridSize();
    const centre = async tok => { const p = await ctx.position(tok); return { x: p.x + grid / 2, y: p.y + grid / 2 }; };
    const before = await ctx.engine("setting", { key: "zoneChoice", value: "mixed" });
    ctx.restore(() => ctx.engine("setting", { key: "zoneChoice", value: before?.before ?? "never" }));

    // ---- Parole radieuse ----
    if ( wanted("parole") ) {
      await ctx.ensureItem(caster, PHB("phbsplWordofRadi"));
      const cast = async () => {
        const at = await centre(caster);
        return ctx.use({ tokenId: caster.id, identifier: "word-of-radiance", activityType: "save", area: { shape: "circle", x: at.x, y: at.y, radius: grid } });
      };
      const names = async r => (r?.targets ?? []).map(t => t.name).sort();

      // 1. Tick the Ally: it is among the targets.
      const a = await usingWith(ctx, cast, d => {
        const fields = pickFields(d);
        if ( !fields.length ) return null;
        return { fields: Object.fromEntries(fields.map(f => [f.name, true])), button: "ok" };
      });
      const zoneAsked = a.seen.some(d => pickFields(d).length);
      ctx.expect(zoneAsked, `Parole radieuse : la question « créatures de votre choix » s'ouvre (fenêtres : ${a.seen.map(d => d.title).join(" | ") || "aucune"})`);
      if ( a.used?.usageMessageId ) {
        const r = await ctx.settle(a.used.usageMessageId);
        const got = await names(r);
        ctx.expect(got.includes("Allié") && got.includes("Ennemi au contact"), `Allié coché : il sauvegarde avec l'Ennemi (${got.join(", ")})`);
      } else ctx.expect(false, `Parole radieuse non lancée : ${a.used?.reason}`);

      // 2. Default answer: the Enemy alone.
      const b = await usingWith(ctx, cast, d => (pickFields(d).length ? { button: "ok" } : null));
      if ( b.used?.usageMessageId ) {
        const got = await names(await ctx.settle(b.used.usageMessageId));
        ctx.expect((got.length === 1) && (got[0] === "Ennemi au contact"), `réponse par défaut : l'Ennemi seul (${got.join(", ")})`);
      }

      // 3. Setting "never": no question, the Enemy alone.
      await ctx.engine("setting", { key: "zoneChoice", value: "never" });
      const c = await usingWith(ctx, cast, () => null);
      ctx.expect(!c.seen.some(d => pickFields(d).length), "réglage « jamais » : aucune question");
      if ( c.used?.usageMessageId ) {
        const got = await names(await ctx.settle(c.used.usageMessageId));
        ctx.expect((got.length === 1) && (got[0] === "Ennemi au contact"), `réglage « jamais » : l'Ennemi seul (${got.join(", ")})`);
      }
      await ctx.engine("setting", { key: "zoneChoice", value: "mixed" });
      await pause(1500);
    }

    // ---- Thorn Whip ----
    if ( wanted("fouet") ) {
      await ctx.ensureItem(caster, PHB("phbsplThornWhip0"));
      const home = await ctx.position(target);
      ctx.restore(() => ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      let checked = false;
      for ( let i = 0; (i < 20) && !checked; i++ ) {
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation });
        const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "thorn-whip", activityType: "attack", targetTokenIds: [target.id] }),
          d => { const b = (d.buttons ?? []).find(x => /^5\s/.test(x.label ?? "")); return b ? { button: b.action ?? b.label } : null; });
        const r = await ctx.settle(run.used.usageMessageId);
        const t = r.targets.find(x => x.name === "Cible");
        await pause(1500);
        if ( !t?.hit ) continue;
        const pos = await ctx.position(target);
        const moved = Math.round(Math.hypot(pos.x - home.x, pos.y - home.y) / grid);
        ctx.expect(run.seen.some(d => (d.buttons ?? []).some(x => /^5\s/.test(x.label ?? ""))), `Fouet épineux : la distance est demandée (${run.seen.map(d => d.title).join(" | ")})`);
        ctx.expect(moved === 1, `1,50 m choisi : la Cible est tirée d'une case (${moved})`);
        checked = true;
      }
      if ( !checked ) ctx.expect(false, "Fouet épineux : aucun toucher en 20 essais");
    }

    // ---- Enhance Ability, two targets ----
    if ( wanted("amelioration") ) {
      await ctx.ensureItem(caster, PHB("phbsplEnhanceAbi"));
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "enhance-ability", targetTokenIds: [ally.id, hero.id],
        usageConfig: { spell: { slot: "spell3" } } }), d => {
        const buttons = (d.buttons ?? []).filter(b => /^pick\d+$/.test(b.action ?? ""));
        if ( !buttons.length ) return null;
        // The Ally: the first; the Hero: the second.
        return { button: /Héros/.test(d.content ?? d.text ?? "") ? buttons[1].action : buttons[0].action };
      });
      const asked = run.seen.filter(d => (d.buttons ?? []).some(b => /^pick\d+$/.test(b.action ?? "")));
      ctx.expect(asked.length === 2, `Amélioration de caractéristique : une question par cible (${asked.length} : ${asked.map(d => d.title).join(" | ")})`);
      if ( run.used?.usageMessageId ) {
        await ctx.settle(run.used.usageMessageId).catch(() => null);
        await pause(1000);
        const enhanced = async tok => (await ctx.effects(tok)).map(e => e.name).filter(n => /^(Enhanced|Amélior)/i.test(n ?? ""));
        const onAlly = await enhanced(ally);
        const onHero = await enhanced(hero);
        ctx.expect((onAlly.length === 1) && (onHero.length === 1) && (onAlly[0] !== onHero[0]),
          `chaque cible a sa caractéristique (Allié : ${onAlly.join(", ")} ; Héros : ${onHero.join(", ")})`);
      }
    }

    // ---- Mot de pouvoir fortifiant ----
    if ( wanted("fortifiant") ) {
      await ctx.ensureItem(caster, PHB("phbsplPowerWordF"));
      const t0 = { ally: await tempHp(ctx, ally), hero: await tempHp(ctx, hero) };
      ctx.restore(async () => { await setTempHp(ctx, ally, t0.ally); await setTempHp(ctx, hero, t0.hero); });
      await setTempHp(ctx, ally, 0);
      await setTempHp(ctx, hero, 0);
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "power-word-fortify", targetTokenIds: [ally.id, hero.id] }), d => {
        const fields = (d.fields ?? []).filter(f => /^t\d$/.test(f.name ?? ""));
        if ( fields.length !== 2 ) return null;
        return { fields: { t0: 100, t1: 20 }, button: "ok" };
      });
      ctx.expect(run.seen.some(d => (d.fields ?? []).some(f => f.name === "t0")), `Mot de pouvoir fortifiant : la répartition est demandée (${run.seen.map(d => d.title).join(" | ")})`);
      await pause(2000);
      const got = [await tempHp(ctx, ally), await tempHp(ctx, hero)].sort((a, b) => b - a);
      ctx.expect((got[0] === 100) && (got[1] === 20), `PV temporaires 100 / 20 (${got.join(" / ")})`);
    }

    // ---- Power Word Heal ----
    if ( wanted("guerisseur") ) {
      await ctx.ensureItem(caster, PHB("phbsplPowerWordH"));
      const hp0 = await ctx.hp(ally);
      ctx.restore(() => ctx.setHp(ally, hp0));
      ctx.restore(() => ctx.call("set-status", { tokenId: ally.id, statusId: "prone", active: false }).catch(() => {}));
      await ctx.setHp(ally, Math.max(1, Math.floor(hp0 / 2)));
      await ctx.call("set-status", { tokenId: ally.id, statusId: "prone", active: true });
      ctx.expect((await ctx.effects(ally)).some(e => (e.statuses ?? []).includes("prone")), "l'Allié est À terre avant le sort");
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "power-word-heal", targetTokenIds: [ally.id] }), d => {
        const b = (d.buttons ?? []).find(x => /Réaction|Reaction/.test(x.label ?? ""));
        return b ? { button: b.action ?? b.label } : null;
      });
      ctx.expect(run.used?.used !== false, `Mot de pouvoir guérisseur lancé (${run.used?.reason ?? "ok"})`);
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(x => /Réaction|Reaction/.test(x.label ?? ""))), `Mot de pouvoir guérisseur : « se relever » est demandé (${run.seen.map(d => d.title).join(" | ")})`);
      await pause(2000);
      const effects = await ctx.effects(ally);
      const prone = effects.some(e => (e.statuses ?? []).includes("prone"));
      ctx.expect(!prone, "la cible s'est relevée");
    }

    // ---- Blink: the return to a chosen cell ----
    if ( wanted("clignotement") ) {
      const home = await ctx.position(caster);
      ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.call("set-status", { tokenId: caster.id, statusId: "ethereal", active: false }).catch(() => {}));
      // The end-of-turn d6 sends it into the Ethereal (effect marked `blink`); the start of the next turn removes the effect:
      // the return.
      await ctx.call("run-script", { code: `const a = canvas.tokens.get("${caster.id}").actor; const e = await a.toggleStatusEffect("ethereal", { active: true });
        await e.update({ "flags.dnd5e-combat.blink": true }); return e.id;` });
      await pause(1500);
      // A cell two away to the northwest (≤ 3 m diagonally 5/5): free, in sight.
      const goal = { x: home.x - grid, y: home.y - grid };
      const run = await usingWith(ctx, () => ctx.call("run-script", { code: `const a = canvas.tokens.get("${caster.id}").actor;
        const ids = a.effects.filter(e => e.getFlag("dnd5e-combat", "blink")).map(e => e.id); await a.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;` }),
        d => {
          const b = (d.buttons ?? []).find(x => x.action === "move");
          return b ? { button: "move" } : null;
        });
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(x => x.action === "move")), `Clignotement : rester ou choisir est demandé (${run.seen.map(d => d.title).join(" | ")})`);
      await pause(1500);
      const picked = await ctx.engine("teleportPick", { x: goal.x + grid / 2, y: goal.y + grid / 2 }).catch(err => ({ error: err.message }));
      ctx.expect(picked?.picked === true, `la case est choisie d'un clic (${JSON.stringify(picked)})`);
      await pause(2500);
      const pos = await ctx.position(caster);
      ctx.expect((pos.x === goal.x) && (pos.y === goal.y), `le Lanceur revient sur la case choisie (${pos.x},${pos.y} ; attendu ${goal.x},${goal.y})`);
    }
  }
};
