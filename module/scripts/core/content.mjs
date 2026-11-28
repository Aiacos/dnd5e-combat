/**
 * The content schema (SPEC §13, S4): what an item can declare to the engine, wherever it
 * comes from — content shipped with the module, world overlay, item flag — and how these
 * layers combine. Validation here, not in Foundry: a wrong entry is refused on
 * write (runtime/content.mjs) and ignored on read, never half-applied.
 *
 * An ENTRY, indexed by dnd5e identifier:
 *   {
 *     triggers?: [{ on, if?, do, via? }]        declarations of the registry (core/triggers.mjs); `via: "effect"`:
 *                                               carried by the effects the item applies (repeated save)
 *     aura?: { radius?, units?, affects?, includeSelf?, effect?, radiusFormula?, changes?, types?, whileActive? }
 *                                               `changes`: the copy's changes, in place of the item's effect
 *                                               (effect missing, empty or wrong in the Monster Manual, §18.12) — the copy
 *                                               then carries no condition; `types`: only these creature types
 *     onHit?: { save: <activity id> | "sole" }   attack that imposes a save (adapter/usage.mjs); `"sole"`: the only
 *                                               save of the item, when its id is not fixed (activity added by an
 *                                               enchantment: Sword of Wounding)
 *     choice?: { effects: "one", prompt?, pool? }  EXCLUSIVE effects: the author chooses one (Hex); `pool`:
 *                                               { <activity id>: [item effect ids] } — item effects
 *                                               that an activity offers without linking them (§37, Bestow Curse:
 *                                               "Curse Ability" and its six abilities); K3 (§324): `roll: true` —
 *                                               rolled on a die, one face per effect, in the order of `order`
 *                                               (Chaos Blade: 1d4);
 *                                               §504 (B24): `{ outcome: ["damage", "grapple"], grapple?: { escapeDc } }`
 *                                               — on an attack that hits, the author chooses the damage, or a
 *                                               grapple in its place (no damage, Grappled at the stated escape DC);
 *                                               `choice` in advance on use: no question
 *     teleport?: { distance, units, activity? } use teleports the user (§16.10, B11): the destination is
 *                                               chosen at once, within `distance` at most — for an item without a
 *                                               dnd5e "teleport" activity (all of the PHB: Misty Step is a utility
 *                                               there); §461: without `distance` or `units`, the range of `activity`
 *                                               (as a length) gives the distance (monster abilities, read from their
 *                                               text);
 *                                               `then`: id of an item activity used on arrival (§67 quater);
 *                                               `passengers: { count, within?, units? }` (§264): up to `count`
 *                                               non-hostile creatures within `within` (5 ft) leave with them, set
 *                                               down next to them (Dimension Door);
 *                                               `maxLight: "dim"|"dark"` (§367): departure and arrival no brighter
 *                                               ("Shadow Walk");
 *                                               `area: "left"` (§462): the activity's area is placed automatically
 *                                               around the space left, before the jump, and does not include its
 *                                               author ("Deadly Teleportation");
 *                                               `"arrival"` (§463): around them, once arrived ("Radiant
 *                                               Teleportation");
 *                                               `after: "attack"` (§464): offered once the attack is judged, hit or
 *                                               missed, not on use ("Yugoloth Mind Claws");
 *                                               `destination: { near, within, units, trigger? }` (§465): arrival
 *                                               within `within` of a seen creature (`trigger`: the designated target
 *                                               first; "Pursuit", "Waking Dream") or of a plant (`"plant"`,
 *                                               reminder to the GM; Tree Stride); without distance or range, near a
 *                                               creature is enough
 *     lineDash?: { reach, units, activity? }    straight-line rush (§57): on use, the cell
 *                                               of arrival is chosen (up to the Speed, unoccupied, in sight, in a
 *                                               straight line through creatures, without Opportunity Attacks); the
 *                                               activity (default: the one used) plays on each creature within
 *                                               `reach` or less of a space crossed — without template
 *                                               (core/dash.mjs)
 *     movable?: { distance, units, cost? }      the spell's area moves (§16.14, B18: Moonbeam, "a Magic
 *                                               action on your later turns, 18 m at most"): recasting the spell
 *                                               when its area is already there moves it to the clicked cell, at the
 *                                               price of the activity's activation, without a spell slot;
 *                                               `cost: "none"` — at no cost, on their turn, from the turn it is
 *                                               placed (the area follows the movement of the caster: Summon
 *                                               Celestial)
 *     summon?: { initiative: "after"|"own"|"none", pilot?, endsSpell?, untargeted?, chooseCount? }
 *                                               §385: `untargeted` — accepted, no effect: since §394 a summon is only
 *                                               targeted on request (`targetedSummon`); `chooseCount` — "up to N"
 *                                               creatures: the caster chooses how many
 *                                               in the "Choose the form" window (with the level), N according to the
 *                                               spell level: true = the `count` of the profile, or a formula (§387,
 *                                               Animate Dead).
 *                                               the summoned creatures enter combat (§16.13, B12): `after` =
 *                                               "shares your Initiative and acts right after you" (Summon X);
 *                                               `own` = "rolls its own Initiative" (Find Familiar); `none` =
 *                                               does not enter combat (Arcane Eye, Dancing Lights: they do not act).
 *                                               `replaces: true` (§230): a new summon dismisses the previous ones of
 *                                               the same item (Find Steed: "the steed is replaced by the new one");
 *                                               `minLevels: { <activité>: n }` (§230): this activity can only be
 *                                               cast from spell level n — its free casting (at the base level) is
 *                                               not one.
 *                                               O8f (§349) `hostile: true`: the creature is hostile to everyone
 *                                               ("The Skull", Scroll of Titan Summoning) — Hostile token, no owning
 *                                               player or pilot.
 *                                               §305 `vanishesWithCaster: true`: it vanishes when its caster dies
 *                                               (Find Steed, Primal Companion); `endsOnLongRest: true`: it leaves on
 *                                               its caster's Long Rest (Wild Companion).
 *                                               `familiar: true` (§107): a familiar — basic actions except Attack,
 *                                               vision enabled, its master can dismiss it into its pocket dimension
 *                                               and recall it.
 *                                               `pilot: { cost, distance, units, onCast? }` (§16.15, B19): an object
 *                                               that the caster commands during their turn (Spiritual Weapon) — its
 *                                               turn is skipped, a command costs the caster `cost` and opens a
 *                                               movement of `distance` and a use; `onCast`: "use" | "command", the
 *                                               command offered on the turn of casting; `occupies: false`: the
 *                                               object does not occupy its space (Bigby's Hand); `shared: true`: one
 *                                               command applies to all the objects of the spell ("move the
 *                                               lights"); `cluster: { distance, units }`: each stays within this
 *                                               distance of another; `leash: true`: an object that leaves the
 *                                               spell's range disappears; `tether: { distance, units }`: it only
 *                                               moves within this distance of the caster ("Duplicity": 36 m).
 *                                               `lasts: { value, units }`: the creature disappears after this
 *                                               world-time duration (formula on the item's data; Wild Companion).
 *                                               And, for the summon: `mimic: true` (the token takes the caster's
 *                                               image), `endsIfIncapacitated: true` (it ends if the caster is
 *                                               Incapacitated), `castFrom: true` (the caster casts their spells from
 *                                               their cell: the range is measured from either one).
 *                                               `endsSpell: true`: removing the object ends the spell's
 *                                               Concentration; `endsAtZero: true`: the object at 0 HP too;
 *                                               `vanishesAtZero: true`: the creature disappears at 0 HP, the spell
 *                                               continues (§259: summoning spells of the 2024 PHB);
 *                                               `vanishesAfterDamage: n`: it disappears when its pulses have dealt n
 *                                               damage in total (Guardian of Faith).
 *                                               `pulse: { item, radius, units }`: a creature that ends its turn
 *                                               within `radius` of the object suffers the activity of its item
 *                                               `item` (identifier; Flaming Sphere: "flames"); `on`: the moments
 *                                               (turnEnd by default; enter: a creature arrives in range; turnStart:
 *                                               it starts its turn in range; casterTurnStart: at the start of the
 *                                               caster's turn, against ONE enemy in range (§159); moves: the object
 *                                               arrives in range of it; `stopsOnContact` (§403): it stops then for
 *                                               the turn, Flaming Sphere), once per turn and per creature;
 *                                               `affects: "enemy"`: only the caster's enemies;
 *                                               `seenBy: "caster"`: only a creature the caster sees (§368)
 *     burst?: { activity, radius, units, from?, affects? }
 *                                               after the attack roll, hit or missed, the engine plays the sibling
 *                                               activity `activity` on the target and every creature within `radius`
 *                                               of it (§16.19: the explosion of Ice Knife); `from`: after those
 *                                               activities (ids), and on a target that took damage (Heat Metal,
 *                                               §16.21) — or that was healed, after a heal (C12-b: "Life Shock");
 *                                               `affects: "enemy"`: the caster's enemies only, the target excluded
 *     recast?: true                             casting the spell again while its Concentration lasts reuses it,
 *                                               without spell slot or new Concentration (Call Lightning, §16.21)
 *     obscures?: true | { fromPulse }           the area placed by the item heavily obscures (Fog Cloud, §16.24) —
 *                                               `fromPulse`: from this replay of `casterPulse` (Storm of Vengeance):
 *                                               sight does not pass through it; Blindsight and Tremorsense, if
 *                                               (§14.1, adapter/vision.mjs)
 *     silences?: true                           the area placed by the item makes silence (Silence, issue #42): no
 *                                               sound is born in it or crosses it — nothing inside is heard, nor
 *                                               anything through it (adapter/hearing.mjs)
 *     usageLimits?: { <activity id>: { oncePerTurn?, whenEmpty?, lowestSlot?, noDialog?, cost?, unmoved?, whileEffect?,
 *                                               unlessEffect?, automatic?, light? } }
 *                                               usage limits that dnd5e does not control (§16.40, core/limits.mjs):
 *                                               once on each of your turns; only if the item `whenEmpty` has no
 *                                               uses left; `lowestSlot`: the lowest slot, without a window;
 *                                               `noDialog`: without the dnd5e window; `cost`: the cost of the 2024
 *                                               rule ("free": none, §298: Sacred Weapon)
 *                                               when the dnd5e data says something else ("Flames": Bonus Action)
 *                                               (Wild Resurgence); `unmoved`: only without having moved this turn
 *                                               (Steady Aim, §20); `whileEffect` (§486): only under the effect of an
 *                                               item with this identifier, or an effect with this id (a list = any
 *                                               of them), forceable refusal otherwise; `unlessEffect`: only outside
 *                                               these effects; `automatic`: the engine already plays this activity
 *                                               by itself, casting it by hand is refused (forceable). An activity
 *                                               added by an enchantment (random id) is read under the id of the
 *                                               original activity (adapter/limits.mjs, `riderOriginId`);
 *                                               `light`: ["dim", "dark"]… — only in one of these lights (One with
 *                                               Shadows)
 *     effectsExpire?: "longRest"|"shortRest"    the effects the item applies end at this rest of the bearer
 *                                               (native dnd5e expiry, `duration.expiry`) — Prayer of Healing, §16.38
 *     revealsInvisible?: true                   the bearer of an item effect "can't benefit from the Invisible
 *                                               condition" ("Stardust", Faerie Fire, §16.36): simulated vision and
 *                                               the flat-rate condition judge them as if they were not
 *     light?: { on, bright?, dim?, units?, darkness?, dispels?, carried?, single?, color?, animation?, activity? }
 *                                               light or darkness of the spell (§16.31, core/light.mjs). `on`:
 *                                               "area" = a source on the placed area, which follows it and leaves
 *                                               with it (`darkness: true`: magical Darkness of the area's radius,
 *                                               which blocks sight like fog, except Truesight and Devil's Sight;
 *                                               `dispels: n`: dispels the Darkness of level ≤ n it covers);
 *                                               "effect" = the item's effects make their bearer shine; "summon" =
 *                                               the summoned object carries its light, `carried`: on casting, the
 *                                               player chooses "on the ground" or "on me" (the caster shines) and
 *                                               the color (§16.35);
 *                                               "wall" (§170) = a row of sources on each side of a wall placed by
 *                                               points (Wall of Fire), which appear, follow and leave with it;
 *                                               "caster" (§287) = on the `activity` activity (otherwise any), the
 *                                               caster shines as long as their Concentration lasts (Sunbeam);
 *                                               `darkness` + `dispels: n`: the Darkness dispels spell lights of
 *                                               level ≤ n it covers (Darkness);
 *                                               `single`: recasting the spell puts out the previous one. Radii in
 *                                               the convention of Foundry (`dim` = outer radius of the Dim Light)
 *     saveAdvantage?: string[]                  the item's bearer has Advantage on saves against an activity that
 *                                               applies one of these conditions (Fey Ancestry: `charmed`, §16.25);
 *                                               `"magic"`: against a spell or a magical effect (Magic Resistance,
 *                                               §18.9)
 *     saveIgnoresCover?: true                   the item's Dexterity save does not receive the target's Cover bonus
 *                                               (Sacred Flame; core/save-cover.mjs)
 *     attackIgnoresCover?: true | "half"        the item's attacks ignore Half Cover and Three-Quarters Cover of
 *                                               their target (`"half"`: Half Cover only); Total Cover remains.
 *                                               `rangedFeat.cover` applies to the bearer and all their attacks of one
 *                                               kind, this key to the item alone
 *     saveAutoSuccessAgainst?: ["magic"]        the item's bearer automatically succeeds on their saves against a
 *                                               spell or a magical effect ("Superior Magic Resistance")
 *     spellAttacksMiss?: true                   spell attack rolls automatically miss the item's bearer: they are
 *                                               out of reach of a spell with an attack roll ("Superior Magic
 *                                               Resistance")
 *     saveResist?: { activity, schools?, singleTarget? }
 *                                               the object's bearer can turn a failed save against a spell (of these
 *                                               schools; that targets only them) into a success, on uses of this
 *                                               object activity — asked, never automatic (Staff of Charming)
 *     saveReflect?: { activity, schools?, singleTarget? }
 *                                               the same form, for a successful save: the Reaction and 1 charge of
 *                                               the object turn the spell back on its caster, as if the bearer had
 *                                               cast it
 *     onFell?: { activity?, radius, units }     when an enemy drops to 0 HP from the bearer's blows, or within
 *                                               `radius` of them, the activity (default: the item's first heal)
 *                                               plays (Dark One's Blessing, §16.25)
 *     bonusAttack?: { after, melee? }          after a weapon attack by the author that `after` ("critical": a
 *                                               Critical Hit; "felled": a target dropped to 0 HP) — melee if
 *                                               `melee` —, the same weapon attacks again as a Bonus Action, on their
 *                                               turn (Great Weapon Master, "Hew", §16.26)
 *     reactiveSpell?: true                      the bearer can answer an Opportunity Attack with a one-action spell
 *                                               that targets only the creature that is leaving (War Caster, §16.26)
 *     freeSomatic?: true                        the bearer performs somatic components with weapons or a shield in
 *                                               hand (War Caster, §409: the free-hand check does not refuse it)
 *     projectiles?: { count, attack }           several projectiles per cast (§16.27) — `count`: formula (data of
 *                                               the scaled activity: `@item.level`, `@details.level`); `attack`:
 *                                               false = they hit automatically, spread among the targets (Magic
 *                                               Missile); true = one attack per projectile, chained by the engine;
 *                                               `onePerTarget` (§403): never two on the same creature (Steel Wind
 *                                               Strike) (Scorching Ray, Eldritch Blast)
 *     chain?: { radius, units }                §286: targets after the first must be within `radius` of it (Chain
 *                                               Lightning) — refused at targeting, flagged at the legality check
 *     leap?: { radius, units, max }             on doubles on the damage dice of an attack that hits, the spell
 *                                               bounces to another target within `radius` of the last, never
 *                                               targeted by this cast, `max` times at most (formula: `@item.level`)
 *                                               — Chromatic Orb, §16.27
 *     duplicates?: true                         the item's effects on its bearer are duplicates (Mirror Image,
 *                                               §16.25): a hit that strikes them may strike a duplicate instead
 *     healMax?: true                            a creature bearing an item effect regains the maximum of a heal
 *                                               (Beacon of Hope, §16.24)
 *     bolt?: { radius, units }                  the placed area (the item's template) is reduced to a circle of
 *                                               this radius around its center, then removed after resolution (Call
 *                                               Lightning, §16.21)
 *     casterPulse?: { at, by: [{ from, to?, activity, max?, use?, pay? }], ground?, away?, untilSpent? }
 *                                               §91: at the start (`at: "turnStart"`) or the end (`"turnEnd"`) of the
 *                                               caster's turn, the lasting area replays a sibling activity on what
 *                                               is inside — the one of the entry whose [from, to] contains the
 *                                               replay number (1 = the first turn after placement: Storm of
 *                                               Vengeance, turns 2, 3, 4, 5–10); `max`: at most that many targets
 *                                               (the lightning bolts: 6, the caster's enemies first); `use`: the
 *                                               activity is USED by the caster (its consumptions, without a target
 *                                               or area: a counter); `ground`: only the creatures on the ground
 *                                               (Earthquake); `pay`: the activity's consumptions paid before the
 *                                               replay (a counter that its dice read); `away: { distance, units }`:
 *                                               the area first moves away from the caster; `untilSpent`: the spell
 *                                               ends when the item has no use left (Tsunami)
 *     atZero?: { activity, save?: { ability, dc }, whileEffect? }
 *                                               §95: dropped to 0 HP without being killed outright, the bearer can
 *                                               get back up — the activity USED (its consumptions set the HP:
 *                                               Necrotic Husk; or its heal, on them: "Lingering Wrath", Strength of
 *                                               the Grave), after the `save` save succeeds (DC: formula, `@damage` =
 *                                               the damage taken); `whileEffect`: only if they bear an item effect
 *                                               with this identifier (transformed by "Wild Wrath")
 *     afterSneak?: { activity, radius, units }
 *                                               §95: right after Sneak Attack damage on their turn, the activity
 *                                               (damage) on an OTHER creature within `radius` of the first (Wails
 *                                               from the Grave)
 *     searchBonus?: { formula?, advantage? }    §94: on the Search action (runtime/search.mjs), a die added to the
 *                                               check (`formula`: "Lookouts", 1d4) or Advantage (`advantage`:
 *                                               "Sharp Eye" — a use of the item, spent only if the check finds
 *                                               someone)
 *     lifesteal?: { damageType?, fraction? }    §120: the author regains HP equal to a share (`fraction`, 1 by
 *                                               default; rounded down) of the damage of this type that the item
 *                                               deals (Vampiric Touch: half of the necrotic damage) —
 *                                               runtime/lifesteal.mjs
 *     savageAttacker?: true                     §129: once per turn, on a weapon's damage roll, its dice rolled
 *                                               twice, the best kept (Savage Attacker) — runtime/feats.mjs
 *     initiativeSwap?: true                     §129: right after their Initiative roll, the creature can swap
 *                                               their Initiative with that of an ally in the combat (Alert) —
 *                                               runtime/roll-bonus.mjs
 *     healingRerolls?: true                     §129: on the healing dice of a spell of the creature, a 1 is
 *                                               rerolled once (Healer)
 *     effectWhile?: { <effect id>: { if: { armor?, notArmor?, oneHanded?, inCombat?, abilityAtLeast? }, changes? } }
 *                                               §130: the item's transferred effect is only active if the condition
 *                                               holds for the bearer (Defense, Dueling…); `changes` rewrites the
 *                                               effect's changes (broken data); without `if` (§295), only the
 *                                               changes are rewritten, the effect stays active or not at the
 *                                               player's choice — runtime/effect-while.mjs
 *     rangedFeat?: { kind, cover?, closeCombat?, longRange?, offhandModifier?, spellRange? }
 *                                               §131: ranged feats — for an attack kind (`kind`: "weapon" = ranged
 *                                               attack with a weapon, "crossbow" = crossbow, "spell" = spell attack
 *                                               roll): Half Cover and Three-Quarters Cover ignored, no Disadvantage
 *                                               in contact with an enemy or at long range, the damage modifier of
 *                                               the Light attack, the spell's range extended (`spellRange`)
 *                                               `cover: "half"`: only Half Cover is ignored (Wand of the War Mage)
 *     peerlessAim?: true                        §135: a missed attack hits instead, once until the next turn (Boon
 *                                               of Combat Prowess)
 *     fortifiedHealing?: true                   §135: + Con to the HP regained, once per turn (Boon of Fortitude)
 *     overwhelmingStrike?: true                 §135: on a Critical Hit, damage equal to the value of the ability
 *                                               score raised by the item (Boon of Irresistible Offense)
 *     spellRecall?: true                        §135: 1d4 equal to the level of a 1–4 spell slot: it is not spent
 *                                               (Boon of Spell Recall)
 *     lastStandHeal?: { activity }              §135: at 0 HP, 1 HP + half the maximum, on uses of the activity
 *                                               ("Last Stand")
 *     elementalAdept?: true                     §134: spells of the chosen type (item flag) — Resistance ignored,
 *                                               1 → 2 on the dice
 *     ignoresResistance?: { types, from?, if? } §134: the damage of these types that the bearer deals ignores
 *                                               Resistance (Poisoner);
 *                                               §447 `from`: only that of these activities of the item, or of the
 *                                               spell they make cast ("Touch of Death"); `if`: a condition on the
 *                                               author (`source`) and the activity
 *     rollDisadvantage?: { on, if? }            §484: the bearer makes these rolls (`on`: "check" — ability checks,
 *                                               skills and Initiative included —, "save") with Disadvantage when
 *                                               `if` holds on them (`self.inSunlight`)
 *     rollAdvantage?: { on, if? }               the same, with Advantage (Bloodied Frenzy: "while Bloodied, Advantage on saving
 *                                               throws", `self.hasStatus: "bloodied"`)
 *     fleeOnFailedSave?: true                   §147: failed save → the target flees from the caster using their
 *                                               Reaction (Dissonant Whispers)
 *     ritualAdept?: {class: string}           §139: Ritual Adept — the ritual spells of this spellbook, unprepared,
 *                                               as rituals out of combat
 *     slotRecovery?: {class: string, maxLevel?: number, activity?: id}
 *                                               §139: Arcane Recovery on a Short Rest (half the class level);
 *                                               `activity`: the item activity that counts the use, when
 *                                               the item has none itself (Natural Recovery of the Druid)
 *     reactiveStrike?: true                     §136: Reactive Strike (Polearm Master) against whoever enters the
 *                                               reach of the polearm weapon held
 *     opportunityDisadvantage?: true | { whileEffect }
 *                                               §134: Opportunity Attacks against the bearer have Disadvantage
 *                                               (Speedy);
 *                                               O9g (§362) `whileEffect`: as long as this effect from the item is on
 *                                               the bearer (Boots of Speed)
 *     quickStand?: { value, units }             §134: standing up costs this movement (at most half the Speed;
 *                                               Athlete)
 *     quickSearch?: true                        §134: the Search action is taken as a Bonus Action when it is free
 *                                               (Observant)
 *     haltOnReaction?: { effect }               §133: an attack made as a Reaction (Opportunity Attack) that hits
 *                                               applies this effect of the item to the target (Sentinel, Halt:
 *                                               Speed 0)
 *     spellDamageTypes?: { class?, types, from?, cost? }
 *                                               gap survey: a spell of this class (§447: without a class, any spell)
 *                                               that deals damage can take one of these types, offered with its
 *                                               types to choose from before the roll ("Psychic Spells"); `from`:
 *                                               only a spell that deals one of these types; `cost`: the item
 *                                               activity that pays for the change, offered as long as enough
 *                                               remains (Transmuted Spell)
 *     spellDamageRerolls?: { activity, count }  Empowered Spell: after the damage roll of a spell of the bearer, this
 *                                               activity (which pays) rerolls up to `count` dice (formula), the
 *                                               lowest; the new ones count
 *     turnStartHeal?: { activity, bloodied? }   Survivor: at the start of each of their turns, the bearer who has at
 *                                               least 1 HP (and, with `bloodied`, half their HP or less) uses this
 *                                               healing activity
 *     deathSaveCritical?: number                Survivor: the d20 from which a death saving throw counts as a
 *                                               natural 20
 *     endsOwnConditions?: string[] | { statuses?, at?, exhaustion?, uses? }
 *                                               §236: at the end of each of their turns, the bearer ends one of
 *                                               these conditions (Self-Restoration: Charmed, Frightened, Poisoned);
 *                                               §278: `at: "turnStart"` (at the start), `exhaustion` (if there is no
 *                                               condition, a level of Exhaustion), `uses` (a use of the item each
 *                                               time) — core/self-care.mjs
 *     regainOnInitiative?: { item, upTo } | { items?, exhaustion?, uses? }
 *                                               §236: on the Initiative roll, the item's uses go back up to at least
 *                                               `upTo` (Superior Inspiration); §278: `items` (identifiers: all their
 *                                               uses come back), `exhaustion` (levels removed), `uses` (a use of the
 *                                               item, only if there is something to regain)
 *     grantsConditionImmunities?: string[]      §295: condition immunities the item grants with no effect in its
 *                                               data ("Protected by Lady Nature": Poisoned) — in the held effect of
 *                                               `grantsSpeeds` (runtime/speed-grants.mjs)
 *     saveAutoSuccess?: { types?, fighting?, sizeAtLeast? }
 *                                               §402: automatic success — these creature types (Petrification), a
 *                                               creature the caster is fighting (`fighting`: "Captivating Speech",
 *                                               "False Friends"), or a creature at least this size (`sizeAtLeast`:
 *                                               "Falling Net")
 *     saveAutoFail?: { types }                  automatic failure — these creature types (Blight: a Plant), without
 *                                               a roll
 *     fadesOnLongRest?: [effect ids]            §402: one of these effects drops at each Long Rest (Raise Dead: −4
 *                                               that diminishes)
 *     onUsesSpent?: { activity?, effects }      §458: when the item's uses are exhausted, these item effects are
 *                                               applied to its bearer, once (books with 48 hours of reading: +2 to
 *                                               an ability score)
 *     leavesEffects?: [effect ids]              §456: when the item leaves the sheet, these item effects are applied
 *                                               to the former bearer (Mark of Sacrifice removed: Disadvantage on
 *                                               Wisdom saves for 24 h); not when replaced by the diagnosis (option
 *                                               `replacing`)
 *     magicEvasion?: true                       §402: the spell's held effect cancels half the damage of a
 *                                               successful save against magic (Circle of Power)
 *     saveAdvantageFrom?: { types, statuses }   §402: Advantage on saves against these conditions applied by these
 *                                               types (Protection from Evil and Good)
 *     breathAdvantage?: { types }               Advantage on saves against the breath ("…-breath" ability) of a
 *                                               creature of these types, for whoever bears the object (Dragon Scale
 *                                               Mail)
 *     leash?: { distance, units }               §402: the creature bearing an item effect does not voluntarily move
 *                                               away from the caster beyond it (Compelled Duel)
 *     mount?: { rider?, controlled? }           §490 (B08): the creature bearing the item can be mounted — by the
 *                                               `rider` actor alone (id), otherwise by a smaller allied creature;
 *                                               controlled (default): it acts right after its rider and only takes
 *                                               Dash / Disengage / Dodge without orders; `controlled: false`:
 *                                               independent mount. Shared movement, rider's fall (runtime/mount.mjs)
 *     commands?: { actor | identifier, distance, units, cost? }
 *                                               §490 (B08): the item commands a non-summoned companion (actor id,
 *                                               or identifier of an item it carries) in range — commanded for this
 *                                               round
 *     durationByLevel?: [{ from, seconds?, concentration? }]
 *                                               §403: duration of the effects and of Concentration according to the
 *                                               slot; without `seconds`: until dispelled; `concentration: false`:
 *                                               dnd5e does not start it (Bestow Curse: 10 min at level 4, 8 h
 *                                               without Concentration at level 5…) — runtime/cantrips.mjs
 *     zoneLasts?: { seconds }                   §403: the area of an activity of the item lasts this long (world
 *                                               time), even if instantaneous, and replays what its triggers say
 *                                               (Symbol: the 18 m sphere, 10 minutes)
 *     formLock?: true                           §403: in the lasting area, no "transform" activity (Moonbeam: "can't
 *                                               assume another form" — legality issue, runtime/turn.mjs)
 *     formLock?: { worn: true, onAttempt?, forms? }
 *                                               B09 (§488): as long as the object is worn (equipped, or on the sheet
 *                                               if it is not equipped), its bearer does not change form: each
 *                                               attempt ("transform" activity, `changesForm`, activity of an item
 *                                               named in `forms`, effect of such an item turned on by hand) is
 *                                               refused, forceable, and inflicts `onAttempt` on them (`damage`
 *                                               steps, `to: "bearer"`, formula or activity of the object) —
 *                                               core/form-lock.mjs, runtime/form-lock.mjs
 *     suspends?: ["regeneration"]               B09 (§488): as long as the object is worn, these traits of its
 *                                               bearer do not work (collar that prevents regenerating) —
 *                                               adapter/form-lock.mjs `suspendedBy`
 *     windward?: true                           §403: in the lasting area, each meter toward the caster costs two
 *                                               (Gust of Wind; core/windward.mjs, refusal before the step, extra
 *                                               cost noted in the budget: `windward`)
 *     keepsSpeed?: true                         §403: the bearer of an item effect does not see their Speed reduced
 *                                               by a magical effect applied afterwards (Freedom of Movement;
 *                                               core/speed-floor.mjs, on placement in runtime/cantrips.mjs)
 *     compels?: true                            §403: Compulsion — on the caster's turn, a direction (Bonus Action);
 *                                               the target walks that way on their turn, then replays their save
 *                                               (`resave` with `ifCompelled`, runtime/compulsion.mjs)
 *     checkPoses?: true                         §402: a check activity applies its effects to the target, without a
 *                                               check (Maze: "Banished")
 *     quietPose?: true                          §300: the lasting area does not act on placement — only at the
 *                                               declared moments (Sleet Storm, Stinking Cloud: those already inside
 *                                               save at the start of their turn)
 *     brutalStrike?: { options?, count? }       C12-e: Brutal Strike — options offered with Reckless Attack
 *                                               (`push`: push; `effect`: item effect applied to the target hit, or
 *                                               list of identifiers — §433: the first one that a Brutal Strike item
 *                                               of the actor carries), number of options per hit
 *                                               (runtime/barbarian.mjs)
 *     dataFixes?: [{ path, value, from? } | { effect, path, value, from? } | { effect, create, unless? }]
 *                                               O1 (§335): fixes to the item's premium data (cost, charges, DC,
 *                                               damage, borne effects, missing effect), written by the active GM on
 *                                               creation and by the diagnosis — core/data-fixes.mjs
 *                                               `unless`: the effect is not created if the data already carries this
 *                                               other effect (a module version that added it since: Dungeon
 *                                               Master's Guide 3.0.0)
 *     spellFixes?: { <"cast" activity id>: [fixes] }
 *                                               the same fixes, for the copy of the spell that this item activity
 *                                               casts (Wand of Fear: "Fear (18 m cone)")
 *     includesOrigin?: true                     O4 (§338): the item's "personal" area also takes its origin (Dust of
 *                                               Sneezing and Choking)
 *     absorbsDamage?: string[]                  K7 (§328): the item's bearer turns these damage types into healing,
 *                                               before Resistances and Immunities (Acid, Fire, Lightning Absorption
 *                                               of the golems)
 *     regainOnShortRest?: string[]              C12-j: on a Short Rest, the uses of these items (identifiers) come
 *                                               back (Font of Inspiration, Improved Protective Shard;
 *                                               runtime/grimoire.mjs)
 *     sniper?: true                             C12-i: hidden, a missed attack roll does not reveal the bearer
 *                                               (Skulker, runtime/hide.mjs)
 *     hidesBehindLarger?: true                  Naturally Stealthy (Halfling): an enemy whose sight passes through a
 *                                               creature at least one size larger than the bearer does not prevent
 *                                               them from hiding
 *     summonEffectsOnCaster?: true              C12-g: the effects of the summoning activity go to the caster, tied
 *                                               to their Concentration, not to the summoned creature (Mislead: the
 *                                               caster becomes Invisible)
 *     grants?: { from, activity }               C12-d: the targets of the `from` activity receive a copy of the item
 *                                               reduced to `activity`, at the caster's DC and level, until the end
 *                                               of their Concentration (Dragon's Breath, runtime/grants.mjs)
 *     killsAtZero?: true | { types?, sizeAtMost?, activities? }
 *                                               C12-f: a creature that the item's damage reduces to 0 HP dies
 *                                               (Disintegrate); K2 (§323): only of these types ("a Humanoid"), of
 *                                               this size at most, by these activities (the Disintegration Ray among
 *                                               the Eye Rays)
 *     retort?: { damageType }                   C12-f: the item's reaction missed by the attacker sends back to them
 *                                               the damage the bearer takes ("Bewitching Defenses",
 *                                               runtime/reactions.mjs)
 *     enterOnPose?: true                        C12-b: a lasting area, placed by an activity that resolves nothing
 *                                               itself: the creatures it covers on appearing enter it (Summon
 *                                               Celestial; §438: Spirit Guardians 3.0.0). Nothing when the placing
 *                                               activity is the one that replays
 *     hitDefense?: true                         C12-e: whoever hits the bearer with an attack roll has Disadvantage
 *                                               on their other rolls against them during that turn (Defensive
 *                                               Tactics: Multiattack Defense)
 *     effectsFirst?: true                       §303: the effects of the activity applied before its damage or its
 *                                               healing (Aid: max HP raised first, otherwise the healing is capped
 *                                               at the previous max HP)
 *     healRaisesMax?: true                      with `effectsFirst`: the rolled healing also raises the maximum HP
 *                                               by as much, in the effect applied before it (Heroes' Feast)
 *     zoneBound?: true                          §300: the item's effects only hold inside one of its areas (Spirit
 *                                               Guardians: the halved Speed ends on leaving the Emanation;
 *                                               runtime/areas.mjs)
 *     duringRage?: { enable?, post?, disable?, copiesEnd?, oneOption?, cures?, onStart? }
 *                                               §299: item effects held by the bearer's Rage — enabled / applied on
 *                                               entry, removed at the end, conditions cured, activity played on
 *                                               entry ("Blind Rage", "Predator's Rage", Primal Knowledge, Vitality
 *                                               of the Tree) — runtime/barbarian.mjs;
 *                                               `oneOption` (Core#98): only one option of the item per Rage, a
 *                                               second is a forceable issue (runtime/turn.mjs `useIssues`,
 *                                               core/limits.mjs `secondRageOption`)
 *     spellsInAttack?: { maxLevel, class?, attacks? }
 *                                               §298: a one-action spell, of level `maxLevel` or lower (and of this
 *                                               class), is cast in place of `attacks` attacks (1 by default) of the
 *                                               Attack action (War Magic, Valor's Extra Attack, Improved War Magic:
 *                                               2)
 *     zoneMax?: number                          §296: at most this number of creatures in the item's area, the
 *                                               closest to its center (Slow, Mass Cure Wounds: "up to six") —
 *                                               core/area.mjs
 *     healPool?: { activities, cap?: "halfMax", temp?: true, formula? }
 *                                               §296: the healing roll of these activities is a pool split equally
 *                                               among the chosen targets ("Survival": cap at half the max HP;
 *                                               `temp`: as Temporary Hit Points, "Exalting Smite") —
 *                                               runtime/cure.mjs, core/pools.mjs
 *     multiattackPlan?: { options: [[{ n, refs, except? }]], replace?: [{ n, refs, of? }], extra?: [{ refs }] }
 *                                               B01: on the Multiattack item, the declared plan replaces reading the
 *                                               text — exclusive options, groups of at most `n` attacks citing a
 *                                               key of `refs` and none of `except` (`identifier:<id>`, `id:`,
 *                                               `name:`, `kind:attack|melee|ranged`…) — core/multiattack.mjs
 *     flurryStrikes?: number                    §295: the item's bearer strikes this many times with Flurry of Blows
 *                                               ("Heightened Creed": 3)
 *     effectDurations?: { <effect id>: { seconds } | { formula, units } }
 *                                               §295: the duration of an item effect when placed, when the data is
 *                                               wrong (Intimidating Presence: one minute, not one round); O9h:
 *                                               `{ formula, units }` — rolled once per use, the same for all targets
 *                                               (Dust of Disappearance: 2d4 minutes)
 *     grantsResistances?: string[]              §236: the Resistances the item grants with no effect in its data
 *                                               (Avatar of Battle) — an effect held on the actor, like
 *                                               `grantsSpeeds`
 *     scoreFloor?: string[]                     §236: a check or save of these abilities counts as at least their
 *                                               score (Indomitable Might: Strength)
 *     cantripRange?: { class, add, requires? }  §236: a cantrip of the class, with a range of at least 3 m, reaches
 *                                               farther by `add` — if the actor has the `requires` item (Improved
 *                                               Elemental Fury)
 *     fleetStep?: { item, activity }            §236: after a Bonus Action other than this one, the item's activity
 *                                               is free once that turn (Fleet Step: Step of the Wind)
 *     extraFirstTurn?: { minus }                §236: a second turn in the first round, at Initiative minus `minus`,
 *                                               unless Surprised (Thief's Reflexes)
 *     combatInspiration?: true                  gap survey: the creature bearing this bard's Bardic Inspiration can
 *                                               add the die to the damage of their hit, or to their AC as a Reaction
 *                                               when hit (Combat Inspiration, College of Valor;
 *                                               adapter/inspiration.mjs)
 *     critMove?: true                           gap survey: right after landing a Critical Hit, on their turn, half
 *                                               their Speed more without Opportunity Attacks (Remarkable Athlete)
 *     keepsConcentration?: string[]             gap survey: taking damage does not break Concentration on these
 *                                               items (identifiers) — no Concentration check when all of the
 *                                               bearer's Concentration comes from them (Relentless Hunter: Hunter's
 *                                               Mark)
 *     concentration?: { limit, loseAll?: true } §494 (B14): the creature holds up to `limit` Concentrations at once
 *                                               (effect held on the actor, runtime/speed-grants.mjs); `loseAll`: a
 *                                               failed roll, Incapacitated, 0 HP make them all drop (already the
 *                                               rule of dnd5e and of the engine: the key declares it, the loss is
 *                                               announced)
 *     concentrationBreaker?: true | "item"      §133: the concentrating creature that the bearer wounds has
 *                                               Disadvantage on their next Concentration check (Mage Slayer);
 *                                               `"item"`: only when the damage comes from an activity of this
 *                                               object, equipped and attuned if it asks for it (a magic weapon)
 *     interposeShield?: true                    §133: successful Dexterity save against damage halved, shield held:
 *                                               the Reaction to take none (Shield Master)
 *     piercer?: true                            §132: Piercer — once per turn, one die of a piercing attack
 *                                               rerolled (the lowest); one extra die on a piercing Critical Hit —
 *                                               runtime/feats.mjs
 *     critMark?: { damageType, side }           §132: a Critical Hit of this type puts a mark on the target until
 *                                               the start of the author's next turn: "against" = Advantage against
 *                                               it (Crusher), "by" = Disadvantage on its attacks (Slasher)
 *     grappleDamage?: { formula, damageType, grapplers? }
 *                                               §132: at the start of each of the author's turns, this damage to
 *                                               each creature they grapple (Unarmed Fighting); `grapplers: true`: to
 *                                               those grappling them too (Barbed Hide of the Barbed Devil)
 *     rerollInitiative?: { atMost }             §120: on each Initiative roll, a d20 of `atMost` or less can be
 *                                               rerolled (question), the new one kept (Survivor, "Hypervigilance":
 *                                               9) — runtime/roll-bonus.mjs
 *     onNatural1?: { activity }                 §93: right after a d20 Test of the creature whose d20 shows 1, they
 *                                               use the activity (Dark Gifts of Ravenloft: their save, on
 *                                               themselves)
 *     zoneEnd?: { activity }                    §91: when the item's lasting area ends (Concentration, duration,
 *                                               removed), the caster uses the activity, their area centered on the
 *                                               one that falls (Delayed Blast Fireball: the bead explodes)
 *     atTurnStart?: { activity }                at the start of the caster's turn, as long as the spell's
 *                                               Concentration holds, the activity is offered (open targeting): Aura
 *                                               of Vitality (§16.21)
 *     absorb?: { activeAfter?, recharge? }      pool that absorbs damage before HP (§16.11, B14: Arcane Ward): its
 *                                               HP are the item's uses; `activeAfter` = id of the activity that
 *                                               creates it (no use spent, no pool); `recharge: { school, perLevel }`
 *                                               = a spell of this school cast with a slot restores `perLevel` × the
 *                                               slot's level to it
 *     ranges?: { <activity id>: { value, units } | { units: "self" } }
 *                                               the rule's range when the dnd5e data says something else (Witch
 *                                               Bolt: "Self" in the data, 18 m in the 2024 PHB)
 *     tether?: { attack, activity, range }      link with the creature targeted by the `attack` activity, hit or
 *                                               missed (§16.43, Witch Bolt): the `activity` activity only targets it
 *                                               (start of turn, right-click menu); beyond `range` or behind Total
 *                                               Cover, the Concentration drops
 *     damageShield?: { effects | worn, formula, oncePerTurn? }
 *                                               the bearer of an item effect (`effects`: profile id → damage type)
 *                                               reduces damage of this type by `formula` (Resistance, §16.46);
 *                                               `worn` (a damage type): the item's bearer themselves, equipped (and
 *                                               attuned if needed) — a ring that "reduces the cold damage you take
 *                                               by 2d8" (§65)
 *     rangedDefense?: { ac?, resistance?, attract? }
 *                                               O8d (§347): worn (and attuned) — `ac`: AC bonus against ranged
 *                                               attack rolls; `resistance`: Resistance to damage from attacks with a
 *                                               ranged weapon; `attract` (ft): an attack with a ranged weapon
 *                                               against a creature within this distance of the bearer targets them
 *                                               instead (curse).
 *     exclusiveWeapon?: true | { whileEffect }
 *                                               O8e (§348): the attuned item, its bearer has Disadvantage on attacks
 *                                               with their other weapons — always, or as long as a living creature
 *                                               in the scene bears the `whileEffect` effect of the item (Oathbow:
 *                                               the sworn enemy)
 *     minRange?: { value, units }               O8h (§351): minimum range — a target at this distance or less is a
 *                                               blocking legality issue, like out of range (Mangonel, Trebuchet:
 *                                               18 m)
 *     swornEnemy?: { effect }                   §353: a ranged attack with the weapon against the target bearing
 *                                               this effect from it (Oathbow) — Advantage, Half Cover or
 *                                               Three-Quarters Cover ignored, no Disadvantage at long range
 *     devours?: true                            §355: a creature (neither Construct nor Undead) that the weapon
 *                                               drops to 0 HP is killed and its bearer gains Temporary Hit Points
 *                                               equal to its maximum HP (Blackrazor)
 *     critFeeds?: { amount }                    §355: a Critical Hit of the weapon on a creature (neither Construct
 *                                               nor Undead) gives its bearer these Temporary Hit Points (Sword of
 *                                               Life Stealing: 15)
 *     maxSpellDamageVs?: string[]               §355: the object in the inventory, the damage of its bearer's
 *                                               spells against these creature types is maximized (Demonomicon of
 *                                               Iggwilv: Fiend)
 *     wrath?: { kind, save: { ability, dc } }   §356: attuned cursed weapon — wounded by another creature (in
 *                                               combat for `vengeance`), the bearer makes the save; failed, a
 *                                               "Furious Madness" / "Vengeance" mark against the author of the
 *                                               damage, lifted at the start of their turn when the wrath ends
 *                                               (runtime/wrath.mjs)
 *     hardToPerceive?: true                     O9g (§361): worn and attuned, the Perception check to spot the
 *                                               bearer has Disadvantage (passive −5; Cloak of Elvenkind)
 *     gmAlert?: { key | text, activities? } | [...]
 *                                               §364: on use of the item (or of these activities), the GM is alerted
 *                                               to what is theirs to handle (banner at the top of their screen,
 *                                               whispered card in DAS colors) — `key`: the text
 *                                               `DND5ECOMBAT.AlerteMJ.<key>`, `{actor}` and `{item}` filled in;
 *                                               `text`: a text as is (world overlay, neighboring module).
 *                                               runtime/gm-alert.mjs
 *     coats?: { activity, damage, damageTypes, seconds, ammunition? }
 *                                               O9h (§363): the `activity` activity coats a weapon (or `ammunition`
 *                                               ammunition) of the bearer, their choice; for `seconds`, the first
 *                                               damage roll of this weapon that carries one of the `damageTypes`
 *                                               receives the dice of the `damage` activity, then the coating falls
 *                                               (Basic Poison; runtime/coatings.mjs)
 *     castDuration?: { seconds }                O9h (§363): the spells the object makes cast last this long (effects
 *                                               and areas; Oil of Slipperiness: 8 hours)
 *     backfire?: { after, chance, activity, destroys? }
 *                                               O9h (§363): after one of the `after` activities, a d100; `chance` %
 *                                               or less, the `activity` damage activity strikes the bearer, and the
 *                                               object is destroyed (`destroys`; Horn of Blasting)
 *     breaksOn?: ("attack"|"damage"|"spell")[]
 *                                               the item's effects end when their bearer makes an attack roll, deals
 *                                               damage or casts a spell (Invisibility, §16.47)
 *     breaksOnActivity?: { [activityId]: ("attack"|"damage"|"spell"|"save"|"forcesSave")[] }
 *                                               §438: like `breaksOn`, but only for the effects applied by this
 *                                               activity ("Fading Stride": the Invisible condition drops,
 *                                               "Taunted" — applied by the same item — stays)
 *     breaksOnOrigin?: ("attack"|"damage"|"forcesSave")[]
 *                                               §366: the item's effects end on every creature when the one who
 *                                               applied them makes an attack roll, a damage roll or imposes a save
 *                                               through ANOTHER item (Friends) — runtime/breaks.mjs, active GM
 *     noReactions?: true                        the bearer of an item effect cannot take a Reaction (Arms of Hadar,
 *                                               §16.47)
 *     actionOrBonus?: true                      the bearer of an item effect takes only an action OR a Bonus Action
 *                                               on their turn, not both (§77: Dretch's Fetid Cloud, Slow)
 *     potionEffect?: <effect id>                the spell the potion makes cast only applies this effect (§53:
 *                                               Growth → "enlarge" of Enlarge/Reduce, Diminution → "reduce")
 *     effectStatuses?: { <effect id>: string[] | { set: string[] } }
 *                                               §96: conditions added to this item effect when it is applied
 *                                               ("Cowardly Spirit": the data's "Frightened" effect does not have the
 *                                               condition); §334: `set` replaces them ("Petrifying Ray": the
 *                                               "Restrained" effect carries Petrified)
 *     effectChanges?: { <effect id>: [{ key, type, value, replace?, unlessKey? }] }
 *                                               changes added to this item effect when it is applied (§53: Fly,
 *                                               Climb — the data does not give the speed); `value: "@walk"` = the
 *                                               bearer's walking speed; `unlessKey`: not if the effect already
 *                                               carries a change of this other key (§433); `replace`: replaces the
 *                                               change with the same key that the effect already carries (§195:
 *                                               Spider Climb, whose formula does not give the Speed); `ifCaster`:
 *                                               only if the caster bears an item with this identifier (C12-e:
 *                                               "Occult Hex")
 *     castTargets?: true                        the spell the potion makes cast targets normally (§53: Animal
 *                                               Friendship — "you can cast the spell" on a Beast), instead of the
 *                                               drinker
 *     curesAll?: string[]                       the use ends ALL these conditions on the target (§53: Elixir of
 *                                               Health, Potion of Vitality; "exhaustion" resets Exhaustion to zero)
 *     cures?: string[]                          the use ends ONE of these conditions on the target, their choice
 *                                               (Lesser Restoration, §16.47)
 *     curesOn?: <activity id>                   §288: `cures` only for this activity (Break Enchantment)
 *     endActivity?: { <effect id>: { activity, radius, units } }
 *                                               §367: when this item effect ends (duration, break, removal), the
 *                                               item's activity is used on the creatures within `radius` of its
 *                                               bearer, them excluded, without spending anything ("Spirit of the
 *                                               Shadow": "Emanate and End") — runtime/endings.mjs, active GM
 *     noRangedWeapons?: true | { fromPulse }    §367: in the item's area, no ranged attack with a weapon (neither
 *                                               from the area, nor into it); `fromPulse`: from this replay of
 *                                               `casterPulse` (Storm of Vengeance, turns 5 to 10) — legality issue,
 *                                               runtime/turn.mjs
 *     drawsOnEnd?: { <effect id>: <table uuid> }
 *                                               §289: when this item effect ends, the table is rolled (Living
 *                                               Shadow: "Will of the Shadow" at the start of the turn)
 *     catalyst?: { save, cast, effect }         §289: Second Skin — the GM declares the catalyst (token menu); at
 *                                               the start of the bearer's next turn, the `save` save; failed, the
 *                                               `cast` activity if a use remains, otherwise the `effect` effect
 *     endsOnUse?: [activity ids]                §288: using one of these activities ends the spell — the caster's
 *                                               Concentration on the item drops (Dismissal, Break Enchantment of
 *                                               Dispel Evil and Good)
 *     advantageIfFighting?: true                Advantage on the target's save if it is in combat against the
 *                                               caster or their allies (Charm Person, §16.47)
 *     emanation?: { on, affects?, sees?, radius?, radiusFormula?, units?, activity?, whileActive?, atStart? }
 *                                               monster aura that acts (§18.11, M7): at the end of the bearer's turn
 *                                               (`on: "ownTurnEnd"`, Fire Aura) or at the start of the turn of a
 *                                               creature that is in it (`"turnStart"`, Stench), the item's activity
 *                                               (default: the first save, damage or attack) plays on it. Radius: the
 *                                               template or the range of the activity; `affects: "enemy"`: "of their
 *                                               choice"; `sees`: the creature must see the bearer. The English text
 *                                               says the rest (core/emanation.mjs);
 *                                               §92: `radiusFormula` (read on the bearer, with `units`: the
 *                                               Paladin's Aura of Protection); `whileActive`: only while an item
 *                                               effect is on the bearer (Avenging Angel); §447 `atStart` (with
 *                                               `whileActive`): it also acts as soon as this effect arrives on the
 *                                               bearer ("Wild Wrath": "when you transform")
 *     afterTeleport?: { spells, options: [{ activity, around? }] }
 *                                               §92: after teleporting oneself with one of these spells
 *                                               (identifiers), the additional effect of the creature's choice (Fey
 *                                               Step) — the activity used on them, or (`around: "left"|"arrival"`)
 *                                               on the creatures within 1.5 m of the cell left or arrived at
 *     regeneration?: true|{ amount?, needsHp?, stoppedBy?, silveredBy?, stoppedByItems?, stoppedWhile?, survivesZero?, critical? }
 *                                               a monster's Regeneration (§18.13): the item's healing activity plays
 *                                               at the start of the turn; what stops it and "dies only at 0 HP
 *                                               without regenerating" are read from the English text
 *                                               (core/regeneration.mjs). B04: the declared form wins, key by key,
 *                                               over this reading — `amount` (number or formula, in place of that of
 *                                               the activity), `needsHp` (at least 1 HP), `stoppedBy` /
 *                                               `silveredBy` (damage types; from a silvered weapon),
 *                                               `stoppedByItems` (identifiers of the objects whose damage stops it:
 *                                               "holy-water"), `stoppedWhile` ("sunlight", "runningWater": does not
 *                                               work while the creature is in it), `survivesZero`, `critical` (a
 *                                               Critical Hit stops it)
 *     fortitude?: true                          Undead Fortitude (MM 2024, §61): damage that drops the bearer to
 *                                               0 HP makes them roll a Constitution save (DC 5 + damage taken),
 *                                               except radiant damage or a Critical Hit; on success, they stay at
 *                                               1 HP (core/fortitude.mjs)
 *     onDamageTaken?: { types, effect }         the bearer who takes damage of one of these types receives this item
 *                                               effect, without Reaction or question ("Frost", "Aversion to Fire";
 *                                               core/damage-traits.mjs)
 *     reducesForcedMove?: { distance, units }   the bearer can use their Reaction to shorten by that much a movement
 *                                               they suffer (push, pull) — Dwarven Plate; asked, never automatic
 *     castFromBearer?: { distance, units }      the caster's spell range is also measured from a creature carrying an effect
 *                                               of the item, when within that distance of the caster (Gaze of Two Minds)
 *     extraTurns?: { formula }                  in combat, use gives its author this number of turns in a row: the
 *                                               combat returns to them at the end of each (Time Stop;
 *                                               core/extra-turns.mjs)
 *     damageByCount?: { <activity id>: { from: <activity id>, formulas: [formula, …] } }
 *                                               the activity's damage by the number created at the `from` activity (1 + its
 *                                               scaling), noted on the item (Ring of Shooting Stars; core/damage-by-count.mjs)
 *     targetedSummon?: true                     §394: the summon activity is targeted with a click (Finger of Death:
 *                                               the corpse); without it, a summon never targets, whatever its data
 *                                               says
 *     placesSummons?: true                      §109: the summon is always placed, even when the activity says
 *                                               otherwise (`summon.prompt: false`: "place" checkbox unchecked, which
 *                                               use without a window no longer lets you check — Conjure Animals)
 *     sharesSpace?: "enter"|"mutual"            §105: enters another creature's cell and stops there; "mutual":
 *                                               the reverse too (Swarm) — by its presence on the sheet, or through
 *                                               the effect of a spell (Gaseous Form; adapter/space-sharing.mjs)
 *     noOpportunity?: "always"|"flying"|"afterUse"|"whileEffect"
 *                                               does not provoke Opportunity Attacks (§18.15): always ("Nimble"), as
 *                                               long as it bears an item effect (§74, Zephyr Strike), while flying
 *                                               (Flyby), or the rest of the turn after using the item ("moves …
 *                                               without provoking Opportunity Attacks", read from the text)
 *     drain?: true                              max HP drain (§18.16): "equal to the [necrotic] damage taken", or a
 *                                               formula on a failed save; the vampire regains what they drain —
 *                                               read from the English text (core/drain.mjs)
 *     swallow?: true                            Swallow / Engulf (§18.17): the item effect that carries Total Cover
 *                                               (or Grappled) makes the target swallowed — placed in the swallower,
 *                                               who carries them; damage each turn, regurgitation threshold, read
 *                                               from the English text (core/swallow.mjs)
 *     saveDamage?: { <activity id>: "none"|"half" }
 *                                               §92: the damage on a successful save, when the data says something
 *                                               else than the rule ("Dreadful Stride": "on pain of taking 2d10" —
 *                                               nothing on a success)
 *     savedEffects?: string[]                   ids of item effects applied only on a SUCCESSFUL save (and never on
 *                                               a failure): Ray of Enfeeblement — "on a success, Disadvantage on its
 *                                               next attack roll"; dnd5e's data puts both effects on the activity,
 *                                               without `onSave`
 *     sharedHp?: true                           the creatures of the scene that bear an item with this identifier
 *                                               share their HP (§19.5: any damage taken by a member is removed from
 *                                               the shared HP) — the gap taken by one is carried over to the others
 *                                               (core/coven.mjs)
 *     secondPhase?: { activity }                at 0 HP, no Death: the item's "transform" activity (id) changes the
 *                                               creature into the form of its profile, at its max HP, same token
 *                                               (same Initiative), conditions kept (§19.5: second phase)
 *     afterUse?: { onlyCantrips: true | { castTime: "action"|"bonus" }, activity? }
 *                                               §503 (B23): after using this item (or the `activity` activity, a
 *                                               spell cast through a "cast" activity included), on their turn: no
 *                                               more spell this turn, except a cantrip (of this casting time) —
 *                                               forceable refusal
 *     grapples?: { one?: true, by?: "summon" }
 *                                               §502 (B22): `one` — only one creature grappled at a time by the
 *                                               effects of this item (a new grapple releases the old one, with a
 *                                               notice); `by: "summon"` — the grapple is held by the grappler's
 *                                               summon (the vine): it holds as long as the latter is in the scene
 *                                               and not Incapacitated, whatever the distance to the grappler
 *     changesForm?: { activity, keepHp? }       on use of this "transform" activity (id), the creature takes the
 *                                               form of its profile as a second phase (same token, form's max HP,
 *                                               conditions kept unless `keepConditions: false`) — a true form
 *                                               revealed at will (§76); `keepHp` (§78, here and in `secondPhase`):
 *                                               the form keeps the current HP ("its profile stays the same in each
 *                                               form": a lycanthrope), at 0 HP included
 *                                               §498 (B18): `revertAfter: { rounds | seconds, auto? }` — the form
 *                                               lasts this long (world time, one round = 6 s), then the token
 *                                               returns to its original form (actor, appearance, HP kept if
 *                                               `keepHp`, otherwise those from before) with a notice and sound;
 *                                               `auto: false`: only a reminder to the GM, return through "Revert to
 *                                               own form" (token menu, always offered); `shareSpellSlots: true`:
 *                                               the slots spent in one form stay spent in the other
 *     failMargins?: { <effect id>: { min?, max? } }
 *                                               the effect of the save activity only goes to whoever failed it by
 *                                               `min` or more (and by `max` at most): "if a creature fails the roll
 *                                               by 5 or more, it is also Frightened" (§19.6); an outcome step says
 *                                               it with `margin`
 *     orders?: string[]                         orders of the author's choice, imposed on whoever fails the save,
 *                                               played on their turn (Command: approach, drop, flee, grovel, halt —
 *                                               core/orders.mjs, §16.59)
 *     resize?: { <effect id>: <steps> }         the effect changes the size of its recipient by this number of
 *                                               categories (+1: Enlarge, -1: Reduce, §16.58); dnd5e resizes the
 *                                               token
 *     reactions?: { perRound, loseOne? }        reactions per round, no more than one per game turn (for example
 *                                               three); §501 `loseOne: true`: Incapacitated or a `noReactions`
 *                                               effect only removes one of them (when the effect is applied),
 *                                               instead of all
 *     lastStand?: { threshold }                 reaction when HP drop to `threshold` or less (makes
 *                                               `target.hpAtMost`): its effects end; at 0 HP, played automatically,
 *                                               the creature stays at 1 HP ("Amulet of Ravenloft") — the item has
 *                                               uses, one each time
 *     forOneAttack?: true                       the effects that the item applies to its bearer only last for the
 *                                               attack that opened the reaction: removed as soon as the AC is
 *                                               re-read (Parry: "+5 to its AC against one attack")
 *     basicActions?: { <id d'activité>: "dash"|"disengage"|"dodge"|"hide" | [...] | { choose: [...] } }
 *                                               the activity takes this basic action, at the cost of its activation
 *                                               ("Swift Step": Dash or Disengage as a Bonus Action; Cunning Action
 *                                               of the Rogue: Hide too, §20); a list: all at once (Patient
 *                                               Defense); `{ choose }`: only one, the author's choice on use
 *                                               (Nimble Escape: Disengage OR Hide, §65)
 *     ignoresCloseCombat?: true                 the item's bearer has no Disadvantage on ranged attacks when an
 *                                               enemy is in melee contact (ability declared by a third-party
 *                                               creature module)
 *     (aura) whileActive?: true                 the aura is only held while the caster bears an effect of the item
 *                                               (Concentration included): Pass without Trace, §16.47
 *     hitDiceHeal?: { activity, base }          after `activity`, spend Hit Dice to heal (`base` dice, +1 per spell
 *                                               slot level above the spell: Arcane Vigor, §16.46)
 *     pact?: { damageTypes, ability? }          pact weapon (§16.45): the damage type is chosen at the pact among
 *                                               `damageTypes` (or the normal type), the weapon's attacks read
 *                                               `ability`
 *     enchantTarget?: "weapon" | "ownWeapon" ("ownWeapon": their own weapons, or a summoned weapon — §16.45)
 *     enchantTarget (weapon)                    the enchantment targets the weapon of a chosen creature (§16.41,
 *                                               Elemental Weapon): a click on the creature (themselves included),
 *                                               then the list of its weapons
 *     trace?: true | { activity?, show?, attack? }
 *                                               (§16.41) `activity`: only for this activity (Flame Blade: "Summon a
 *                                               blade", not the attack); `show`: the icon on the token; `attack`:
 *                                               the attack activity offered in the right-click menu as long as the
 *                                               trace is there. A trace of a Concentration spell drops with it.
 *     trace (true)                              use leaves on the caster a "trace" effect (name, image, duration of
 *                                               the item) that carries its `via: "effect"` declarations — for a
 *                                               spell that applies no effect (Armor of Agathys, §16.9)
 *     empower?: { damageType, effect, excludeTypes? }
 *                                               empowering bite (§19.9, Dhampir's Vampiric Bite): when the item's
 *                                               weapon deals `damageType` damage to a creature of a type other than
 *                                               `excludeTypes`, and the item has a use left, the author chooses:
 *                                               regain as many HP, or receive the item's `effect` effect, its
 *                                               changes taking this amount, until their next attack roll or ability
 *                                               check (1 minute)
 *     discharge?: { effect, formula, damageTypes, sees? }
 *                                               the item's `effect` effect, placed on a creature, can be spent by
 *                                               its caster when they or an ally (`sees`: whom they see) hit it with
 *                                               an attack roll: the effect ends and the target takes `formula`
 *                                               (caster's data), of a chosen type (Path to the Grave, §19.9)
 *     sneakAttack?: true | { dice?, anyWeapon?, alwaysVs? }
 *                                               Sneak Attack (§20): once per turn, the item's dice (its first
 *                                               damage part, otherwise ⌈Rogue level / 2⌉d6) are added to an attack
 *                                               that hits with a Finesse or ranged weapon, with Advantage or an ally
 *                                               within 1.5 m of the target; item (§72, NPC): `dice` ("5d6"),
 *                                               `anyWeapon` (any weapon), `alwaysVs` (creature types against which
 *                                               neither Advantage nor ally is required: ["undead"])
 *     sneakBonus?: { formula, firstRound? }     an extra part when the Sneak Attack hits (of the weapon's type);
 *                                               `firstRound`: only in the first round of combat (Assassinate:
 *                                               "equal to your Rogue level")
 *     cunningStrikes?: { <key>: { cost, activity?, requires?, sizeAtMost?, withdraw?, keepsHidden? } }
 *                                               Cunning Strike (§20): effects paid in Sneak Attack dice, chosen by
 *                                               the author before their damage; `activity`: the item's save played
 *                                               on the target after the damage; `requires`: identifier of an item
 *                                               the author must have (poisoner's kit); `sizeAtMost`: maximum size
 *                                               of the target; `withdraw`: the author moves half their Speed
 *                                               without provoking Opportunity Attacks
 *     cunningStrikeMax?: number                 number of Cunning Strikes per Sneak Attack (Improved Cunning
 *                                               Strike: 2)
 *     evasion?: true                            Evasion (§20): Dexterity save for half damage — nothing on a
 *                                               success, half on a failure; not if the bearer is Incapacitated
 *     avoidance?: true                          §334: Avoidance (Displacer Beast) — like `evasion`, for any save for
 *                                               half damage
 *     elusive?: true                            Elusive (§20): no attack roll has Advantage against the bearer,
 *                                               unless they are Incapacitated
 *     holdsStill?: true                         after use, the user's Speed is 0 until the end of the turn (Steady
 *                                               Aim, §20)
 *     grantsAction?: true                       use gives one more action to the turn's budget (Action Surge, §21)
 *     movesAfter?: string | { item, disengage? }
 *                                               after a use by Bonus Action of the item with this identifier, half
 *                                               the Speed in extra movement, without Opportunity Attacks (Tactical
 *                                               Shift, §21); `disengage: false`: with no protection against
 *                                               Opportunity Attacks (Instinctive Pounce, §22)
 *     rage?: { effect }                         the Barbarian's Rage (§22): the item effect that carries it; the
 *                                               engine tracks its duration
 *     persistentRage?: true                     Rage does not need to be maintained, and only Unconscious ends it
 *                                               (§22)
 *     reckless?: true                           Reckless Attack (§22): on the first Strength attack of the turn,
 *                                               the choice to attack recklessly
 *     relentless?: { activity }                 Relentless Rage (§22): at 0 HP while Raging, the item's save (id);
 *                                               on success, 2 × the Barbarian level in HP
 *     studiedAttacks?: true                     a missed attack roll gives Advantage on the next one against the
 *                                               same creature, until the end of the next turn (Studied Attacks, §21)
 *     heroicWarrior?: true                      in combat, Heroic Inspiration at the start of their turn if they do
 *                                               not have it (§21)
 *     greatWeaponFighting?: true                damage dice of a two-handed melee weapon: 1 and 2 count as 3 (§21)
 *     thrownDamage?: number                     bonus to the damage of a ranged attack with a thrown weapon (§21)
 *     effectEnds?: { <effect id> | "status:<condition>": "casterTurnStart"|"casterTurnEnd"|"bearerTurnStart"|"bearerTurnEnd"
 *                    |"currentTurnEnd" }
 *                                               (`status:stunned`: the condition applied by a `status` step of the
 *                                               item, §157) the item's effect ends at the start of the caster's next
 *                                               turn, at the end of their next turn, at the start or end of the
 *                                               bearer's next turn (Ray of Frost, Chill Touch, §23; Haste's
 *                                               lethargy, §42.2)
 *     actionEnds?: { <effect id>: { by: "bearer"|"other", roll?: "save"|"check", verb?: "wake", status?: "prone" } }
 *                                               an action ends this item effect (§43.2) — `by: "bearer"`: the
 *                                               bearer (`roll: "save"`: they replay the spell's save, Otto's
 *                                               Irresistible Dance; `roll: "check"`: the check written in the
 *                                               item's text; without `roll`: the effect ends, Gaseous Form);
 *                                               `by: "other"`: another creature in contact (without `roll`: shaking
 *                                               a sleeper — `verb: "wake"` for the label; `roll:
 *                                               "check"`: Ensnaring Strike); `status`: the condition the bearer
 *                                               gives themselves by ending it (§49, Alchemist's Fire: "by
 *                                               inflicting the Prone condition on yourself"); §288: `spell` — the
 *                                               effect ended, the spell ends (caster's Concentration); `turnStart`
 *                                               — the action is offered to the bearer at the start of their turn
 *                                               (Maze: banished, their token is hidden)
 *     afterSmite?: { effect, smites? }          §273: when one of the named smites (identifiers; all without
 *                                               `smites`) of its bearer hits, this item effect is applied to them
 *                                               (Smite of Protection)
 *     wardsConditions?: { types, statuses }     §268: the bearer of an item effect is immune to these conditions
 *                                               when they come from a creature of these types (Protection from Evil
 *                                               and Good: Charmed, Frightened)
 *     noAttacksOrSpells?: true                  §269: the bearer of an item effect can neither attack nor cast
 *                                               spells (Gaseous Form) — a legality issue, the item itself excepted
 *     noTeleport?: true                         the bearer of an item effect cannot teleport (Dimensional
 *                                               Shackles): forceable refusal of the teleports the engine knows
 *     noSpells?: true                           §284: the bearer of an item effect can neither cast spells nor take
 *                                               the Magic action ("Alienation") — a legality issue on spells and
 *                                               magic items
 *     panic?: { effect?, drop?, endsAt? }       §285: the bearer of an item effect (`effect`: that one) takes the
 *                                               Dash action and moves away from the caster on each of their turns;
 *                                               `drop`: they drop what they hold on the failed save; `endsAt`
 *                                               ({ distance, units }): the effect ends at this distance from the
 *                                               caster, out of their sight (Fear, Evil Eye)
 *     confusion?: <effect id>                   §285: the bearer of this effect rolls 1d10 at the start of their
 *                                               turn (Confusion table)
 *     noBonus?: <effect id>                     §285: the bearer of this effect has no Bonus Action (Confusion)
 *     forcedAttack?: <effect id>                §285: at the start of their turn, the bearer must make a melee
 *                                               attack against a creature that the caster chooses (reminder; Crown
 *                                               of Madness)
 *     upkeep?: true                             §285: on their later turns, the caster maintains the spell with a
 *                                               Magic action (menu of their token), otherwise their Concentration
 *                                               drops at the end of their turn (Crown of Madness)
 *     keepsProne?: true                         §285: the bearer of an item effect cannot end the Prone condition
 *                                               (Tasha's Hideous Laughter)
 *     knownToOrigin?: true                      §284: the bearer of an item effect cannot Hide from the item's
 *                                               caster, and the Invisible condition is of no use to them against
 *                                               them (Mind Sliver)
 *     singleAttack?: true                       §267: the bearer of an item effect makes only one attack per Attack
 *                                               action (Slow; an NPC with Multiattack keeps their plan)
 *     spellFailure?: { chance, component? }     §283: a spell cast by the bearer of an item effect fails on a d100
 *                                               ≤ chance (only if it has the named component: Slow, 25% for
 *                                               "somatic") — nothing is cast or spent, like a countered spell
 *                                               (runtime/gates.mjs)
 *     untypedDamage?: <type>                    §283: a damage roll of the item that the data leaves untyped takes
 *                                               this type, before the roll (Otiluke's Freezing Sphere: 10d6
 *                                               untyped → cold; Resistances and Immunities apply)
 *     banishes?: [effect ids]                   §265: these item effects carry their bearer to a demiplane — token
 *                                               and combatant hidden as long as they last, return to the space left
 *                                               (or the nearest free one) when they end (Banishment, Banishing
 *                                               Smite)
 *     endsWhen?: { armor?: "any"|"heavy", apart?: { distance, units, at?: "move"|"casterTurnEnd" },
 *                  zeroHp?: true|"bearer"|"caster"|"either",
 *                  unaffected?: "failedSave"|"noHits"|"noTargets", spell?: true, casterTargetsOther?: true, allyDamages?: true,
 *                  healedByMagic?: true }
 *                                               §258: generic endings (core/endings.mjs, runtime/endings.mjs) — the
 *                                               item's effect ends when its bearer dons armor (`heavy`: heavy; Mage
 *                                               Armor, Rage), when bearer and caster are separated by more than
 *                                               `apart` (on each movement, or at the end of the caster's turn:
 *                                               Warding Bond, Compelled Duel), when either one drops to
 *                                               0 HP (`zeroHp`; `"caster"`: the caster only, Warding Bond);
 *                                               `unaffected`: the use affected no one, the Concentration drops
 *                                               (setting `endUnaffected`); `spell`: the ending applies to the whole
 *                                               spell (its Concentration, or its effects on each creature), not to
 *                                               this bearer alone;
 *                                               §270 `casterTargetsOther`: the caster attacks another creature, or
 *                                               casts a spell on another enemy; `allyDamages`: an ally of the
 *                                               caster hurts the bearer (Compelled Duel);
 *                                               §495 `healedByMagic`: the bearer receives magical healing (spell,
 *                                               magic item, potion, ability called `magical`)
 *     effectThen?: { <effect id>: <effect id> }
 *                                               when the item's first effect ends on a creature, the second is
 *                                               applied to it (Haste: "when the spell ends, the target is
 *                                               Incapacitated…", §42.2)
 *     blocksHealing?: true                      the bearer of an item effect does not regain HP (Chill Touch, §23)
 *     blocksTempHp?: true | [effect ids]        §505 (B25): does not receive Temporary Hit Points — the creature
 *                                               that bears the trait, or the bearer of an item effect (swarms:
 *                                               "can't gain Temporary Hit Points")
 *     noOpportunityAttacks?: true|string[]      the bearer of an item effect (or of these effects: "Staggering
 *                                               Blow") does not make Opportunity Attacks (Shocking Grasp)
 *     byWounds?: { healthy, wounded }           two activities (ids): the damage is that of `wounded` against a
 *                                               wounded target, of `healthy` otherwise, whichever one is used (Toll
 *                                               the Dead, §23)
 *     oneAttack?: true                          the item's enchantment lasts for one attack: the attack is offered
 *                                               at once, and the enchantment ends after it (True Strike, §23)
 *     martialArts?: true                        Martial Arts (§24): an Unarmed Strike can be paid for with the
 *                                               Bonus Action
 *     flurry?: { activity, strikes, weapons? }  Flurry of Blows (§24): the activity (or one from a list, §438) opens
 *                                               `strikes` free strikes; `weapons`: weapon attacks too (War Priest,
 *                                               §27)
 *     stunningStrike?: { activity, focus }      Stunning Strike (§24): after a hit, once per turn, the item's save
 *                                               against a use of the `focus` item (identifier)
 *     openHand?: { addle, push, topple }        Open Hand Technique (§24): after a Flurry hit, one of the three
 *                                               activities
 *     smite?: { damage, fiends?, save?, effect?, ranged?, burst?, saveAtMostHp?, replaces?, onMiss?, blast? }
 *                                               smite spell (§25): offered on the damage roll of a melee hit, its
 *                                               dice (`damage` activity, or `fiends` against a Fiend or an Undead)
 *                                               are added to the roll, then the `save` save plays on the target;
 *                                               `effect`: the item effect applied to the target hit, without a save
 *                                               (burn from Searing Smite, §42.2); `saveAtMostHp` (§262): the save
 *                                               only plays if the hit leaves the target at this number of HP or
 *                                               fewer (Banishing Smite: 50); §288: `replaces` — its dice replace
 *                                               those of the weapon; `onMiss: "half"` — also offered after a miss,
 *                                               the target takes half; `blast` — each creature within `radius` of
 *                                               the target makes the save `ability` against the dice of the
 *                                               `activity` activity, half on a success (Lightning Arrow)
 *     healsDownedMax?: true                     the item's bearer heals a creature at 0 HP for the maximum of the
 *                                               dice, with a spell or a Channel Divinity (Circle of Mortality of the
 *                                               Grave Domain, §19.9)
 *     dispel?: true                             Dispel Magic (§37.2): the ongoing spells on the targets end —
 *                                               automatically up to level 3 or the slot's level, otherwise by a
 *                                               check of the spellcasting ability against DC 10 + level
 *                                               (core/dispel.mjs)
 *     dispel?: { upTo, beyond?, keepBySlot? }   §496: bounded dispelling — automatically up to level `upTo`
 *                                               (whatever the slot); beyond, `beyond: "none"`: nothing, no check,
 *                                               `"check"` (default): the check above; `keepBySlot: true`: the
 *                                               creature concentrating on a spell that would end can, with their
 *                                               Reaction, spend a level 1+ spell slot to keep it
 *     counter?: { level? }                      Counterspell in the 2014 manner (§66, SRD 5.1): the item, used as a
 *                                               reaction at the gate `castsSpell`, automatically makes a spell of
 *                                               level `level` or lower fail (default: the item's level); beyond, a
 *                                               spellcasting ability check by the one countering, DC 10 + the
 *                                               spell's level (core/counter.mjs) — no save for the caster
 *     contest?: { activity?, skill, against, effect, exclusive? }
 *                                               opposed check (§72, Insightful Fighting): the author rolls `skill`,
 *                                               the target the best of `against` (at their player if connected);
 *                                               won, the activity's `effect` effect is placed on them (`exclusive`:
 *                                               those placed elsewhere end)
 *     zoneCharges?: n                           the lasting area ends after n triggerings (§75); §303: or a formula
 *                                               of the casting level (Cordon of Arrows: "2 * @item.level")
 *     pendingDie?: { activity, against: "melee"|"target" }
 *                                               §89: the activity promises its die to the next damage roll of an
 *                                               attack by the author this turn, in melee or against the designated
 *                                               target (Lunging Attack, Feinting Attack of the Battle Master;
 *                                               runtime/maneuver-dice.mjs)
 *     maxDamage?: { activity, weapons?, refundOnHit? }
 *                                               §279: the activity promises the maximum of the dice on the author's
 *                                               next attack this turn with a weapon of these kinds (`weapons`:
 *                                               "unarmed", "simpleM", "improv"… — WEAPON_KINDS); on a hit,
 *                                               `refundOnHit` returns the uses the activity cost; on a miss, the
 *                                               promise is lost (runtime/maneuver-dice.mjs)
 *     hitFollowUp?: { use: [{ item, activity }], choose?, weapons? }
 *                                               §373: after a hit that lands (attack of these weapon kinds), the
 *                                               author can use for free against the target still standing up to
 *                                               `choose` (1) of the listed activities (item by identifier) —
 *                                               Crusher: Grapple or Shove of the Unarmed Strike. Several items: a
 *                                               single question, the union of the activities, the largest `choose`
 *     maxNextHit?: true | <effect id>           §279: the bearer of an item effect takes the maximum of the dice of
 *                                               the next attack that hits them, then the effect ends; §372: an id —
 *                                               only the bearer of this effect
 *     grappleSize?: { bonus?, dragFree? }       §281: the author counts as `bonus` sizes larger for Grapple and
 *                                               Shove; they drag without extra cost a victim at most `dragFree`
 *                                               sizes larger than them ("Heavyweight": 1 and 0)
 *     inescapable?: true | { activity }         §281: saves against their Grapple or Shove, and checks to escape
 *                                               their hold, have Disadvantage ("Inexorable"); §374: `{ activity }`
 *                                               — only if the grappler wants it, before the roll, by paying what
 *                                               this item activity costs
 *     grappleCover?: "half"|"threeQuarters"     §281: while they grapple a creature, this Cover against attacks
 *                                               from creatures they do not grapple ("Flesh Shield"); supplies
 *                                               `source.grappledByTarget` to react at the end of the turn of an
 *                                               enemy they grapple (`enemyTurnEnd`)
 *     weaponDamageTypes?: { weapons, types }    §279: an attack by the author with a weapon of these kinds can take
 *                                               one of these damage types, offered along with its own before the
 *                                               roll (like `spellDamageTypes`)
 *     rolledAc?: { activity, effect, to? }      §89: the activity rolls the die of its `roll` and applies the item
 *                                               effect to the author, the AC bonus written in it (Evasive
 *                                               Footwork); §90 `to: "choose"`: on the author or on the targeted
 *                                               creature, the author's choice ("Crossover")
 *     swapPlaces?: { activity }                 §90: the activity swaps the places of the author and the targeted
 *                                               creature ("Crossover": 1.5 m of movement for the author, without
 *                                               Opportunity Attacks)
 *     sweep?: { activity }                      §90: after a melee hit (weapon, unarmed), the author can deal the
 *                                               die of the activity, of the hit's type, to another creature within
 *                                               1.5 m of the target and within their reach, if the roll would have
 *                                               hit it (Sweeping Attack); the activity pays
 *     commandStrike?: { activity }              §90: the activity orders the targeted creature to make a weapon
 *                                               attack with their Reaction, its die promised to the damage
 *                                               (Commander's Strike; with `replacesAttack`)
 *     selfZone?: { <activity id>: { type, size, units } }
 *                                               the template of an activity that has none in the data (§86,
 *                                               Yolande's Royal Presence: 10 ft Emanation on self) — placed
 *                                               automatically (§47); §91: out of personal range, placed with the
 *                                               mouse (Forbiddance)
 *     zoneAffects?: "enemy"|"ally"              who the item's area affects, when the data does not say (§86: "a
 *                                               creature you can see… you can force it" — allies spared)
 *     dropsEffects?: [effect ids]               §334: these item effects are never applied — the data gets the
 *                                               condition wrong ("Draconic Strike": Prone instead of Frightened,
 *                                               which the text has applied)
 *     noDamage?: [activity ids]                 the engine does not roll the damage of these activities (§81,
 *                                               Ensnaring Strike: the data puts some on the save, the text only
 *                                               gives any at the start of turns)
 *     wardsAtZero?: true                        the spell's effect drops to 1 HP instead of 0, then ends (§73,
 *                                               Death Ward)
 *     stableAtZero?: true                       a target that the attack drops to 0 HP is Stabilized: no death save
 *                                               or death, even an NPC (§71, Shadow Dagger of the Vampire Familiar)
 *     effectsIf?: condition                     the attack's effects only apply if the condition holds for the
 *                                               target, judged after the damage (§71: `{ "target.atZero": true }`)
 *     storm?: { bonus? }                        storm (§70, Call Lightning): the item's area is a cloud that stays
 *                                               (Concentration); each cast targets a bolt (`bolt`) below it;
 *                                               `bonus`: dice added when the storm was already there (question on
 *                                               casting); `strike` (§469): the bolt's activity when the casting one
 *                                               only places the cloud (Handbook 3.0.0); `stormStrike`: its "storm
 *                                               already there" variant, which already carries the extra die (no
 *                                               `bonus` added)
 *     difficultTerrain?: { types?, cost?, fromPulse? }
 *                                               the spell's area is Difficult Terrain (§69) — `fromPulse`: only from
 *                                               this replay of `casterPulse` (Storm of Vengeance); `cost` (§172): a
 *                                               different multiplier than ×2 (Wall of Thorns: ×4), through the V14
 *                                               core's "movement cost" behavior in place of dnd5e's; otherwise the
 *                                               `dnd5e.difficultTerrain` behavior placed on the region if the data
 *                                               does not have it (premium Player's Handbook: Entangle, Spike
 *                                               Growth…); magical;
 *                                               `lingers: "casterNextTurnEnd"` (§261): an instantaneous area leaves
 *                                               this terrain until the end of the caster's next turn (Ice Storm);
 *                                               `enemiesOnly` (§403): the caster's disposition passes free of charge
 *                                               (Conjure Minor Elementals: "for your enemies")
 *     encloses?: true                           §232: an effect of this item encloses its target (Otiluke's
 *                                               Resilient Sphere) — nothing reaches them from outside, they reach
 *                                               nothing outside ("unaffected" resolutions, clicks refused).
 *     willingFails?: true                       §232: a willing creature can fail the save automatically — the
 *                                               caster says, on opening, whether each non-enemy target consents (no
 *                                               roll).
 *     zoneEffects?: true                        the activity's effects are held as long as one is in its area
 *                                               (§37.4, Silence): `applyActiveEffect` behavior of the core
 *                                               (adapter/zone-effects.mjs)
 *     rollBonus?: { activity, on, skills? }     a die the creature adds to THEIR roll, after seeing it (§38, Dark
 *                                               One's Own Luck): the activity's roll (`roll.formula`), which spends
 *                                               its consumptions; `on`: "save" (failed, read by the engine),
 *                                               "attack" (failed, §90 Precision Attack), "check" (any check, as
 *                                               soon as rolled), "initiative" (§90); `skills`: the only skills
 *                                               whose check counts (Ambush: ["ste"]); §94 `statuses`: a save only
 *                                               to avoid or end one of these conditions (Survivor);
 *                                               §129 `luck: true` — no die from the activity: the d20 is rerolled
 *                                               and the best kept (Lucky: Advantage, decided after seeing the
 *                                               roll); the positive gap is added;
 *                                               gap survey `reroll: { bonus, during }` — without an activity: the
 *                                               d20 rerolled, `bonus` added, the new roll imposed, once per effect
 *                                               of the item `during` (Fanatical Focus: failed save while Raging,
 *                                               Rage damage bonus)
 *                                               §280: `reroll: { bonus?, advantage? }` WITH an activity — it pays
 *                                               for the reroll of a failed roll, the new one imposed
 *                                               ("Unshakable"); `advantage: true` — the new roll has Advantage
 *                                               (Countercharm); `failRefund: true` — the die added to a check that
 *                                               stays failed (known DC): what the activity cost comes back, the
 *                                               item loses a use ("Bravado");
 *                                               `abilities` also applies to checks (the check's ability)
 *                                               `spellAttack: true` — only the attack roll of a spell ("Seeker
 *                                               Spell")
 *     transpose?: { summon }                    swap places with the piloted summon of the item `summon`
 *                                               (identifier), when the Bonus Action creates or moves it (§38.2,
 *                                               "Trickster's Trade"; core/pilot.mjs)
 *     portent?: { dice }                        Portent (§36): `dice` d20 noted at each Long Rest (Portent: 2;
 *                                               Greater Portent: 3), which can replace a d20 Test (core/portent.mjs)
 *     metamagic?: { activity, kind }            Metamagic option (§32): the activity holds `kind` for the next spell
 *                                               of the Sorcerer (`METAMAGIC_KINDS`)
 *     endurance?: true | { effect?, tempHp?, restores? }
 *                                               Relentless Endurance (§31): dropped to 0 HP without being killed
 *                                               outright, the bearer stays at 1 HP, one use of the item spent; §371:
 *                                               then `effect` (item effect) applied to them, `tempHp` (formula,
 *                                               actor's data) as Temporary Hit Points if they exceed theirs, the
 *                                               uses of the `restores` items (identifiers) restored
 *     replacesAttack?: true | string[]          the activity replaces an attack of the Attack action (Breath, §31);
 *                                               a list: these activities only (§188, Oil: the throw, not the
 *                                               spreading on the ground)
 *     hitRider?: { damage?, effect?, status?, sizeAtMost?, slot?, weapon?, oncePerTurn?, save?, item?, whileActive? } | [...]
 *                                               boon offered on the damage roll of an attack that hits, against a
 *                                               use of the item (Giant Ancestry, §31): the dice of the activity
 *                                               `damage`, then the item's `effect` effect or the `status` condition
 *                                               applied to the target (of size `sizeAtMost` at most — the damage
 *                                               applies whatever the size).
 *                                               `slot: "pact"`: costs a pact slot instead of a use (dice read at
 *                                               the slot's level); `weapon`: only with a weapon enchanted by the
 *                                               item with this identifier ("pact-of-the-blade"); `oncePerTurn`
 *                                               (Eldritch Strike, §47 bis); §78: `save` — the item's save activity,
 *                                               then played against the target still standing; `item` — only with
 *                                               the weapon with this identifier; §129 `unarmed` — only an Unarmed
 *                                               Strike; `push` — the target hit is pushed back by `{ distance,
 *                                               units }` (Tavern Brawler); §132 `melee`, `shield` (shield
 *                                               equipped), `damageType` (the attack deals it), `sizeAbove` (target
 *                                               at most N sizes larger); an item with no maximum uses is offered
 *                                               without counting ("Dive": the GM judges the trajectory); §87:
 *                                               `pays` — the identifier of the item whose use pays for the boon
 *                                               (the maneuvers: the dice of `combat-superiority`); `weaponDamage` —
 *                                               the dice have the weapon's damage type; a boon with `sizeAtMost`
 *                                               only plays its save against a small enough target
 *                                               §372: a list of exclusive options from the same item (at least two,
 *                                               each with `name`, the activity that names it), sharing its "once
 *                                               per turn" mark; `formula` — its own dice ("1d12"); `weapons` — only
 *                                               an attack of these weapon kinds (`WEAPON_KINDS`);
 *                                               `perTurn: { count, while }` — the limit per turn goes to `count`
 *                                               while an item effect `while` is borne (with `oncePerTurn`)
 *     cellWall?: true                           §172: wall one cell thick (Wall of Thorns, Blade Barrier) — placed
 *                                               on a row of cells (centers, no diagonal, ends extended by half a
 *                                               cell); its ring, drawn from a disc, is a band inside the circle
 *     coverThrough?: degree | { degree, against }
 *                                               §172: the area gives this cover ("half", "threeQuarters", "total")
 *                                               to whoever is behind it (a line between the attacker and the target
 *                                               that crosses it, neither one inside) — Blade Barrier;
 *                                               `against: "rangedWeapon"` (§173): against ranged attacks with a
 *                                               weapon only (Wall of Wind: projectiles miss)
 *     thinWall?: true                           §173: a thin wall (Wall of Wind, Stone, Ice, Force, Prismatic Wall)
 *                                               — placed without diagonal; on appearing, creatures whose space
 *                                               touches the wall are in the area; one "enters" it by crossing it; a
 *                                               globe's disc becomes a thin ring
 *     wallAura?: { distance, units, activity, on }
 *                                               §173: an area of `distance` on both sides of the wall, which replays
 *                                               the sibling activity at the `on` moments (Prismatic Wall: blindness
 *                                               save at 6 m)
 *     wallSide?: { distance, units }            §169: wall with a burning face (Wall of Fire) — placed without
 *                                               diagonal; on appearing, save of the creatures whose space touches
 *                                               the wall; afterwards, without a save: whoever crosses it (once per
 *                                               turn), whoever ends their turn within `distance` of the burning side
 *                                               (separate region, flippable from the caster's menu)
 *     pointWall?: false                         §162: a "wall" template that is not a wall (portals, doors) — no
 *                                               placement by points
 *     walls?: { move?: false, sight?: true, activities? }
 *                                               §162: the area placed by the item raises core walls (along a wall
 *                                               placed by points, otherwise around its perimeter): they stop
 *                                               movement (except `move: false`) and, with `sight`, sight and light;
 *                                               `activities`: only the areas of these activities
 *     blink?: <effect id>                       §161: Blink — the spell's effect carries the duration; 1d6 at end of
 *                                               turn, 4–6: Ethereal until the start of the next turn
 *                                               (runtime/blink.mjs)
 *     globe?: { radius, units, maxLevel, everywhere? }
 *                                               §161: while the caster bears an item effect, a spell of level
 *                                               `maxLevel` or lower cast from outside the Emanation affects no one
 *                                               in it (Globe of Invulnerability); §163 `everywhere`: wherever it is
 *                                               cast from, and no spell is cast in it (Antimagic Field)
 *     magical?: true                            §436: the item's activities are magical (Magic action, a monster's
 *                                               magical effect): the dnd5e `antimagic` status refuses them to
 *                                               whoever is in it and protects whoever is in it
 *     antimagicZone?: true                      §436: the region of an item's activity receives the system's
 *                                               `dnd5e.antimagic` behavior when the activity does not have it
 *                                               (Handbook's Antimagic Field, Antimagic Cone)
 *     recastCost?: "bonus"|"action"             §164: the cost of a recast during Concentration (Swift Quiver: a
 *                                               Bonus Action)
 *     levitate?: { effect, height, units }      §164: the effect's bearer rises by `height` on placement, comes down
 *                                               when it ends (Levitate)
 *     prismatic?: { indigo, violet }            §164: a d8 per target picks the color — 1 to 5: the damage type
 *                                               (fire, acid, lightning, poison, cold); 6: the `indigo` effect, 7:
 *                                               the `violet` effect, no damage; 8: two rays (Prismatic Spray); `all`
 *                                               (§173): all the layers at once (Prismatic Wall crossed);
 *                                               `activities`: only for these activities
 *     barrier?: { radius, units, exceptTypes? } §163: a creature (outside `exceptTypes`) cannot enter the Emanation,
 *                                               nor hit in melee within it without reach (Antilife Shell,
 *                                               adapter/barriers.mjs)
 *                                               O9h (§363): `onlyTypes` — only these creatures are stopped;
 *                                               `shields` — they affect nothing inside (no action reaches them
 *                                               there); `endsOnContact` — the Emanation drops if its bearer moves so
 *                                               as to put one inside (Scroll of Protection)
 *     seesInvisible?: true                      §161: the bearer of an item effect sees Invisible creatures (See
 *                                               Invisibility) — simulated vision and flat-rate condition of the
 *                                               attack
 *     seesThroughOwnDarkness?: true             §447: the bearer sees normally through the magical Darkness
 *                                               (`light.darkness`) that one of THEIR spells placed: rules (`canSee`,
 *                                               `canSeePoint`, search) and screen (the "Devil's Sight" mode, no
 *                                               limit in that Darkness) — "Power of the Shadow"
 *     sense?: {…} | [{…}]                       a sense the item gives its bearer, besides those of their sheet
 *                                               (core/senses.mjs)
 *       kind: "locate" | "sight"                `locate` — the target's position is known without it being seen (it stays
 *                                               "unseen" for the attack); `sight` — counts as sight: not of an
 *                                               Invisible target, nor through a mist or a zone of Darkness. A
 *                                               declared sight IGNORES LIGHT: it sees in ordinary darkness up to its
 *                                               range, and, without `needs: "sight"`, even when its bearer is
 *                                               Blinded — closer to Blindsight than to sight; add `needs: "sight"`
 *                                               for it to go out when Blinded
 *       range: 30, units?: "ft"                 rule range, converted to the grid
 *       via?: "effect", fromEffect?: "<id>"     borne by an item effect on its bearer (a spell, an activated power), that one
 *                                               only if `fromEffect`; without `via`: by possession of the item
 *       walls?: false                           false — passes through walls; absent — a sight wall stops it
 *       detects?: <condition>                   facts about the target (`target.*`); absent — any creature
 *       magic?: true | "<school>"               magical sense, of a spell of this school: `wardsDetection` can stop it
 *       reveals?: "presence" | "aura"           `presence` — the presence is known, not the position; `aura` — the
 *                                               creature already seen that bears what the sense detects is marked,
 *                                               nothing more
 *       through?: ["darkness"]                  for `sight`: this sight pierces Darkness (never a mist)
 *       needs?: "sight" | "hearing"             goes out while the bearer is Blinded (`sight`) or Deafened (`hearing`)
 *     wardsDetection?: ["magic" | "<school>"…]   the bearer of an item effect is not found by magical senses
 *                                               (`magic`), or by those of spells of these schools
 *     detectedAs?: ["<creature type>"…]         for senses (`sense.detects`), the item's possessor also counts as
 *                                               these types — never for the attack or the save
 *     senseNeeds?: { <mode>: "sight"|"hearing" }  this sense on the possessor's sheet (detection mode:
 *                                               `blindsight`…) is off while they are Blinded (`sight`) or Deafened
 *                                               (`hearing`)
 *     hpTiers?: [{ atMost?, damage?: false, effects?, statuses? }]
 *                                               §160: the outcome according to the target's HP BEFORE the damage —
 *                                               the first tier that holds (`atMost` absent: all); none: neither
 *                                               damage nor effect. `damage: false`: no damage; `effects`: only
 *                                               these effects of the activity; `statuses`: conditions applied
 *                                               ("dead": HP to 0); K2 (§323): `zero: true` — HP to 0, the 0 HP rule
 *                                               decides ("Death Gaze"); `activities`: the tier only applies for
 *                                               these activities of the item
 *     endsCurses?: string[]                     §160: the use ends on the target the effects coming from items with
 *                                               these identifiers (Remove Curse: Bestow Curse, Hex)
 *     tempHpPool?: number                       §160: this many Temporary Hit Points shared equally among the
 *                                               targets (Power Word Fortify: 120)
 *     standsWithReaction?: true                 §401: a Prone target can stand up with their Reaction (Power Word
 *                                               Heal); the question goes to their player, otherwise to the GM
 *     revivesFull?: true                        §160: the target returns to their maximum HP (Resurrection, True
 *                                               Resurrection)
 *     noActions?: <effect id>                   §158: the bearer of this item effect has neither an action nor a
 *                                               Bonus Action (Stinking Cloud)
 *     oneThingPerTurn?: <effect id>             Dazed: the bearer of this item effect does only one thing on their
 *                                               turn — move, an action or a Bonus Action (core/one-thing.mjs)
 *     limitedAction?: <effect id>               §157: the bearer of this item effect has, on each of their turns, a
 *                                               limited action (Haste: a single weapon attack, Dash, Disengage or
 *                                               Hide) — core/turn.mjs
 *     saveDisadvantageFor?: string[]            §157: targets of these creature types make the item's save with
 *                                               Disadvantage (Shatter: "construct")
 *     saveDisadvantageAgainst?: { subtypes }    the object's bearer (equipped, attuned if required) makes with
 *                                               Disadvantage the saves imposed by a creature of these subtypes
 *                                               (Demon Armor)
 *     halfOnMiss?: true                         §157: the item's missed attack deals half its damage, without an
 *                                               effect (Melf's Acid Arrow: "on a failure, half the initial damage
 *                                               only") — like Potent Cantrip
 *     potentCantrip?: true                      Potent Cantrip (§28): a damage cantrip of the bearer, missed or
 *                                               saved against, deals half damage, without an effect
 *     sculptSpells?: true                       Sculpt Spells (§28): in an Evocation spell with a save by the
 *                                               bearer, up to 1 + the spell's level allies succeed automatically
 *                                               and take nothing
 *     supremeHealing?: true                     the bearer heals for the maximum of the dice with a spell or a
 *                                               Channel Divinity (§27)
 *     stabilizes?: true                         using the item stabilizes the target at 0 HP, without a check
 *                                               (healer's kit, §50)
 *     carriedLight?: { bright, dim, units, angle?, animation?, burn?, fuel? }
 *                                               a light source that one carries (§52: lamp, lanterns, torch,
 *                                               candle) — its utility activity lights or snuffs it; `angle`: a cone
 *                                               (bullseye lantern)
 *     kindles?: true                            the item lights or snuffs a carried source, as chosen (tinderbox,
 *                                               §52)
 *     scatter?: true                            §187: an object scattered on the ground (caltrops, ball bearings) —
 *                                               its area lasts without duration, does not act on placement, stops
 *                                               whoever enters it on its first cell and is picked up out of combat
 *     flammable?: { damage, type, rounds, seconds, on, ground?, frees? }
 *                                               §188: the item's area ignites (fire damage taken inside, fire area
 *                                               placed on it, flame carried on contact) and burns for `rounds`
 *                                               rounds — until the end of the same turn — or `seconds` out of
 *                                               combat: `damage` of `type` at the `on` moments, once per turn, then
 *                                               it disappears; `ground`: the area stays on the ground until then
 *                                               (Oil, without duration); `frees`: the condition it applied ends with
 *                                               it (Web)
 *     climbsCeilings?: true                     §194: the item (or the effect it applied) grants walking on
 *                                               ceilings
 *     grantsSpeeds?: { <speed>: "walk" | number }
 *                                               §195: the bearer has this speed ("equal to your Speed": "walk"),
 *                                               through an effect that the active GM holds on the actor as long as
 *                                               the item is there — the data has none (Athlete)
 *     climbsOnTurn?: true                       §195: "Run up the Wall" — vertical surfaces during their turn,
 *                                               without a check, without armor or shield; they fall if they end
 *                                               their turn on the wall (Acrobatic Movement)
 *     slippery?: true                           §195: the item's area is a slippery surface (Grease, Oil)
 *     notOnSlippery?: true                      §195: the item does not grant walking on ceilings on a slippery
 *                                               surface (Slippers)
 *     discipleOfLife?: true                     a healing spell cast with a slot restores 2 + the slot's level more
 *                                               to each creature healed (§27)
 *     blessedHealer?: true                      the same spell, if it heals another creature, restores 2 + the
 *                                               level to the caster (§27)
 *     targets?: { types?, unaffectedIf? }       who the action can affect (§16.8): `types` = creature types allowed
 *                                               ("a Humanoid"); `unaffectedIf` = condition (facts of the moment, the
 *                                               target as `target`) that leaves them out of reach (Sleep: immunity
 *                                               to Exhaustion) — no save, no damage, no effect
 *     spellTargets?: { <activity id "cast">: { types?, unaffectedIf? } }
 *                                               what the item says about the targets of the spell this activity
 *                                               casts (Ring of Animal Influence: "Fear (affects only Beasts)") —
 *                                               added to the spell's `targets`
 *   }
 *
 * The STEPS of a declaration (SPEC §16, one block each):
 *   { type: "use", target?: "source", activity? }        reaction: offer the reaction activity
 *   { type: "replay", activity? }                        lasting area: replay the activity (or a sibling, by id)
 *   { type: "damage", formula, damageType }              bonus damage; damageType "weapon" = the weapon's
 *   { type: "damage", to: "source", formula?, damageType?, activity? }
 *                                                        retort (§16.9, B9: isHit moment): the attacker takes this
 *                                                        damage — a formula and its type, or the item's damage
 *                                                        activity (id), at the level the spell was cast
 *   { type: "damage", to: "source", same: true | "resisted", damageType? }
 *                                                        §499 (B19): same-amount retort — at the isDamaged moment
 *                                                        only, `via: "effect"`: the author of the damage taken
 *                                                        (noted on application) takes as much, by type (or under
 *                                                        `damageType`); "resisted": only the shares the bearer
 *                                                        reduced by half. The facts `activity.*` and
 *                                                        `damage.hasType` of the isDamaged moment of a borne effect
 *                                                        read the activity and the types of that damage
 *   { type: "save", to: "source", activity }             §86, retort by a save (isHit moment): the attacker makes
 *                                                        the save of this item activity, its effects if they
 *                                                        fail it (Holy Aura: Blinded)
 *   { type: "move", mode: "push"|"pull", distance, units }   forced movement of the target (hit, failedSave moments);
 *                                                        `distance`: a number, or a formula read on the source
 *                                                        ("5 + 5 * @flags.dnd5e.summon.mod", "Mighty Hand");
 *                                                        `follow: true`: the source follows the target (same offset)
 *   { type: "move", mode: "random", distance, units, directions?, ifBlocked?, minSpeed? }
 *                                                        §497: in a direction rolled on a die (visible 1dN, N = number
 *                                                        of `directions` among n, ne, e, se, s, sw, w, nw; all eight
 *                                                        by default), without Opportunity Attacks (Infestation);
 *                                                        `ifBlocked: "stay"`: nothing if the whole distance is not
 *                                                        free (by default `stop`: as far as possible); `minSpeed`
 *                                                        (in `units`): nothing if the target's Speed is lower
 *   { type: "status", status }                           native condition applied to the target (hit, failedSave moments)
 *   { type: "breakConcentration" }                       §91: the target's Concentration is broken (hit, failedSave
 *                                                        moments; Earthquake)
 *   { type: "mark", mark, label, seconds? }              §54: a mark placed on the target (hit, failedSave moments) — a
 *                                                        named effect (`label`: translation key), attached to the item,
 *                                                        of `seconds` seconds (Oil: "covered in oil", 1 minute)
 *   { type: "resave", …, tally: { successes, failures, status? } }
 *                                                        §43.1: counter — the effect only ends at `successes`
 *                                                        successes; at `failures` failures no save is replayed anymore,
 *                                                        the effect stays and receives the `status` condition
 *                                                        (Petrification: "petrified")
 *   { type: "resave", …, stages: [{ effect?, status? }, …], onSuccess?: "down"|"end", critEnds?: true }
 *                                                        §495: condition ladder — each failure goes up one tier (an
 *                                                        item effect `effect`, applied separately and removed with the
 *                                                        effect, and/or a condition `status` added to the effect); each
 *                                                        success goes down one tier and, at tier 0, the effect ends
 *                                                        (`onSuccess: "end"`: it ends at once); `critEnds`: a natural
 *                                                        20 ends it
 *   { type: "resave", keep?, onFail?, unlessSeesOrigin?, advantage? }
 *                                                        the creature replays the save; on success, the effect ends
 *                                                        (`keep:
 *                                                        true`: it stays); `onFail: "dodge"`: on failure, they take the
 *                                                        Dodge action (§37, Bestow Curse: "Cursed Actions");
 *                                                        `unlessSeesOrigin: true`: only if they cannot see the caster
 *                                                        (Fear: "ends its turn without line of sight to you", §42.2);
 *                                                        `ifCompelled: true`: only after the imposed walk (§403,
 *                                                        Compulsion) (startOfTurn, endOfTurn, isDamaged moments, with
 *                                                        `via: "effect"`)
 *   { type: "resave", own: "choose", advantage? }        §485: item reaction (no `via`, with its `use` step, moment
 *                                                        enemyTurnEnd only) — the reactor replays the save of an effect
 *                                                        they bear, chosen by their player (Indomitable); to be
 *                                                        conditioned by { "self.hasSavableEffect": true }
 *   { type: "consume", side: "target"|"source" }         the mark ends on the first attack roll it concerns (§16.12,
 *                                                        B10): `target` = the one the target bears (Guiding Bolt: "the
 *                                                        next attack against it"); `source` = the one the attacker
 *                                                        bears (Vicious Mockery: "its next attack") — preAttackRoll
 *                                                        moment, `via: "effect"`
 *   { type: "uncrit" }                                   with a `use` reaction (isHit, allyIsHit): if it is taken, a
 *                                                        Critical Hit becomes a mere hit (Sentinel at Death's Door,
 *                                                        §19.9)
 *   { type: "reroll" }                                   §489: with a `use` reaction (isHit, allyIsHit): if it is
 *                                                        taken, the attacker rerolls their attack roll and keeps the
 *                                                        new one — the hit is re-judged (a monster's Parry); "no
 *                                                        effect against a Critical Hit": { "hit.critical": false }. The
 *                                                        retort on a critical miss of the new roll: isMissed, `free`,
 *                                                        facts { "attack.rerolled": true, "attack.fumble": true }
 *   { type: "use", …, free: true }                       §489: the use costs the budget nothing (the retort that is
 *                                                        part of an already taken reaction)
 *   { type: "endCondition" }                             with a `use` reaction at the gainsCondition moment: if it is
 *                                                        taken, the condition suffered ends (§19.8)
 *   { type: "halve" }                                    with a `use` reaction at the isHit moment: if it is taken, the
 *                                                        target only takes half the attack's damage (§16.11, B14:
 *                                                        Uncanny Dodge)
 *   { type: "damage", to: "origin", formula?, damageType? }
 *                                                        the caster of the borne effect takes damage — without a
 *                                                        formula, the same amount the bearer has just taken
 *                                                        (isDamaged, via: "effect": Warding Bond, §16.11)
 *   { type: "damage", formula, damageType, onSave? }     on an outcome (hit, failedSave moments): the target hit takes
 *                                                        this damage, rolled by the engine; `onSave: "half"`
 *                                                        (failedSave): half on a successful save, otherwise nothing
 *                                                        ("extra" damage of spells cast by creatures of a third-party
 *                                                        module)
 *   { type: "damage", to: "bearer", formula?, damageType?, activity? }
 *                                                        on the turn of the bearer of an effect (startOfTurn,
 *                                                        endOfTurn, via: "effect"): they take this damage — a formula
 *                                                        and its type, or the item's damage activity, at the casting
 *                                                        level (Melf's Acid Arrow: "2d4 acid damage at the end of
 *                                                        their next turn")
 *   { type: "damage", to: "self", formula?, damageType?, activity? }
 *                                                        §484: on the turn of the bearer of a TRAIT (startOfTurn,
 *                                                        endOfTurn, without via): they take this damage, when `if`
 *                                                        holds on them (`self.inSunlight`: Sunlight Sensitivity, 20
 *                                                        radiant at the start of their turn in sunlight)
 *   { type: "lift", height, units }                      §164: on an outcome (failedSave) — the target rises to `height`
 *                                                        of elevation; when the item's area ends, they fall (1d6
 *                                                        bludgeoning per 3 m, 20d6 at most, Prone)
 *   { type: "disarm" }                                   on an outcome (failedSave): the target drops their wielded
 *                                                        melee weapon (unequipped) — a disarm
 *   { type: "use", …, advantage: true }                  the reaction is played with Advantage (Riposte)
 *   `margin: { min?, max? }` on an outcome step          only if the target failed by `min` or more ("Chain": Prone at 5)
 *   { type: "remove" }                                   the effect that carries the declaration ends (§16, B8: Sleep,
 *                                                        Hypnotic Pattern end on damage; with `via: "effect"`)
 *   { type: "attackBonus", formula }                     added to the attack roll ("-1d4": "Defensive Veil", §16.46;
 *                                                        preAttackRoll moment)
 *   { type: "advantage" } · { type: "disadvantage" }     a reason for Advantage or Disadvantage on the attack
 *                                                        (preAttackRoll moment; core/conditions.mjs, `declared`)
 *   { type: "interpose" }                                with a `use` reaction at the allyIsDamaged moment: the reactor
 *                                                        takes the damage in the creature's place (§78, a werecreature's
 *                                                        "Interposition"; the effects stay on it)
 *   { type: "redirect" }                                 §375: with a `use` reaction at the isMissed moment: the
 *                                                        attacker makes the same attack again, free, against a
 *                                                        creature the reactor grapples ("Flesh Shield"); offered only
 *                                                        if they grapple one
 *   { type: "cancelForSelf", ifSourceFails? }            §493 (B13): with a `use` reaction at the inArea moment: the
 *                                                        area's damage is not applied to the reactor (them alone; the
 *                                                        other creatures in the area take it); `ifSourceFails: true` —
 *                                                        only if the author fails the save of the reaction activity,
 *                                                        which must target the source (`target:
 *                                                        "source"`: "Insect Shield", the creature's DC, Int / Wis /
 *                                                        Cha of choice)
 *   { type: "absorb" }                                   with a `use` reaction at the allyIsDamaged moment: the
 *                                                        reactor's pool (key `absorb`, Arcane Ward) takes the
 *                                                        creature's damage (§38, Projected Ward)
 *   { type: "use", target: "self", activity }            §72: the reaction targets the reactor itself (Death Ward cast
 *                                                        by the "Bracelet of Charm"); several `use` of the same item:
 *                                                        one button per activity, named after it
 *   { type: "use", target: "source", approach: true }    the reaction first reaches the source: out of reach, the
 *                                                        reactor approaches it up to their speed, without Opportunity
 *                                                        Attacks (§67, "move up to your speed toward the attacker and
 *                                                        attack them")
 *   { type: "use", …, consume: false }                   the reaction is used without consuming anything of its own (the
 *                                                        pool pays)
 *   { type: "bonus", formula }                           with a `use` reaction before an ally's attack roll
 *                                                        (allyAttacks): the die, rolled in the open, added to the roll
 *                                                        (Cosmic Omen, Fortune)
 *   { type: "ward", activity? }                          the attacker must succeed on the item's save (sibling
 *                                                        activity by id, otherwise the first save) or loses their
 *                                                        attack (isAttacked moment, with `via: "effect"`)
 *
 * Pure functions, no dependency on Foundry.
 */

export * from "./content/enums.mjs";
export { validateEntry, validateTable, validateSources } from "./content/entry.mjs";
export { mergeEntries } from "./content/merge.mjs";
