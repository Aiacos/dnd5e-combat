import { describe, it, expect } from "vitest";
import { parseMultiattack, fitMultiattack, attackCount, expandPlan, multiattackStatus, ANY, ANY_ATTACK, MELEE_ATTACK, isMultiattackId, validatePlan, declaredPlan } from "../module/scripts/core/multiattack.mjs";
import { freshBudget, checkUse, spendUse, refundUse } from "../module/scripts/core/turn.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Textes anglais de la forme de ceux du Monster Manual 2024 : créatures du SRD 5.2, ou textes synthétiques de même
// grammaire (noms de créatures et d'attaques inventés) pour les créatures hors SRD.
const TEXT = {
  ghoul: "<p>The [[lookup @name lowercase]] makes two [[/item .mmClaw0000000000]] attacks.</p>",
  dragon: "<p>The [[lookup @name lowercase]] makes three [[/item Rend]] attacks. It can replace one attack with a use of [[/item Spellcasting]] to cast <em>@UUID[Compendium.dnd-players-handbook.spells.Item.phbsplMelfsAcidA]{Melf's Acid Arrow}</em> (level 3 version).</p>",
  assassin: "<p>The [[lookup @name lowercase]] makes three attacks, using [[/item .jLa5l9pntsTVrMKH]] or [[/item .dL4668G7zXeC5zyY]] in any combination.</p>",
  gnawer: "<p>The [[lookup @name lowercase]] makes one [[/item .mmGnawingBite000]] attack and two [[/item .mmFlail000000000]] attacks.</p>",
  chimera: "<p>The [[lookup @name lowercase]] makes one [[/item .mmRam00000000000]] attack, one [[/item .mmBite0000000000]] attack, and one  [[/item .mmClaw0000000000]] attack. It can replace the Claw attack with a use of [[/item .mmFireBreath0000]] if available.</p>",
  lasher: "<p>The [[lookup @name lowercase]] makes two [[/item .mmLash0000000000]] attacks. It can replace any attack with a use of [[/item .mmDreadWhisper00]].</p>",
  barbed: "<p>The [[lookup @name lowercase]] makes one [[/item .mmClaws000000000]] attack and one [[/item .mmTail0000000000]] attack, or it makes two [[/item .mmHurlFlame00000]] attacks.</p>",
  stoneSpirit: "<p>The [[lookup @name lowercase]] makes three Stone Maul attacks or two Rock Burst attacks.</p>",
  brass: "<p>The [[lookup @name lowercase]] makes three [[/item Rend]] attacks. It can replace one attack with a use of (A) [[/item Sleep Breath]] or (B) [[/item Spellcasting]] to cast <em>@UUID[Compendium.dnd-players-handbook.spells.Item.phbsplScorchingR]{Scorching Ray}</em>.</p>",
  cloudGiant: "<p class=\"feature\">The [[lookup @name lowercase]] makes two attacks, using [[/item .mmThunderousMace]] or [[/item .mmThundercloud00]] in any combination. It can replace one attack with a use of Spellcasting to cast <em>[[/item .mmSpellcasting00.Activity.NdueMCpXRc7fLDFa]]</em>.</p>",
  glabrezu: "<p>The [[lookup @name lowercase]] makes two [[/item .mmPincer00000000]] attacks and uses [[/item .mmPummel00000000]] or [[/item .mmSpellcasting00]].</p>",
  watcher: "<p>The [[lookup @name lowercase]] uses [[/item .XDw7TpLSibnKMcZI]] three times.</p>",
  hydra: "<p>The [[lookup @name lowercase]] makes as many [[/item .mmBite0000000000]] attacks as it has heads.</p>",
  weretiger: "<p>The [[lookup @name lowercase]] two attacks, using [[/item .aaaaaaaaaaaaaaaa]] or [[/item .bbbbbbbbbbbbbbbb]] in any combination. It can replace one attack with a [[/item .mmBite0000000000]] attack.</p>",
  youngBronze: "<p>The [[lookup @name lowercase]] makes three [[/item Rend]] attacks.It can replace one attack with a use of [[/item Repulsion Breath]].</p>",
  sporeling: "<p>The [[lookup @name lowercase]] makes one Slam attack and uses Calming Spores.</p>"
};
const ACID = "spell:Compendium.dnd-players-handbook.spells.Item.phbsplMelfsAcidA";

