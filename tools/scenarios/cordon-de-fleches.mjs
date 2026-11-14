/**
 * Cordon de flèches (§75, version simple) : l'action du sort pose la sphère de 9 m (pose de dnd5e, validée par `api.mcp.placeRegionAt`) ;
 * une créature qui y entre fait la sauvegarde de Dextérité de l'activité sœur (2d4 perforants) ; quatre projectiles, puis la zone tombe.
 * Lanceur : un token de la scène dont l'acteur connaît le sort (`cordon-of-arrows`), sinon le Rôdeur à qui le Player's Handbook le prête.
 * Cibles : cinq Bandits hostiles posés pour le scénario (`ctx.cast`), déplacés un à un dans la zone, puis retirés.
 */
const MODULE_ID = "dnd5e-combat";
const CORDON = "Compendium.dnd-players-handbook.spells.Item.phbsplCordonofAr";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "cordon de flèches — une sauvegarde à chaque entrée, quatre projectiles puis la fin",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    let caster = null, itemId = null;
    for ( const t of tokens ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      const i = (a?.items ?? []).find(x => x.system?.identifier === "cordon-of-arrows");
      if ( i ) { caster = t; itemId = i._id; break; }
    }
    // Personne ne le connaît dans `dnd-6` : prêté au Rôdeur le temps du scénario, depuis le Player's Handbook 2024 (le sort n'est pas dans
    // le SRD) ; sans ce module, non applicable.
    if ( !caster && tokens.some(t => t.name === "Rôdeur") ) {
      const ranger = await ctx.token("Rôdeur");
      const lent = await ctx.ensureItem(ranger, CORDON).catch(() => null);
      if ( lent ) { caster = ranger; itemId = lent; }
    }
    if ( !caster ) { ctx.log("aucun lanceur du Cordon de flèches sur la scène, ni Player's Handbook pour le prêter : non applicable"); return; }
    // Les cibles : cinq Bandits hostiles du SRD 2024, posés pour le scénario — le moteur épargne les alliés du lanceur (vu le 2026-11-14 :
    // avec les personnages de l'Arène de test pour cibles, aucune sauvegarde).
    const names = [1, 2, 3, 4, 5].map(n => `Cible du cordon ${n}`);
    const cast = await ctx.cast(Object.fromEntries(names.map(n => [n, "mmBandit00000000"])), { near: caster.name, disposition: -1 });
    const others = names.map(n => cast[n]).filter(Boolean);
    if ( others.length < 5 ) { ctx.log("pas de fiche de Bandit pour les cinq cibles : non applicable"); return; }
    const grid = await ctx.gridSize();
    const at = await ctx.position(caster);
    const center = { x: at.x + (grid / 2), y: at.y + (grid / 2) };
    const api = (fn, args, waitMs) => ctx.call("call-module-api", { moduleId: MODULE_ID, fn, args, ...(waitMs ? { waitMs } : {}) });
    const regions = async () => (await ctx.call("list-scene-objects", { types: ["Region"] })).objects.Region ?? [];

    // Les cibles loin de la zone d'abord (au-delà de 9 m), pour qu'elles y ENTRENT.
    for ( const [n, t] of others.entries() ) await ctx.call("move-token", { tokenId: t.id, x: at.x + ((10 + n) * grid), y: at.y + (8 * grid) });
    await sleep(1500);

    const before = new Set((await regions()).map(r => r.id));
    const since = await ctx.lastMessageId();
    await api("use", { tokenId: caster.id, itemId, activityType: "utility" }, 500);
    await sleep(1500);
    const placed = (await api("placeRegionAt", center)).result;
    ctx.expect(placed?.placed, `la sphère du Cordon est posée sur ${caster.name} (${JSON.stringify(placed)})`);
    await sleep(2500);
    const zone = (await regions()).find(r => !before.has(r.id));
    if ( !ctx.expect(!!zone, "la zone reste sur la scène") ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone.id }).catch(() => {}));
    ctx.expect(!(await ctx.messagesSince(since)).some(m => /Dextérité|Dexterity/i.test(m.flavor ?? "")), "à la pose : aucun projectile");

    // Cinq entrées : quatre projectiles, puis plus rien.
    const saves = [];
    for ( const [n, t] of others.entries() ) {
      const s0 = await ctx.lastMessageId();
      await ctx.call("move-token", { tokenId: t.id, x: at.x + grid, y: at.y + (n - 2) * grid });
      await sleep(5000);
      const save = (await ctx.messagesSince(s0)).find(m => /Dextérité|Dexterity/i.test(m.flavor ?? ""));
      saves.push(!!save);
      ctx.log(`${t.name} entre : ${save ? `sauvegarde ${save.rolls?.[0]?.total}` : "rien"}`);
      if ( n === 3 ) ctx.expect(!(await regions()).some(r => r.id === zone.id), "au 4e projectile, la zone prend fin");
    }
    ctx.expect(saves.slice(0, 4).every(Boolean), `les quatre premières entrées : une sauvegarde de Dextérité chacune (${saves.join(", ")})`);
    ctx.expect(!saves[4], "la cinquième : plus de projectile");
    const damage = (await ctx.messagesSince(since)).filter(m => /dégâts|damage/i.test(m.flavor ?? "") && /Cordon/i.test(m.flavor ?? ""));
    ctx.log(`dégâts : ${damage.map(m => (m.rolls ?? []).map(r => `${r.formula}=${r.total}`).join(" | ")).join(" ; ") || "aucun message (toutes réussies ?)"}`);
  }
};