describe("lecture du texte anglais", () => {
  it("N fois la même attaque", () => {
    expect(parseMultiattack(TEXT.ghoul)).toEqual({ options: [[{ n: 2, refs: ["id:mmClaw0000000000"] }]], replace: [], extra: [] });
  });

  it("par nom, et remplacement par un sort précis (dragon)", () => {
    expect(parseMultiattack(TEXT.dragon)).toEqual({ options: [[{ n: 3, refs: ["name:rend"] }]], replace: [{ n: 1, refs: [ACID], of: null }], extra: [] });
  });

  it("combinaison libre, mélange fixe", () => {
    expect(parseMultiattack(TEXT.assassin).options).toEqual([[{ n: 3, refs: ["id:jLa5l9pntsTVrMKH", "id:dL4668G7zXeC5zyY"] }]]);
    expect(parseMultiattack(TEXT.gnawer).options).toEqual([[{ n: 1, refs: ["id:mmGnawingBite000"] }, { n: 2, refs: ["id:mmFlail000000000"] }]]);
  });

  it("remplacement d'une attaque désignée, de n'importe quelle attaque", () => {
    expect(parseMultiattack(TEXT.chimera).replace).toEqual([{ n: 1, refs: ["id:mmFireBreath0000"], of: ["name:claw"] }]);
    expect(parseMultiattack(TEXT.lasher).replace).toEqual([{ n: ANY, refs: ["id:mmDreadWhisper00"], of: null }]);
  });

  it("options : « …, or it makes two C attacks », « three A attacks or two B attacks » (noms en clair)", () => {
    expect(parseMultiattack(TEXT.barbed).options).toHaveLength(2);
    expect(parseMultiattack(TEXT.stoneSpirit).options).toEqual([[{ n: 3, refs: ["name:stone maul"] }], [{ n: 2, refs: ["name:rock burst"] }]]);
  });

  it("(A) souffle ou (B) sort ; sort désigné par son activité d'incantation", () => {
    expect(parseMultiattack(TEXT.brass).replace[0].refs).toEqual(["name:sleep breath", "spell:Compendium.dnd-players-handbook.spells.Item.phbsplScorchingR"]);
    expect(parseMultiattack(TEXT.cloudGiant).replace[0].refs).toEqual(["activity:NdueMCpXRc7fLDFa"]);
  });

  it("usage en plus, utilisations répétées, têtes de l'Hydre", () => {
    expect(parseMultiattack(TEXT.glabrezu).extra).toEqual([{ refs: ["id:mmPummel00000000", "id:mmSpellcasting00"] }]);
    expect(parseMultiattack(TEXT.sporeling)).toEqual({ options: [[{ n: 1, refs: ["name:slam"] }]], replace: [], extra: [{ refs: ["name:calming spores"] }] });
    expect(parseMultiattack(TEXT.watcher).options).toEqual([[{ n: 3, refs: ["id:XDw7TpLSibnKMcZI"] }]]);
    expect(parseMultiattack(TEXT.hydra).options).toEqual([[{ n: ANY, refs: ["id:mmBite0000000000"] }]]);
  });

  it("coquilles du MM : « makes » absent, point collé", () => {
    expect(parseMultiattack(TEXT.weretiger)?.options[0][0].n).toBe(2);
    expect(parseMultiattack(TEXT.youngBronze)?.replace).toHaveLength(1);
  });

  it("rien de lisible : null (autre langue, sans nombre, vide)", () => {
    expect(parseMultiattack("<p>Die Kreatur greift zweimal an.</p>")).toBeNull();
    expect(parseMultiattack("<p>La créature effectue plusieurs attaques.</p>")).toBeNull();
    expect(parseMultiattack("")).toBeNull();
  });

  it("nombre d'attaques affiché : l'option la plus longue", () => {
    expect(attackCount(parseMultiattack(TEXT.barbed))).toBe(2);
    expect(attackCount(parseMultiattack(TEXT.stoneSpirit))).toBe(3);
  });
});

// Phrases inventées, de la forme des traductions (Manuel des monstres en français, fiches écrites à la main) : aucun texte de livre.
describe("lecture d'un texte traduit (français, portugais)", () => {
  const NAMES = [["Lame grise", "id:lameGrise000000a"], ["Lame", "id:lame000000000000"], ["Croc d'ombre", "id:crocOmbre0000000"],
    ["Hurlement", "id:hurlement0000000"], ["Morsure", "id:morsure000000000"]];
  const read = (html, names=NAMES) => parseMultiattack(html, { names });

  it("sans nom : n'importe quelle attaque, en chiffres ou en lettres", () => {
    expect(read("<p>Le golem effectue deux attaques.</p>").options).toEqual([[{ n: 2, refs: [ANY_ATTACK] }]]);
    expect(read("<p>Le golem réalise 3 attaques.</p>").options).toEqual([[{ n: 3, refs: [ANY_ATTACK] }]]);
    expect(read("<p>O golem realiza duas ataques.</p>").options).toEqual([[{ n: 2, refs: [ANY_ATTACK] }]]);
  });

  it("noms en clair reconnus par la fiche, le plus long d'abord ; et/ou ; remplacement par une capacité", () => {
    const plan = read("<p>Le chevalier effectue trois attaques avec ses armes Lame grise et/ou Croc d’ombre. Il peut remplacer une attaque par sa capacité Hurlement.</p>");
    expect(plan.options).toEqual([[{ n: 3, refs: ["id:lameGrise000000a", "id:crocOmbre0000000"] }]]);
    expect(plan.replace).toEqual([{ n: 1, refs: ["id:hurlement0000000"], of: null }]);
  });

  it("enrichers, groupes successifs, « réparties entre », options, usage en plus", () => {
    expect(read("<p>Le [[lookup @name lowercase]] effectue une attaque de [[/item .aaaaaaaaaaaaaaaa]], une attaque de [[/item .bbbbbbbbbbbbbbbb]] et une de [[/item .cccccccccccccccc]].</p>").options)
      .toEqual([[{ n: 1, refs: ["id:aaaaaaaaaaaaaaaa"] }, { n: 1, refs: ["id:bbbbbbbbbbbbbbbb"] }, { n: 1, refs: ["id:cccccccccccccccc"] }]]);
    expect(read("<p>Il effectue deux attaques, réparties à sa guise entre [[/item .aaaaaaaaaaaaaaaa]] et [[/item .bbbbbbbbbbbbbbbb]].</p>").options)
      .toEqual([[{ n: 2, refs: ["id:aaaaaaaaaaaaaaaa", "id:bbbbbbbbbbbbbbbb"] }]]);
    expect(read("<p>Il effectue trois attaques de Morsure ou deux attaques de Lame.</p>").options)
      .toEqual([[{ n: 3, refs: ["id:morsure000000000"] }], [{ n: 2, refs: ["id:lame000000000000"] }]]);
    expect(read("<p>Il effectue deux attaques de Morsure et recourt à Hurlement.</p>").extra).toEqual([{ refs: ["id:hurlement0000000"] }]);
  });

  it("remplacement : l'une de ces attaques, n'importe laquelle, une attaque désignée ; portugais", () => {
    expect(read("<p>Il effectue deux attaques de Morsure. Il peut remplacer l'une de ces attaques par une utilisation de Hurlement.</p>").replace)
      .toEqual([{ n: 1, refs: ["id:hurlement0000000"], of: null }]);
    expect(read("<p>Il effectue deux attaques de Morsure. Il peut remplacer n'importe quelle attaque par Hurlement.</p>").replace[0].n).toBe(ANY);
    expect(read("<p>Il effectue une attaque de Morsure et une attaque de Lame. Il peut remplacer l'attaque de Lame par Hurlement.</p>").replace)
      .toEqual([{ n: 1, refs: ["id:hurlement0000000"], of: ["id:lame000000000000"] }]);
    expect(read("<p>Ele faz dois ataques de Morsure. Ele pode substituir um ataque por Hurlement.</p>"))
      .toEqual({ options: [[{ n: 2, refs: ["id:morsure000000000"] }]], replace: [{ n: 1, refs: ["id:hurlement0000000"], of: null }], extra: [] });
  });

  it("anglais en prose : « makes two attacks », noms en minuscules, total puis détail, remplacement lu en clair", () => {
    expect(parseMultiattack("<p>The knight makes two attacks.</p>").options).toEqual([[{ n: 2, refs: [ANY_ATTACK] }]]);
    const names = [["Grey Blade", "id:lameGrise000000a"], ["Shadow Fang", "id:crocOmbre0000000"], ["Howl", "id:hurlement0000000"]];
    expect(parseMultiattack("<p>The knight makes three attacks with his blades grey blade and/or shadow fang. He can replace one attack with his howl.</p>", { names }))
      .toEqual({ options: [[{ n: 3, refs: ["id:lameGrise000000a", "id:crocOmbre0000000"] }]], replace: [{ n: 1, refs: ["id:hurlement0000000"], of: null }], extra: [] });
    expect(parseMultiattack("<p>The knight makes three melee attacks: two with her [[/item .aaaaaaaaaaaaaaaa]] and one with her [[/item .bbbbbbbbbbbbbbbb]].</p>").options)
      .toEqual([[{ n: 2, refs: ["id:aaaaaaaaaaaaaaaa"] }, { n: 1, refs: ["id:bbbbbbbbbbbbbbbb"] }]]);
    expect(parseMultiattack("<p>The knight makes two attacks. He can replace one of those attacks with his howl.</p>", { names }).replace)
      .toEqual([{ n: 1, refs: ["id:hurlement0000000"], of: null }]);
  });

  it("le texte anglais garde la priorité", () => {
    expect(read(TEXT.ghoul)).toEqual(parseMultiattack(TEXT.ghoul));
  });

  it("le plan tient : deux attaques quelconques, pas trois ; Hurlement à la place d'une", () => {
    const plan = read("<p>Le chevalier effectue deux attaques. Il peut remplacer une attaque par Hurlement.</p>");
    const lame = ["id:lame000000000000", ANY_ATTACK], croc = ["id:crocOmbre0000000", ANY_ATTACK], cri = ["id:hurlement0000000"];
    expect(fitMultiattack(plan, [lame, croc])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [lame, croc, lame])).toBeNull();
    expect(fitMultiattack(plan, [cri, lame])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [cri, cri])).toBeNull();
    expect(fitMultiattack(plan, [["id:soin000000000000"]])).toBeNull();
  });
});

describe("ce qui tient dans le plan", () => {
  const rend = ["id:mmRend0000000000", "name:rend"];
  const acid = ["id:cachedspell0000", "id:mmSpellcasting00", "activity:castcastcastcast", ACID, "name:melf's acid arrow"];
  const dragon = parseMultiattack(TEXT.dragon);

  it("trois Déchirures, pas quatre", () => {
    expect(fitMultiattack(dragon, [rend, rend, rend])).toEqual({ attacks: 3 });
    expect(fitMultiattack(dragon, [rend, rend, rend, rend])).toBeNull();
  });

  it("un sort à la place d'une attaque, une seule fois", () => {
    expect(fitMultiattack(dragon, [rend, acid, rend])).toEqual({ attacks: 3 });
    expect(fitMultiattack(dragon, [rend, acid, rend, rend])).toBeNull();
    expect(fitMultiattack(dragon, [acid, acid])).toBeNull();
  });

  it("une utilisation étrangère au plan ne tient pas", () => {
    expect(fitMultiattack(dragon, [["id:mmFireBreath0000", "name:fire breath"]])).toBeNull();
  });

  it("mélange fixe : une Morsure et deux Rossées, dans n'importe quel ordre", () => {
    const plan = parseMultiattack(TEXT.gnawer);
    const bite = ["id:mmGnawingBite000"], thrash = ["id:mmFlail000000000"];
    expect(fitMultiattack(plan, [thrash, bite, thrash])).toEqual({ attacks: 3 });
    expect(fitMultiattack(plan, [bite, bite])).toBeNull();
  });

  it("remplacement désigné : le Souffle de la Chimère prend la place de la Griffe, pas de la Morsure", () => {
    const ram = ["id:mmRam00000000000", "name:ram"], bite = ["id:mmBite0000000000", "name:bite"];
    const claw = ["id:mmClaw0000000000", "name:claw"], breath = ["id:mmFireBreath0000", "name:fire breath"];
    const plan = expandPlan(parseMultiattack(TEXT.chimera), [ram, bite, claw, breath]);
    expect(plan.replace[0].of).toEqual(["name:claw", "id:mmClaw0000000000"]);
    expect(fitMultiattack(plan, [ram, bite, breath])).toEqual({ attacks: 3 });
    expect(fitMultiattack(plan, [ram, claw, breath])).toBeNull();
  });

  it("options : on ne mélange pas les deux (Diable barbelé)", () => {
    const plan = parseMultiattack(TEXT.barbed);
    const claws = ["id:mmClaws000000000"], tail = ["id:mmTail0000000000"], flame = ["id:mmHurlFlame00000"];
    expect(fitMultiattack(plan, [flame, flame])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [claws, tail])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [claws, flame])).toBeNull();
  });

  it("usage en plus : compté à part, une fois", () => {
    const plan = parseMultiattack(TEXT.glabrezu);
    const pincer = ["id:mmPincer00000000"], pummel = ["id:mmPummel00000000"];
    expect(fitMultiattack(plan, [pincer, pummel, pincer])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [pincer, pummel, pummel])).toBeNull();
  });

  it("sans plan : rien ne tient", () => {
    expect(fitMultiattack(null, [rend])).toBeNull();
  });
});

describe("budget du tour (M1)", () => {
  const plan = parseMultiattack(TEXT.dragon);
  const ctx = { isOwnTurn: true, attacksPerAction: 1 };
  const rend = { cost: "action", weaponAttack: true, usesSpellSlot: false, multiattack: plan, keys: ["id:mmRend0000000000", "name:rend"] };
  const acid = { cost: "action", weaponAttack: false, usesSpellSlot: false, multiattack: plan, keys: ["id:spellspellspell", "id:mmSpellcasting00", ACID] };
  const breath = { cost: "action", weaponAttack: false, usesSpellSlot: false, multiattack: plan, keys: ["id:mmFireBreath0000", "name:fire breath"] };
  const multi = { cost: "action", weaponAttack: false, usesSpellSlot: false, multiattack: plan, keys: ["id:mmMultiattack000"], opensMultiattack: true };

  it("la première Déchirure paie l'action et ouvre les trois attaques ; les deux suivantes sont couvertes", () => {
    let b = spendUse(freshBudget(), rend, ctx);
    expect(b.action).toBe(0);
    expect(b.attacks).toEqual({ granted: 3, used: 1 });
    expect(checkUse(b, rend, ctx)).toEqual([]);
    b = spendUse(b, rend, ctx);
    expect(checkUse(b, acid, ctx)).toEqual([]);          // le sort à la place de la troisième
    b = spendUse(b, acid, ctx);
    expect(b.attacks).toEqual({ granted: 3, used: 3 });
    expect(checkUse(b, rend, ctx)).toEqual(["noAction"]);  // une quatrième : au-delà
  });

  it("ce qui n'est pas dans le plan coûte l'action, comme ailleurs", () => {
    const b = spendUse(freshBudget(), breath, ctx);
    expect(b.action).toBe(0);
    expect(b.multi).toBeNull();
    expect(checkUse(b, rend, ctx)).toEqual(["noAction"]);
  });

  it("l'item Attaques multiples ouvre le plan sans rien utiliser", () => {
    const b = spendUse(freshBudget(), multi, ctx);
    expect(b.action).toBe(0);
    expect(b.multi.used).toEqual([]);
    expect(checkUse(b, rend, ctx)).toEqual([]);
  });

  it("une utilisation annulée sort du plan ; la première annulée le referme et rend l'action", () => {
    const b0 = freshBudget();
    const b1 = spendUse(b0, rend, ctx);
    const b2 = spendUse(b1, rend, ctx);
    const back = refundUse(b2, b1, b2);
    expect(back.multi.used).toHaveLength(1);
    expect(back.attacks.used).toBe(1);
    const closed = refundUse(back, b0, b1);
    expect(closed.multi).toBeNull();
    expect(closed.action).toBe(1);
    expect(closed.attacks).toEqual({ granted: 0, used: 0 });
  });

  it("sans plan lisible : le comportement d'avant", () => {
    const plain = { ...rend, multiattack: null };
    const b = spendUse(freshBudget(), plain, { isOwnTurn: true, attacksPerAction: 99 });
    expect(b.multi).toBeNull();
    expect(b.attacks).toEqual({ granted: 99, used: 1 });
  });
});

describe("ce qui reste (§18.19, HUD)", () => {
  const ram = ["id:mmRam00000000000", "name:ram"], bite = ["id:mmBite0000000000", "name:bite"];
  const claw = ["id:mmClaw0000000000", "name:claw"], breath = ["id:mmFireBreath0000", "name:fire breath"];
  const tail = ["id:mmTail0000000000", "name:tail"];
  const chimera = expandPlan(parseMultiattack(TEXT.chimera), [ram, bite, claw, breath]);
  const candidates = [
    { id: "Ram", uses: [ram] }, { id: "Bite", uses: [bite] }, { id: "Claw", uses: [claw] },
    { id: "Breath", uses: [breath] }, { id: "Tail", uses: [tail] }
  ];

  it("rien d'utilisé : tout le plan reste, l'étranger n'en est pas", () => {
    expect(multiattackStatus(chimera, [], candidates)).toEqual({ left: ["Ram", "Bite", "Claw", "Breath"], spent: [] });
  });

  it("Coup de bélier et Morsure faits : la Griffe ou le Souffle à sa place", () => {
    expect(multiattackStatus(chimera, [ram, bite], candidates)).toEqual({ left: ["Claw", "Breath"], spent: ["Ram", "Bite"] });
  });

  it("le Souffle a pris la place de la Griffe : il ne reste que le Coup de bélier et la Morsure", () => {
    expect(multiattackStatus(chimera, [breath], candidates)).toEqual({ left: ["Ram", "Bite"], spent: ["Claw", "Breath"] });
  });

  it("tout fait : rien ne reste ; sans plan : rien", () => {
    expect(multiattackStatus(chimera, [ram, bite, claw], candidates)).toEqual({ left: [], spent: ["Ram", "Bite", "Claw", "Breath"] });
    expect(multiattackStatus(null, [], candidates)).toEqual({ left: [], spent: [] });
  });
});

describe("isMultiattackId : les Attaques multiples de toute fiche", () => {
  it("MM 2024, fiche sans identifiant (nom anglais), traductions, nom à précision", () => {
    for ( const id of ["multiattack", "attaque-multiple", "attaques-multiples", "multiattaque", "multiattack-human-or-hybrid-form-only",
      "cos-rahadin-attaques-multiples", "cos-ithuriel-etoile-attaques-multiples"] ) {
      expect(isMultiattackId(id)).toBe(true);
    }
  });
  it("pas une autre capacité", () => {
    for ( const id of ["multiattacker", "attaque", "bite", "", null, undefined] ) expect(isMultiattackId(id)).toBe(false);
  });
});

// B01 : formes que la lecture perdait (phrases inventées, de la grammaire du Monster Manual ; noms en clair).
describe("B01 : formes en noms clairs, « or uses X twice », « only one of which »", () => {
  const read = html => parseMultiattack(`<p>The [[lookup @name lowercase]] ${html}</p>`);

  it("« two melee attacks or uses X twice » : deux options, la mêlée n'est plus perdue", () => {
    expect(read("makes two melee attacks or uses Arc Bolt twice.").options).toEqual([[{ n: 2, refs: [MELEE_ATTACK] }], [{ n: 2, refs: ["name:arc bolt"] }]]);
    // Forme du MM (enrichers) : l'option « uses … twice » s'ajoute à la première.
    expect(parseMultiattack("<p>The [[lookup @name lowercase]] makes three [[/item Glow Blade]] attacks or uses [[/item Glow Burst]] twice.</p>").options)
      .toEqual([[{ n: 3, refs: ["name:glow blade"] }], [{ n: 2, refs: ["name:glow burst"] }]]);
  });

  it("« one A attack and one B attack » en noms clairs : deux groupes, pas un seul", () => {
    expect(read("makes one Claws attack and one Root attack.").options).toEqual([[{ n: 1, refs: ["name:claws"] }, { n: 1, refs: ["name:root"] }]]);
    expect(read("makes one Bite attack and two Rend attacks.").options).toEqual([[{ n: 1, refs: ["name:bite"] }, { n: 2, refs: ["name:rend"] }]]);
  });

  it("« two attacks: one with its A and one with its B » : le détail, pas deux attaques quelconques", () => {
    expect(read("makes two attacks: one with its Claws and one with its Root.").options).toEqual([[{ n: 1, refs: ["name:claws"] }, { n: 1, refs: ["name:root"] }]]);
  });

  it("« two melee attacks, only one of which can be a bite attack » : au plus une Morsure", () => {
    const plan = read("makes two melee attacks, only one of which can be a bite attack.");
    expect(plan.options).toEqual([[{ n: 1, refs: [MELEE_ATTACK] }, { n: 1, refs: [MELEE_ATTACK], except: ["name:bite"] }]]);
    const bite = ["name:bite", MELEE_ATTACK], claw = ["name:claw", MELEE_ATTACK], bolt = ["name:bolt", "kind:ranged"];
    expect(fitMultiattack(plan, [bite, claw])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [claw, bite])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [claw, claw])).toEqual({ attacks: 2 });
    expect(fitMultiattack(plan, [bite, bite])).toBeNull();
    expect(fitMultiattack(plan, [bolt])).toBeNull();
    expect(attackCount(plan)).toBe(2);
  });

  it("l'exclusion s'élargit comme les clés (nom ↔ id)", () => {
    const plan = expandPlan(read("makes two attacks, only one of which can be a Bite attack."), [["id:bbbbbbbbbbbbbbbb", "name:bite"]]);
    expect(plan.options[0][1].except).toEqual(["name:bite", "id:bbbbbbbbbbbbbbbb"]);
    expect(fitMultiattack(plan, [["id:bbbbbbbbbbbbbbbb", ANY_ATTACK], ["id:bbbbbbbbbbbbbbbb", ANY_ATTACK]])).toBeNull();
  });
});

describe("B01 : plan déclaré (`multiattackPlan`)", () => {
  const plan = { options: [[{ n: 2, refs: [MELEE_ATTACK] }], [{ n: 2, refs: ["identifier:arc-bolt"] }]] };

  it("valide : options, groupes, remplacement, usage en plus", () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(validatePlan({ options: [[{ n: 1, refs: ["identifier:claws"] }, { n: 1, refs: ["identifier:root"], except: ["name:bite"] }]],
      replace: [{ n: 1, refs: ["id:aaaaaaaaaaaaaaaa"], of: ["identifier:claws"] }], extra: [{ refs: ["kind:attack"] }] })).toEqual([]);
  });

  it("refusé : forme, nombre, clé inconnue, sorte d'attaque inconnue", () => {
    expect(validatePlan(null)).toHaveLength(1);
    expect(validatePlan({ options: [] })).toHaveLength(1);
    expect(validatePlan({ options: [[{ n: 0, refs: ["kind:melee"] }]] })).toHaveLength(1);
    expect(validatePlan({ options: [[{ n: 1, refs: ["claws"] }]] })).toHaveLength(1);
    expect(validatePlan({ options: [[{ n: 1, refs: ["kind:spell"] }]] })).toHaveLength(1);
    expect(validatePlan({ options: [[{ n: 1, refs: ["kind:melee"], upTo: true }]] })).toHaveLength(1);
    expect(validatePlan({ options: [[{ n: 1, refs: ["kind:melee"] }]], extras: [] })).toHaveLength(1);
  });

  it("clé de contenu : acceptée par `validateEntry`, refusée mal formée", () => {
    expect(validateEntry({ multiattackPlan: plan })).toEqual([]);
    expect(validateEntry({ multiattackPlan: { options: [[{ n: 2, refs: ["melee"] }]] } })).toHaveLength(1);
  });

  it("complété et joué comme un plan lu", () => {
    const p = declaredPlan(plan);
    expect(p).toEqual({ options: plan.options, replace: [], extra: [] });
    expect(fitMultiattack(p, [["identifier:arc-bolt"], ["identifier:arc-bolt"]])).toEqual({ attacks: 2 });
    expect(fitMultiattack(p, [[MELEE_ATTACK], ["identifier:arc-bolt"]])).toBeNull();
    expect(declaredPlan({ options: "x" })).toBeNull();
    expect(declaredPlan(undefined)).toBeNull();
  });
});
