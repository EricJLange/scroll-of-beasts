'use strict';

const { Plugin, ItemView, PluginSettingTab, Setting, MarkdownRenderer, requestUrl, Modal } = require('obsidian');

const VIEW_TYPE = 'scroll-of-beasts';
const DEFAULT_SETTINGS = { monsterFolders: [], useForgottenRealmsAPI: false };

class FRImageModal extends Modal {
    constructor(app, src, alt) {
        super(app);
        this.src = src;
        this.alt = alt;
    }
    onOpen() {
        const img = this.contentEl.createEl('img', { attr: { src: this.src, alt: this.alt } });
        img.style.cssText = 'max-width:100%; max-height:80vh; display:block; margin:0 auto;';
    }
    onClose() { this.contentEl.empty(); }
}

class ScrollOfBeastsView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this._doCleanup = null;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return 'Scroll of Beasts'; }
    getIcon() { return 'scroll'; }

    async onOpen() {
        const view = this;
        const app = this.app;
        this.contentEl.empty();

        // ─── Title strings ────────────────────────────────────────────────────────────
        const TitleMain   = "Scroll of Beasts";
        const TitleBeast  = "← Summon another Beast";
        const SearchTextL = "Search by name...";
        const SearchTextS = "Search by name";

        // ─── Local notes ──────────────────────────────────────────────────────────────
        const localFiles = [];
        for (const folderPath of this.plugin.settings.monsterFolders.filter(f => f.trim())) {
            const normalized = folderPath.trim().replace(/\/+$/, '');
            app.vault.getMarkdownFiles()
                .filter(file => file.path.startsWith(normalized + '/') && !file.basename.startsWith('_') && file.basename !== 'Monsters')
                .forEach(file => localFiles.push(file));
        }
        localFiles.sort((a, b) => a.basename.localeCompare(b.basename));

        const localMap = new Map();
        for (const file of localFiles) {
            localMap.set(file.basename.toLowerCase(), file.path);
        }

        // ─── Bestiary ─────────────────────────────────────────────────────────────────
        const bestiaryRaw = app.plugins.plugins['obsidian-5e-statblocks']?.settings?.monsters ?? [];

        // ─── CR helpers ───────────────────────────────────────────────────────────────
        const CR_LABELS = ["N/A","0","1/8","1/4","1/2","1","2","3","4","5","6","7","8","9","10",
            "11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"];
        const CR_VALUES = [-1, 0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

        const parseCR = (cr) => {
            const idx = CR_LABELS.indexOf(cr ?? "");
            return idx !== -1 ? CR_VALUES[idx] : -1;
        };

        const formatCR = (cr) => {
            if (cr === "1/8") return "⅛";
            if (cr === "1/4") return "¼";
            if (cr === "1/2") return "½";
            return cr || "N/A";
        };

        // ─── Pentadic CR numeral SVG ──────────────────────────────────────────────────
        const crToPentadicSVG = (() => {
            const W = 12, H = 20, SW = 1.5, SX = 5;
            const L = (x1, y1, x2, y2) =>
                `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round"/>`;
            const SEMI_R = 2.3, SEMI_RX = W - 1 - SX, SEMI_CY = H / 2;
            const SEMI_TOP = SEMI_CY - SEMI_R, SEMI_BOT = SEMI_CY + SEMI_R;
            const stemEl  = () => L(SX, 1, SX, H - 1);
            const topBar  = () => L(1, 1, W - 1, 1);
            const botBar  = () => L(1, H - 1, W - 1, H - 1);
            const leftBar = () => L(1, SEMI_CY, SX, SEMI_CY);
            const tick    = (y) => L(SX, y, W - 2, y);
            const semiEl  = () =>
                `<path d="M ${SX} ${SEMI_TOP} L ${SX+SEMI_RX} ${SEMI_CY} L ${SX} ${SEMI_BOT}" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>`;
            const ABOVE_Y = [SEMI_TOP - SW, (SEMI_TOP - SW + 1) / 2];
            const BELOW_Y = [SEMI_BOT + SW, (SEMI_BOT + SW + H - 1) / 2];
            const unitMarks = (u) => {
                if (u === 0) return '';
                if (u <= 4) {
                    const yMin = 3, yMax = H - 3, step = (yMax - yMin) / (u + 1);
                    return Array.from({ length: u }, (_, i) => tick(yMin + step * (i + 1))).join('');
                }
                const aboveN = u >= 8 ? 2 : u >= 6 ? 1 : 0;
                const belowN = u === 9 ? 2 : u >= 7 ? 1 : 0;
                let m = semiEl();
                for (let i = 0; i < aboveN; i++) m += tick(ABOVE_Y[i]);
                for (let i = 0; i < belowN; i++) m += tick(BELOW_Y[i]);
                return m;
            };
            const decadeMarks = (d) => {
                let m = '';
                if (d >= 1) m += topBar();
                if (d >= 2) m += botBar();
                if (d >= 3) m += leftBar();
                return m;
            };
            const numeralInner = (n) => (n === 0 ? L(SX + 2, 1, SX + 2, H - 1) : stemEl()) + decadeMarks(Math.floor(n / 10)) + unitMarks(n % 10);
            const svgWrap = (inner, vw, vh) =>
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" height="1em" style="display:inline-block;vertical-align:-0.1em">${inner}</svg>`;
            return (cr) => {
                if (!cr || cr === 'N/A') return svgWrap(stemEl(), W, H);
                const FRACS = { '1/8': [1, 8], '1/4': [1, 4], '1/2': [1, 2] };
                if (FRACS[cr]) {
                    const [num, den] = FRACS[cr];
                    const s = 0.8, nW = W * s, yOff = (H - H * s) / 2;
                    const slashDx = H * Math.tan(11 * Math.PI / 180), gap = 1.5;
                    const denX = nW + gap + slashDx + gap;
                    const totalW = denX + nW;
                    const inner =
                        `<g transform="translate(0,${yOff.toFixed(1)}) scale(${s})">${numeralInner(num)}</g>` +
                        L(nW + gap, H, nW + gap + slashDx, 0) +
                        `<g transform="translate(${denX.toFixed(1)},${yOff.toFixed(1)}) scale(${s})">${numeralInner(den)}</g>`;
                    return svgWrap(inner, totalW.toFixed(1), H);
                }
                const n = parseInt(cr);
                if (isNaN(n)) return `(CR ${cr})`;
                return svgWrap(numeralInner(n), W, H);
            };
        })();

        // ─── Group by base name ───────────────────────────────────────────────────────
        const getBaseName = (name) => name.replace(/\s*\[.*?\]\s*$/, '').trim();

        const bestiaryBaseNames = new Set(bestiaryRaw.map(e => getBaseName(e[0])));

        const groupMap = new Map();
        const bestiaryCRMap = new Map();
        for (const entry of bestiaryRaw) {
            const name = entry[0];
            const obj = entry[1];
            const baseName = getBaseName(name);
            const localPath = localMap.get(name.toLowerCase()) ?? localMap.get(baseName.toLowerCase()) ?? null;
            const cr = obj?.cr ?? null;
            let rawType = obj?.type ?? null;
            let typeStr = null;
            if (rawType !== null) {
                if (typeof rawType === 'object') {
                    const t = (rawType.type ?? '').toLowerCase().trim();
                    const tags = Array.isArray(rawType.tags) ? rawType.tags.join(', ').toLowerCase()
                        : (rawType.subtype ?? '').toLowerCase().trim();
                    typeStr = tags ? `${t} (${tags})` : (t || null);
                } else {
                    typeStr = String(rawType).toLowerCase().trim() || null;
                }
            }
            if (!groupMap.has(baseName)) groupMap.set(baseName, []);
            const size = obj?.size?.toLowerCase().trim() ?? null;
            groupMap.get(baseName).push({ name, localPath, cr, type: typeStr, size });
            const baseNameLower = baseName.toLowerCase();
            if (cr !== null && cr !== "" && !bestiaryCRMap.has(baseNameLower)) bestiaryCRMap.set(baseNameLower, cr);
        }

        for (const file of localFiles) {
            const baseName = file.basename;
            if (!groupMap.has(baseName) && !groupMap.has(getBaseName(baseName))) {
                groupMap.set(baseName, [{ name: baseName, localPath: file.path }]);
            }
        }

        const allMonsters = Array.from(groupMap.entries()).map(([baseName, versions]) => {
            versions.sort((a, b) => {
                const aTagged = /\[/.test(a.name);
                const bTagged = /\[/.test(b.name);
                if (aTagged && !bTagged) return -1;
                if (!aTagged && bTagged) return 1;
                return a.name.localeCompare(b.name);
            });
            const localPath = versions.find(v => v.localPath)?.localPath ?? null;
            const localOnly = versions.length === 1 && localPath && !bestiaryBaseNames.has(baseName);
            let cr = versions[0]?.cr || null;
            if (cr === null && bestiaryCRMap.has(baseName.toLowerCase())) cr = bestiaryCRMap.get(baseName.toLowerCase());
            const crNum = parseCR(cr);
            const size = versions.find(v => v.size)?.size ?? null;
            const typeStr = versions.find(v => v.type)?.type ?? null;
            let baseType = typeStr ? typeStr.replace(/\s*\(.*/, '').trim() : null;
            let subType  = typeStr ? (typeStr.match(/\(([^)]+)\)?/)?.[1]?.trim() ?? null) : null;
            if (baseType?.startsWith('swarm of ')) {
                const swarmKind = baseType.replace(/^swarm of\s+/, '');
                subType = subType ? `${swarmKind} (${subType})` : swarmKind;
                baseType = 'swarm';
            }
            return { baseName, versions, localPath, localOnly, cr, crNum, size, type: typeStr, baseType, subType };
        }).sort((a, b) => a.baseName.localeCompare(b.baseName));

        // --- Pass 2: promote leading known types out of subtypes ---
        const rawBaseTypeSet = new Set(allMonsters.map(m => m.baseType).filter(Boolean));

        for (const m of allMonsters) {
            if (!m.subType) continue;
            const sub = m.subType;
            for (const bt of rawBaseTypeSet) {
                if (sub === bt) {
                    m.baseType = bt; m.subType = null; break;
                }
                if (sub.startsWith(bt + ', ')) {
                    m.baseType = bt; m.subType = sub.slice(bt.length + 2).trim(); break;
                }
            }
        }

        // --- Pass 3: elf/dwarf subrace promotion ---
        const ELF_SUBRACES = new Set([
            'drow', 'eladrin', 'shadar-kai',
            'wood elf', 'high elf', 'sun elf', 'moon elf', 'sea elf', 'dark elf'
        ]);
        const DWARF_SUBRACES = new Set([
            'dwarf', 'duergar', 'hill dwarf', 'mountain dwarf',
            'deep dwarf', 'shield dwarf', 'gold dwarf', 'shielddwarf'
        ]);

        for (const m of allMonsters) {
            if (m.baseType !== 'humanoid' || !m.subType) continue;
            if (ELF_SUBRACES.has(m.subType)) {
                m.baseType = 'elf';
            } else if (DWARF_SUBRACES.has(m.subType)) {
                m.baseType = 'dwarf';
                if (m.subType === 'dwarf') m.subType = null;
                else if (m.subType === 'shielddwarf') m.subType = 'shield dwarf';
            } else if (m.subType === 'human') {
                m.baseType = 'human';
                m.subType = null;
            }
        }
        for (const m of allMonsters) {
            const ln = m.baseName.toLowerCase();
            if (m.baseType === 'dwarf' && ln.startsWith('duergar'))      m.subType = 'duergar';
            if (m.baseType === 'dwarf' && ln.startsWith('shield dwarf')) m.subType = 'shield dwarf';
        }

        const DRAGON_AGE_PREFIX = /^(wyrmling|young|adult|ancient|greatwyrm|great wyrm)\s+/i;
        for (const m of allMonsters) {
            if (m.baseType === 'dragon' && m.subType)
                m.subType = m.subType.replace(DRAGON_AGE_PREFIX, '').trim() || null;
        }

        const CLASS_TAGS = new Set([
            'artificer', 'barbarian', 'bard', 'cleric', 'druid',
            'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'
        ]);
        for (const m of allMonsters) {
            if (m.subType && CLASS_TAGS.has(m.subType)) m.subType = null;
            if (m.subType === 'any race') m.subType = null;
            if (m.baseType === 'giants') m.baseType = 'giant';
        }

        // --- Pass 4: manual overrides ---
        const typeOverrideMap = new Map([
            ["graz'zt", { baseType: "fiend", subType: "demon" }],
            ["nyssa otellion", { baseType: "fiend", subType: "devil" }],
            ["fenthaza", { baseType: "monstrosity", subType: "yuan-ti" }],
            ["ras nsi", { baseType: "monstrosity", subType: "yuan-ti" }],
            ["yuan-ti malison (type 4)", { baseType: "monstrosity", subType: "yuan-ti" }],
            ["yuan-ti malison (type 5)", { baseType: "monstrosity", subType: "yuan-ti" }],
            ["yuan-ti priest", { baseType: "monstrosity", subType: "yuan-ti" }],
            ["windfall", { baseType: "humanoid", subType: "tiefling" }],
            ["mercion", { baseType: "human", subType: null }],
            ["verminaard", { baseType: "human", subType: null }],
            ["zargash", { baseType: "human", subType: null }],
            ["ashann", { baseType: "humanoid", subType: "gnome" }],
            ["gryz alakritos", { baseType: "humanoid", subType: "goblin" }],
            ["aradrine the owl", { baseType: "humanoid", subType: "goliath" }],
            ["kettlesteam the kenku", { baseType: "humanoid", subType: "kenku" }],
            ["scribble", { baseType: "humanoid", subType: "kenku" }],
            ["brusipha", { baseType: "humanoid", subType: "minotaur" }],
            ["strahd, master of death house", { baseType: "undead", subType: "vampire" }],
            ["euryale", { baseType: "monstrosity", subType: "medusa" }],
            ["dermot wurder (tier 1)", { baseType: "humanoid", subType: "goblin" }],
            ["dermot wurder (tier 2)", { baseType: "humanoid", subType: "goblin" }],
            ["dermot wurder (tier 3)", { baseType: "humanoid", subType: "goblin" }],
            ["qunbraxel", { baseType: "aberration", subType: "mind flayer" }],
            ["alhoon", { baseType: "undead", subType: "mind flayer" }],
            ["oshundo the alhoon", { baseType: "undead", subType: "mind flayer" }],
            ["ayo jabe (tier 1)", { baseType: "humanoid", subType: "water genasi" }],
            ["ayo jabe (tier 2)", { baseType: "humanoid", subType: "water genasi" }],
            ["ayo jabe (tier 3)", { baseType: "humanoid", subType: "water genasi" }],
            ["monastic high curator", { baseType: "humanoid", subType: null }],
            ["jamil a'alithiya", { baseType: "human", subType: null }],
            ["verin thelyss", { baseType: "elf", subType: "drow" }],
            ["galsariad ardyth (tier 1)", { baseType: "elf", subType: "drow" }],
            ["galsariad ardyth (tier 2)", { baseType: "elf", subType: "drow" }],
            ["galsariad ardyth (tier 3)", { baseType: "elf", subType: "drow" }],
            ["tharashk hunter", { baseType: "humanoid", subType: "orc" }],
        ]);
        for (const m of allMonsters) {
            const ov = typeOverrideMap.get(m.baseName.toLowerCase());
            if (!ov) continue;
            if ('baseType' in ov) m.baseType = ov.baseType ?? null;
            if ('subType' in ov) m.subType = ov.subType ?? null;
        }

        // ─── Derived constants ────────────────────────────────────────────────────────
        const allBaseTypes = [...new Set(allMonsters.map(m => m.baseType).filter(Boolean))].sort();

        const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
        const allSizes = [...new Set(allMonsters.map(m => m.size).filter(Boolean))]
            .sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));

        const getSubtypes = (baseType) => [...new Set(
            allMonsters.filter(m => m.baseType === baseType && m.subType).map(m => m.subType)
        )].sort();

        // ─── Futhark rune map ─────────────────────────────────────────────────────────
        const FUTHARK = {
            a:'ᚨ', b:'ᛒ', c:'ᚲ', d:'ᛞ', e:'ᛖ', f:'ᚠ', g:'ᚷ', h:'ᚺ',
            i:'ᛁ', j:'ᛃ', k:'ᚲ', l:'ᛚ', m:'ᛗ', n:'ᚾ', o:'ᛟ', p:'ᛈ',
            q:'ᚲ', r:'ᚱ', s:'ᛊ', t:'ᛏ', u:'ᚢ', v:'ᚢ', w:'ᚹ', x:'ᚲ',
            y:'ᛃ', z:'ᛉ'
        };

        // ─── HTML escape helper ───────────────────────────────────────────────────────
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

        // ─── Tally flavor phrases ─────────────────────────────────────────────────────
        const TALLY_ZERO_SKIP = new Set([11, 13, 15, 35, 75, 82, 89, 97]);

        const pluralize = (str, n) => n === 1
            ? str.replace(/\w+\|\w+/g, m => m.split('|')[0])
            : str.replace(/\w+\|\w+/g, m => m.split('|')[1]);

        const TALLY_FLAVORS = [
            n => `${n} entity|entities scried`,
            n => `${n} presence|presences revealed`,
            n => `Augury returned ${n} result|results`,
            n => `The glass shows ${n} form|forms`,
            n => `Dreamsight reveals ${n} form|forms`,
            n => `Transmission received: ${n} subject|subjects`,
            n => `Witness accounts confirm ${n} presence|presences`,
            n => `Echoes traced to ${n} origin|origins`,
            n => `${n} entity|entities invoked`,
            n => `${n} name|names answered the call`,
            n => `${n} being|beings compelled`,
            n => `Summoning circle holds ${n}`,
            n => `The Weave resolves ${n} signature|signatures`,
            n => `Wards disturbed by ${n} entity|entities`,
            n => `${n} manifestation|manifestations observed`,
            n => `${n} seal|seals broken; subjects identified`,
            n => `${n} entry|entries bound`,
            n => `${n} specimen|specimens catalogued`,
            n => `${n} subject|subjects inscribed`,
            n => `${n} name|names writ in the Registry`,
            n => `Phylactery holds ${n} record|records`,
            n => `The Codex yields ${n} account|accounts`,
            n => `${n} creature|creatures marked in the Ledger`,
            n => `The Archive surfaces ${n} specimen|specimens`,
            n => `The Concordat holds ${n} binding|bindings`,
            n => `Ossuary lists ${n} subject|subjects`,
            n => `The Compact names ${n} party|parties`,
            n => `The Athenaeum discloses ${n} form|forms`,
            n => `Vellum bears ${n} known sigil|sigils`,
            n => `Tally-marks confirm ${n} subject|subjects`,
            n => `${n} appellation|appellations recovered from ruin`,
            n => `Marginalia yields ${n} footnoted beast|beasts`,
            n => `The Tome of Rending names ${n} entity|entities`,
            n => `${n} aura|auras detected`,
            n => `${n} presence|presences sensed beyond the Veil`,
            n => `Resonance found in ${n} entity|entities`,
            n => `${n} form|forms drawn from the Aether`,
            n => `Sympathetic resonance: ${n} match|matches`,
            n => `Planar census: ${n} entity|entities`,
            n => `${n} shadow|shadows catalogued beyond the Veil`,
            n => `${n} specimen|specimens classified`,
            n => `${n} known form|forms identified`,
            n => `Bestiary yields ${n} entry|entries`,
            n => `Trapped in amber: ${n} instance|instances`,
            n => `The Reckoning finds ${n} name|names`,
            n => `Alchemical assay: ${n} humour|humours identified`,
            n => `The Formulary notes ${n} dangerous compound|compounds`,
            n => `Reagent index: ${n} viable subject|subjects`,
            n => `Distillation yields ${n} essence|essences`,
            n => `${n} subject|subjects rated by temperament`,
            n => `The Exorcist's Roll marks ${n} entity|entities`,
            n => `Ecclesiastical census: ${n} aberration|aberrations`,
            n => `${n} heresy|heresies catalogued and contained`,
            n => `The Litany names ${n} abomination|abominations`,
            n => `Reliquary index: ${n} specimen|specimens`,
            n => `Ordinal of the Hunt yields ${n} quarry`,
            n => `The Threnody accounts for ${n} shade|shades`,
            n => `Necrolog records ${n} revenant|revenants`,
            n => `Bone-casting surfaces ${n} form|forms`,
            n => `Grave-census: ${n} confirmed risen`,
            n => `The Mortuary Index holds ${n} account|accounts`,
            n => `Exsanguination log: ${n} predator|predators noted`,
            n => `Worm-script deciphered: ${n} name|names`,
            n => `The Pact of Salt names ${n} entity|entities`,
            n => `Testimonial writ: ${n} signatory|signatories`,
            n => `${n} subject|subjects deposed and sealed`,
            n => `The Covenant yields ${n} bound name|names`,
            n => `Devil's own ledger: ${n} entry|entries`,
            n => `Terms of binding: ${n} party|parties named`,
            n => `Indenture scroll lists ${n} vassal|vassals`,
            n => `Survey of the Outer Planes: ${n} entity|entities`,
            n => `Ley-line trace: ${n} convergence|convergences`,
            n => `${n} incursion|incursions charted on the Etheric Map`,
            n => `Planar coordinates fix ${n} subject|subjects`,
            n => `${n} denizen|denizens logged at the threshold`,
            n => `${n} rift|rifts mapped; entities catalogued`,
            n => `The Cartulary of Planes holds ${n} form|forms`,
            n => `Astral tide brings ${n} form|forms to shore`,
            n => `${n} tale|tales corroborated by multiple sources`,
            n => `The Old Songs name ${n} beast|beasts`,
            n => `Village accounts confirm ${n} entity|entities`,
            n => `${n} warning|warnings found in the hedgerow-lore`,
            n => `The Grandmother's Reckoning names ${n}`,
            n => `Hearthside count: ${n} remembered beast|beasts`,
            n => `Fear-lore yields ${n} named horror|horrors`,
            n => `The Warden's Marks show ${n} territory|territories`,
            n => `Field report: ${n} contact|contacts logged`,
            n => `Spoor and sign account for ${n} form|forms`,
            n => `The Hunter's Docket marks ${n} quarry`,
            n => `${n} nest|nests located; tenants confirmed`,
            n => `${n} quarry tallied at the lodge`,
            n => `The Cipher reveals ${n} hidden name|names`,
            n => `Glyphs decoded: ${n} entity|entities named`,
            n => `The Cartouche holds ${n} true name|names`,
            n => `${n} form|forms unlocked from binding-script`,
            n => `Rune-casting surfaces ${n} aspect|aspects`,
            n => `The Sigil-Map resolves ${n} presence|presences`,
            n => `${n} redacted entry|entries partially restored`,
            n => `The Palimpsest reveals ${n} overwritten name|names`,
            n => `Forgotten tongue yields ${n} ancient designation|designations`,
        ];

        // ─── H1 rune transition ───────────────────────────────────────────────────────
        const animateH1 = (h1El, targetText) => {
            const chars = [...targetText];
            const runicIndices = chars.map((ch, i) => FUTHARK[ch.toLowerCase()] ? i : -1).filter(i => i !== -1);
            if (!runicIndices.length) { h1El.textContent = targetText; return; }
            h1El.textContent = '';
            chars.forEach(ch => {
                const span = document.createElement('span');
                const rune = FUTHARK[ch.toLowerCase()];
                span.textContent = rune || ch;
                if (rune && isIOS) span.style.cssText = 'font-size:0.72em; vertical-align:0.12em;';
                h1El.appendChild(span);
            });
            const spans = Array.from(h1El.querySelectorAll('span'));
            const shuffled = [...runicIndices];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const RUNE_HOLD = 250, flipDuration = 400, n = Math.max(1, shuffled.length - 1);
            shuffled.forEach((charIdx, flipIdx) => {
                const t = RUNE_HOLD + Math.round(flipIdx / n * flipDuration);
                setTimeout(() => { spans[charIdx].textContent = chars[charIdx]; }, t);
            });
            setTimeout(() => { h1El.textContent = targetText; }, RUNE_HOLD + flipDuration + 60);
        };

        // ─── Wrapper + scroll-to-top ──────────────────────────────────────────────────
        const wrapper = this.contentEl;
        wrapper.addClass('scroll-of-beasts-view');

        const scrollH1 = wrapper.createEl("h1", { text: TitleMain });

        const scrollToTop = () => {
            const scroller = wrapper.closest(".markdown-preview-view, .cm-scroller, .view-content");
            if (scroller) {
                scroller.scrollTo({ top: 0, behavior: "smooth" });
            } else {
                wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        };

        // ─── Mobile breakpoint ────────────────────────────────────────────────────────
        const MOBILE_BREAKPOINT = 600;
        const mobileQuery = window.matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`);
        const isIOS = app.isMobile && /iPhone|iPad|iPod/.test(navigator.userAgent);

        // ─── Floating scroll-to-top button ────────────────────────────────────────────
        const ourLeafEl = view.leaf.containerEl;
        const upBtn = document.body.createEl("button");
        upBtn.style.cssText = "position:fixed; bottom:80px; width:44px; height:44px; border-radius:50%; background:var(--interactive-accent); color:var(--text-on-accent); border:none; cursor:pointer; display:none; align-items:center; justify-content:center; z-index:100; box-shadow:0 2px 8px rgba(0,0,0,0.3);";
        const upSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        upSvg.setAttribute("width", "30"); upSvg.setAttribute("height", "30");
        upSvg.setAttribute("viewBox", "0 0 24 24"); upSvg.setAttribute("fill", "none");
        upSvg.setAttribute("stroke", "currentColor"); upSvg.setAttribute("stroke-width", "3");
        upSvg.setAttribute("stroke-linecap", "round"); upSvg.setAttribute("stroke-linejoin", "round");
        upSvg.style.pointerEvents = "none";
        ["17 11 12 6 7 11", "17 18 12 13 7 18"].forEach(pts => {
            const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            p.setAttribute("points", pts); upSvg.appendChild(p);
        });
        upBtn.appendChild(upSvg);
        upBtn.addEventListener("click", () => scrollToTop());

        const isOurLeafActive = () => app.workspace.activeLeaf === view.leaf;

        const onLeafChange = () => { if (!isOurLeafActive()) upBtn.style.display = "none"; };

        const onLayoutChange = () => {
            if (!wrapper.offsetParent) {
                upBtn.style.display = "none";
            } else {
                upObserver?.check?.();
            }
        };

        const positionUpBtn = () => {
            const rect = wrapper.getBoundingClientRect();
            const rightPad = mobileQuery.matches ? 4 : 28;
            upBtn.style.right = (window.innerWidth - rect.right + rightPad) + "px";
        };

        app.workspace.on("active-leaf-change", onLeafChange);
        app.workspace.on("layout-change", onLayoutChange);
        window.addEventListener("resize", positionUpBtn);

        // ─── CSS ──────────────────────────────────────────────────────────────────────
        const crStyle = document.createElement('style');
        document.head.appendChild(crStyle);
        crStyle.textContent = `
            .scroll-of-beasts-view {
                font-size: var(--font-text-size, 16px);
                line-height: var(--line-height-normal, 1.5);
                max-width: var(--file-line-width, 700px);
                margin: 0 auto;
                padding: 10px 20px 120px;
                box-sizing: border-box;
                overflow-y: auto;
                height: 100%;
            }
            .scroll-of-beasts-view .markdown-preview-view { overflow: visible !important; height: auto !important; }
            .cr-slider-wrap { display:block; }
            .cr-dropdown-wrap { display:none; }
            .monster-tally, .monster-list { padding: 0 28px 0 20px; box-sizing:border-box; }
            @media (max-width: ${MOBILE_BREAKPOINT}px) {
                .cr-slider-wrap { display:none !important; }
                .cr-dropdown-wrap { display:flex !important; }
                #monster-search { font-size: 0.9em; }
                .monster-tally, .monster-list { padding: 0 4px; }
                .cr-label-center { display:none; }
                .subtype-select { flex-basis: 100% !important; }
                .scroll-of-beasts-view { padding-bottom: max(180px, calc(env(safe-area-inset-bottom, 0px) + 140px)); }
            }
            #monster-search:focus {
                outline: none;
                border-color: var(--interactive-accent);
            }
            #size-select:focus, #type-select:focus, .subtype-select:focus {
                outline: none;
                box-shadow: none;
                -webkit-appearance: none;
                appearance: none;
            }
            .fr-lead { margin-bottom: 12px; line-height: 1.6; font-style: italic; color: var(--text-muted); }
            .fr-panel .markdown-preview-view { padding: 0; }
            .fr-panel .markdown-preview-view img { width: 95%; display: block; margin: 0 auto; border-radius: 6px; }
            .fr-lead p { margin-bottom: 0.5em; }
            .fr-tab-bar {
                display: flex;
                gap: 4px;
                margin-bottom: 8px;
                border-bottom: 1px solid var(--background-modifier-border);
                padding-bottom: 4px;
            }
            .fr-tab {
                background: none;
                border: none;
                border-bottom: 2px solid transparent;
                padding: 4px 12px;
                margin-bottom: -5px;
                cursor: pointer;
                color: var(--text-muted);
                font-size: 0.9em;
            }
            .fr-tab:hover { color: var(--text-normal); }
            .fr-tab-active {
                color: var(--interactive-accent);
                border-bottom-color: var(--interactive-accent);
                font-weight: 600;
            }
            .fr-lore {
                margin-top: 16px;
                padding-top: 12px;
                border-top: 1px solid var(--background-modifier-border);
            }
            .fr-lore-text p { margin-bottom: 0.75em; line-height: 1.6; }
            .fr-lore-text figure { margin: 1em 0; }
            .fr-lore-text figure img { max-width: 100%; border-radius: 4px; display: block; }
            .fr-lore-text figcaption { font-size: 0.8em; color: var(--text-muted); font-style: italic; margin-top: 4px; }
            .fr-lore-text figcaption p { margin: 0; }
            .fr-lore-text h2 { font-size: 1.1em; font-weight: 700; margin: 1.2em 0 0.4em; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 2px; }
            .fr-lore-text h3 { font-size: 1em; font-weight: 700; margin: 1em 0 0.3em; }
            .fr-lore-text h4 { font-size: 0.95em; font-weight: 600; margin: 0.8em 0 0.3em; }
            .fr-lore-text ul, .fr-lore-text ol { margin: 0.5em 0 0.75em 1.5em; }
            .fr-lore-text li { margin-bottom: 0.25em; line-height: 1.6; }
            .fr-lore-text a { color: var(--link-color); text-decoration: underline; }
            .fr-lore-text a:hover { color: var(--link-color-hover); }
            .fr-lore-cite {
                margin-top: 1.2em;
                padding-top: 0.6em;
                border-top: 1px solid var(--background-modifier-border);
                font-size: 0.8em;
                color: var(--text-muted);
            }
            .fr-lore-cite a { color: var(--text-muted); text-decoration: underline; }
            .fr-lore-cite a:hover { color: var(--text-normal); }
            .fr-lore-loading, .fr-lore-missing {
                color: var(--text-muted);
                font-style: italic;
                font-size: 0.875em;
            }
        `;

        // ─── Cleanup ──────────────────────────────────────────────────────────────────
        let upObserver = null;
        let mqSizeHandler = null;
        let mqPlaceholderHandler = null;
        view._doCleanup = () => {
            upBtn.remove();
            crStyle.remove();
            app.workspace.off("active-leaf-change", onLeafChange);
            app.workspace.off("layout-change", onLayoutChange);
            window.removeEventListener("resize", positionUpBtn);
            if (upObserver) { upObserver.disconnect(); upObserver = null; }
            if (mqSizeHandler) { mobileQuery.removeEventListener("change", mqSizeHandler); mqSizeHandler = null; }
            if (mqPlaceholderHandler) { mobileQuery.removeEventListener("change", mqPlaceholderHandler); mqPlaceholderHandler = null; }
        };

        // ─── Filter state ─────────────────────────────────────────────────────────────
        let selectedLetter = null;
        let searchTerm = null;
        let lowIdx = 1;
        let highIdx = CR_VALUES.length - 1;
        let selectedBaseType = null;
        let subtypeSearch = null;
        let selectedSize = null;

        // ─── Unified filter predicates ────────────────────────────────────────────────
        const filterPassesNonCR = (m, ov = {}) => {
            const t = (('searchTerm'      in ov ? ov.searchTerm      : searchTerm) ?? '').toLowerCase();
            const l = 'selectedLetter'   in ov ? ov.selectedLetter   : selectedLetter;
            const bt= 'selectedBaseType' in ov ? ov.selectedBaseType : selectedBaseType;
            const st= 'subtypeSearch'    in ov ? ov.subtypeSearch    : subtypeSearch;
            const sz= 'selectedSize'     in ov ? ov.selectedSize     : selectedSize;
            return (m.baseName.toLowerCase().includes(t) || m.versions.some(v => v.name.toLowerCase().includes(t)))
                && (!l  || m.baseName[0].toUpperCase() === l)
                && (!bt || m.baseType === bt)
                && (!bt || !st || m.subType === st)
                && (!sz || m.size === sz);
        };

        const filterPasses = (m, ov = {}) => {
            const li = 'lowIdx'  in ov ? ov.lowIdx  : lowIdx;
            const hi = 'highIdx' in ov ? ov.highIdx : highIdx;
            return filterPassesNonCR(m, ov) && m.crNum >= CR_VALUES[li] && m.crNum <= CR_VALUES[hi];
        };

        const countWith = (ov = {}) => allMonsters.filter(m => filterPasses(m, ov)).length;

        // ─── Scroll observer (shared by showList + showMonster) ───────────────────────
        const setupScrollObserver = (defer) => {
            if (upObserver) upObserver.disconnect();
            const scrollEl = wrapper.closest(".markdown-preview-view, .cm-scroller, .view-content");
            const checkUpBtn = () => {
                const top = Math.max(scrollEl ? scrollEl.scrollTop : 0, window.scrollY || 0);
                upBtn.style.display = top > 300 ? "flex" : "none";
                if (top > 300) positionUpBtn();
            };
            if (scrollEl) scrollEl.addEventListener("scroll", checkUpBtn, { passive: true });
            window.addEventListener("scroll", checkUpBtn, { passive: true });
            upObserver = {
                disconnect: () => {
                    if (scrollEl) scrollEl.removeEventListener("scroll", checkUpBtn);
                    window.removeEventListener("scroll", checkUpBtn);
                },
                check: checkUpBtn
            };
            if (defer) requestAnimationFrame(() => { checkUpBtn(); positionUpBtn(); });
            else { checkUpBtn(); positionUpBtn(); }
        };

        // ─── Forgotten Realms API ─────────────────────────────────────────────────────
        const frCache = new Map();

        // Returns ordered fallback lookup names when the primary name has no wiki page.
        // Strips edition tags, trailing variant qualifiers, age prefixes, and "Swarm of".
        // Input is already normalized (no [5.5e]). Returns ordered fallback names to try.
        // FR wiki uses sentence case ("Black dragon"), so each candidate is also tried in
        // sentence case (first char upper, rest lower) to catch the common casing mismatch.
        const frFallbackNames = (name) => {
            const seen = new Set([name]);  // exact-case: "Black Dragon" and "Black dragon" are different API queries
            const out = [];
            const push = (n) => { if (n && !seen.has(n)) { seen.add(n); out.push(n); } };
            const sc = (s) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
            // 1. Sentence-case the name itself (handles e.g. "Black Dragon" → "Black dragon")
            push(sc(name));
            // 2. Strip trailing (...) qualifier
            const noTail = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
            push(noTail); push(sc(noTail));
            // 3. Strip age prefix (dragons, wyrmlings)
            const noAge = noTail.replace(/^(Young|Adult|Ancient|Wyrmling)\s+/i, '').trim();
            push(noAge); push(sc(noAge));
            // 4. "Swarm of X" → "X" (and naive singularize)
            const swarmM = noTail.match(/^Swarm of\s+(.+)$/i);
            if (swarmM) {
                push(swarmM[1]); push(sc(swarmM[1]));
                if (swarmM[1].endsWith('s') && !swarmM[1].endsWith('ss')) {
                    const sing = swarmM[1].slice(0, -1);
                    push(sing); push(sc(sing));
                }
            }
            // 5. "Name, Descriptor" → "Name"
            const ci = noTail.indexOf(',');
            if (ci > 0) { const n2 = noTail.slice(0, ci).trim(); push(n2); push(sc(n2)); }
            return out;
        };

        const fetchFRData = async (name) => {
            const key = name.toLowerCase();
            if (frCache.has(key)) return frCache.get(key);

            // Strip edition tags that are never valid wiki titles, then try fallbacks
            const normalized = name.replace(/\s*\[5\.5e\]/gi, '').trim();
            const scFirst = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
            const candidates = scFirst !== normalized
                ? [scFirst, normalized, ...frFallbackNames(normalized).filter(c => c !== scFirst)]
                : [normalized, ...frFallbackNames(normalized)];
            let imgPage = null, matchedName = null;
            for (const candidate of candidates) {
                const enc = encodeURIComponent(candidate);
                const imgResp = await requestUrl({
                    url: `https://forgottenrealms.fandom.com/api.php?action=query` +
                         `&titles=${enc}&prop=pageimages&pithumbsize=500&format=json&redirects=1`
                });
                const page = Object.values(imgResp.json?.query?.pages ?? {})[0];
                if (page && !('missing' in page) && !('invalid' in page)) { imgPage = page; matchedName = candidate; break; }
            }
            if (!imgPage) { frCache.set(key, null); return null; }

            const encoded = encodeURIComponent(imgPage.title);

            // Request 2: article text via action=parse (more reliable than extracts module)
            let extract = null, lead = null, pageTitle = null;
            try {
                const parseResp = await requestUrl({
                    url: `https://forgottenrealms.fandom.com/api.php?action=parse` +
                         `&page=${encoded}&prop=text&format=json`
                });
                pageTitle = parseResp.json?.parse?.title ?? null;
                const html = parseResp.json?.parse?.text?.['*'];
                if (html) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = html;
                    // The API wraps content in <div class="mw-parser-output"> — walk its children
                    const contentRoot = tempDiv.querySelector('.mw-parser-output') ?? tempDiv;
                    // Strip noise (infobox is <aside class="portable-infobox">, not a table)
                    contentRoot.querySelectorAll('aside, table, .toc, .mw-editsection, sup, .navbox, .noprint, script, style, .references, .reflist, .footnotes, .info-icon, #scroll-banner, .wikia-slideshow').forEach(el => el.remove());
                    // Fix lazy-loaded images: move data-src → src
                    contentRoot.querySelectorAll('img[data-src]').forEach(img => {
                        img.src = img.getAttribute('data-src');
                        img.removeAttribute('data-src');
                        img.removeAttribute('loading');
                        img.removeAttribute('decoding');
                    });
                    // Remove Fandom float/width inline styles from figures so they flow naturally
                    contentRoot.querySelectorAll('figure').forEach(fig => {
                        fig.style.cssText = '';
                        fig.classList.remove('mw-halign-left', 'mw-halign-right');
                    });
                    // Fix internal wiki links → absolute Fandom URLs
                    contentRoot.querySelectorAll('a[href^="/"]').forEach(a => {
                        a.href = 'https://forgottenrealms.fandom.com' + a.getAttribute('href');
                        a.target = '_blank';
                        a.rel = 'noopener';
                    });
                    contentRoot.querySelectorAll('a[href^="http"]').forEach(a => {
                        a.target = '_blank';
                        a.rel = 'noopener';
                    });
                    // Walk children once: collect lead (before first H2) and sections (first H2 → Appendix)
                    const STOP_SECTIONS = new Set(['appendix', 'references', 'external links', 'further reading', 'gallery', 'notes', 'index', 'see also']);
                    const children = Array.from(contentRoot.children);
                    const firstH2Idx = children.findIndex(el => el.tagName === 'H2');

                    // Lead: walk childNodes (not just element children) so bare text nodes inside
                    // mw-parser-output are captured — some articles have inline-only leads with no <p> wrapper.
                    const SKIP_LEAD = new Set(['small', 'sup', 'aside']);
                    const walkLeafText = (node) => {
                        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
                        if (node.nodeType === Node.ELEMENT_NODE && !SKIP_LEAD.has(node.tagName.toLowerCase()))
                            return Array.from(node.childNodes).map(walkLeafText).join('');
                        return '';
                    };
                    const leadParas = [];
                    let inlineBuf = '';
                    const cleanLead = (s) => s
                        .replace(/\([^a-zA-Z0-9]*\)/g, '')  // strip empty/punctuation-only parens e.g. "( ; )"
                        .replace(/\s+([,;.])/g, '$1')         // remove space before leftover punctuation
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    for (const node of contentRoot.childNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'H2') break;
                        const tag = node.tagName?.toLowerCase();
                        if (node.nodeType === Node.ELEMENT_NODE && (tag === 'p' || tag === 'div' || tag === 'blockquote')) {
                            const buf = cleanLead(inlineBuf);
                            if (buf.length > 20) leadParas.push(buf);
                            inlineBuf = '';
                            const t = cleanLead(walkLeafText(node));
                            if (t.length > 20) leadParas.push(t);
                        } else {
                            inlineBuf += walkLeafText(node);
                        }
                    }
                    const remaining = cleanLead(inlineBuf);
                    if (remaining.length > 20) leadParas.push(remaining);
                    lead = leadParas.length > 0 ? leadParas.join('\n\n') : null;

                    // Sections: from first non-stop H2 to Appendix
                    let startIdx = -1, endIdx = children.length;
                    for (let i = firstH2Idx === -1 ? children.length : firstH2Idx; i < children.length; i++) {
                        if (children[i].tagName !== 'H2') continue;
                        const text = children[i].textContent.trim().toLowerCase();
                        if (startIdx === -1) {
                            if (STOP_SECTIONS.has(text)) break;
                            startIdx = i;
                        } else if (STOP_SECTIONS.has(text)) {
                            endIdx = i;
                            break;
                        }
                    }
                    if (startIdx !== -1) {
                        const resultDiv = document.createElement('div');
                        for (let i = startIdx; i < endIdx; i++) resultDiv.appendChild(children[i].cloneNode(true));
                        const content = resultDiv.innerHTML.trim();
                        if (content.length > 20) extract = content;
                    }
                }
            } catch (e) { /* text fetch failed — proceed without extract */ }

            const pageUrl = pageTitle
                ? `https://forgottenrealms.fandom.com/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`
                : null;
            const result = { imageUrl: imgPage.thumbnail?.source ?? null, lead, extract, pageTitle, pageUrl };
            console.log('[Scroll of Beasts] FR data for', name, matchedName !== name ? `(via "${matchedName}")` : '', '— extract length:', result.extract?.length ?? 'null', '| imageUrl:', result.imageUrl);
            frCache.set(key, result);
            return result;
        };

        // ─── VIEW: Monster List ────────────────────────────────────────────────────────
        const showList = () => {
            const scrollEl = wrapper.closest(".markdown-preview-view, .cm-scroller, .view-content");
            wrapper.innerHTML = "";
            wrapper.prepend(scrollH1);
            scrollH1.style.cursor = "";
            scrollH1.onclick = null;
            animateH1(scrollH1, TitleMain);

            wrapper.createEl("p").textContent = `Search and filter by name, size, type, combat rating (CR), and first letter.`;

            const makeIndicator = (container, color = 'var(--interactive-accent)') => {
                container.style.position = 'relative';
                const tri = document.createElement('div');
                tri.style.cssText = `position:absolute; left:0; top:50%; transform:translateY(-50%); width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:8px solid ${color}; display:none; pointer-events:none; z-index:10;`;
                container.appendChild(tri);
                return tri;
            };

            const positionIndicator = (ind, el, show) => {
                ind.style.display = show ? 'block' : 'none';
                if (show) {
                    ind.style.left = el.offsetLeft + 'px';
                    ind.style.top = (el.offsetTop + el.offsetHeight / 2) + 'px';
                }
            };

            const selectStyle = "margin:0; padding:0; font-size:1em; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--interactive-accent); color:var(--text-on-accent); text-align:center; text-align-last:center;";
            const optStyle = "background:var(--background-primary); color:var(--text-normal);";
            const EM = '\u2298 ';
            const EM_PAD = '\u2007 '; // figure-space + space, same char-count as EM, close width

            // Search row
            const searchRow = wrapper.createEl("div");
            searchRow.style = "display:flex; gap:8px; margin-top:20px; margin-bottom:8px; align-items:center; padding:0 4px 0 0; box-sizing:border-box; width:100%;";
            const sizeOptHtml = [
                `<option value="" style="${optStyle}">${EM_PAD}All Sizes</option>`,
                ...allSizes.map(s => `<option value="${s}" style="${optStyle}">${EM_PAD}${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
            ].join('');
            searchRow.innerHTML = `
                <div style="position:relative; flex:1; display:flex; align-items:center;">
                    <span style="position:absolute; left:14px; display:flex; align-items:center; pointer-events:none; color:var(--text-muted);">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </span>
                    <input id="monster-search" type="text" placeholder="${SearchTextL}" style="width:100%; padding:3px 24px 3px 34px; font-size:1em; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);">
                    <button id="search-clear" style="display:none; position:absolute; right:4px; background:var(--interactive-accent); color:var(--text-on-accent); border:none; border-radius:3px; width:18px; height:18px; font-size:0.75em; line-height:1; cursor:pointer; padding:0;">&times;</button>
                </div>
            `;

            const input = searchRow.querySelector("#monster-search");
            const clearBtn = searchRow.querySelector("#search-clear");
            input.value = searchTerm ?? '';
            clearBtn.style.display = searchTerm ? "block" : "none";
            const searchIndicator = makeIndicator(searchRow, 'var(--interactive-accent)');

            // Size select
            const sizeSlot = document.createElement("div");
            sizeSlot.innerHTML = `<select id="size-select" style="${selectStyle} padding:0 8px 0 10px; width:100%;">${sizeOptHtml}</select>`;
            const sizeSelect = sizeSlot.querySelector("#size-select");
            const sizeIndicator = makeIndicator(sizeSlot, 'var(--background-primary)');
            sizeSelect.value = selectedSize ?? "";

            const sizeRow = wrapper.createEl("div");
            sizeRow.style = "display:none; gap:8px; margin-bottom:8px; align-items:center; padding:0 4px 0 0; box-sizing:border-box; width:100%;";

            const updateSizeLayout = () => {
                if (mobileQuery.matches) {
                    sizeSlot.style.flex = "1";
                    sizeRow.style.display = "flex";
                    sizeRow.appendChild(sizeSlot);
                } else {
                    sizeSlot.style.flex = "0 0 auto";
                    sizeSlot.style.minWidth = "9em";
                    sizeRow.style.display = "none";
                    searchRow.appendChild(sizeSlot);
                }
            };
            updateSizeLayout();
            if (mqSizeHandler) mobileQuery.removeEventListener("change", mqSizeHandler);
            mqSizeHandler = updateSizeLayout;
            mobileQuery.addEventListener("change", mqSizeHandler);

            const updatePlaceholder = () => { input.placeholder = mobileQuery.matches ? SearchTextS : SearchTextL; };
            updatePlaceholder();
            if (mqPlaceholderHandler) mobileQuery.removeEventListener("change", mqPlaceholderHandler);
            mqPlaceholderHandler = updatePlaceholder;
            mobileQuery.addEventListener("change", mqPlaceholderHandler);

            // Filter row: Type + Subtype
            const filterRow = wrapper.createEl("div");
            filterRow.style = "display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; align-items:center; padding:0 4px 0 0; box-sizing:border-box; width:100%;";

            const typeOptHtml = [
                `<option value="" style="${optStyle}">${EM_PAD}All Types</option>`,
                ...allBaseTypes.map(t => `<option value="${t}" style="${optStyle}">${EM_PAD}${t.charAt(0).toUpperCase() + t.slice(1)}</option>`)
            ].join('');

            filterRow.innerHTML = `
                <select id="type-select" style="flex:1; ${selectStyle}">
                    ${typeOptHtml}
                </select>
                <select id="subtype-select" class="subtype-select" style="flex:1; display:none; ${selectStyle}">
                    <option value="" style="${optStyle}">All Subtypes</option>
                </select>
            `;

            const typeSelect = filterRow.querySelector("#type-select");
            const subtypeSelect = filterRow.querySelector("#subtype-select");
            const filterIndicator = makeIndicator(filterRow, 'var(--background-primary)');
            const subtypeIndicator = makeIndicator(filterRow, 'var(--background-primary)');

            const updateSubtypeOptions = (baseType) => {
                subtypeSelect.innerHTML = `<option value="" style="${optStyle}">${EM_PAD}All Subtypes</option>`
                    + getSubtypes(baseType).map(st => `<option value="${st}" style="${optStyle}">${EM_PAD}${st.charAt(0).toUpperCase() + st.slice(1)}</option>`).join('');
            };

            typeSelect.value = selectedBaseType ?? "";
            if (selectedBaseType) {
                subtypeSelect.style.display = "block";
                updateSubtypeOptions(selectedBaseType);
                subtypeSelect.value = subtypeSearch ?? "";
            }

            // --- CR Slider (desktop) ---
            const sliderWrap = wrapper.createEl("div");
            sliderWrap.className = "cr-slider-wrap";
            sliderWrap.style = "padding:6px 58px 8px 50px; margin-bottom:8px; box-sizing:border-box; border:1px solid var(--background-modifier-border); border-radius:4px;";

            const crDisplay = sliderWrap.createEl("div");
            crDisplay.style = "display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;";

            const trackArea = sliderWrap.createEl("div");
            trackArea.style = "position:relative; height:24px; display:flex; align-items:center; cursor:pointer;";

            const track = trackArea.createEl("div");
            track.style = "position:absolute; left:0; right:0; height:4px; background:var(--background-modifier-border); border-radius:2px;";

            const rangeFill = trackArea.createEl("div");
            rangeFill.style = "position:absolute; height:4px; background:var(--interactive-accent); border-radius:2px; pointer-events:none;";

            const lowHandle = trackArea.createEl("div");
            lowHandle.style = "position:absolute; width:16px; height:16px; background:var(--interactive-accent); clip-path:polygon(0% 0%, 100% 50%, 0% 100%); cursor:grab; transform:translateX(calc(-50% - 8px)); top:50%; margin-top:-8px; z-index:3;";
            const highHandle = trackArea.createEl("div");
            highHandle.style = "position:absolute; width:16px; height:16px; background:var(--interactive-accent); clip-path:polygon(100% 0%, 0% 50%, 100% 100%); cursor:grab; transform:translateX(calc(-50% + 8px)); top:50%; margin-top:-8px; z-index:3;";

            const tickArea = sliderWrap.createEl("div");
            tickArea.style = "position:relative; height:22px;";
            const sparseLabels = new Set(["N/A","0","1","5","10","15","20","25","30"]);
            const getPercent = (idx) => (idx / (CR_VALUES.length - 1)) * 100;
            const crTicks = []; const crTickLabels = new Map();
            CR_LABELS.forEach((label, idx) => {
                const pct = getPercent(idx);
                const tick = tickArea.createEl("div");
                tick.style = `position:absolute; left:${pct}%; transform:translateX(-50%); top:0; width:1px; height:5px; background:var(--text-muted); opacity:0.8;`;
                crTicks.push(tick);
                if (sparseLabels.has(label)) {
                    const lbl = tickArea.createEl("span");
                    const isNA = label === "N/A";
                    lbl.style = `position:absolute; left:${pct}%; transform:${isNA ? "translateX(-100%)" : "translateX(-50%)"}; top:6px; font-size:0.65em; color:var(--text-muted); white-space:nowrap; user-select:none;`;
                    lbl.textContent = label;
                    crTickLabels.set(idx, lbl);
                }
            });

            const crIndicator = makeIndicator(sliderWrap, 'var(--interactive-accent)');

            // --- CR Dropdowns (mobile) ---
            const crDropWrap = wrapper.createEl("div");
            crDropWrap.className = "cr-dropdown-wrap";
            crDropWrap.style = "justify-content:space-between; margin-bottom:0.4em; align-items:center; padding:4px 8px; box-sizing:border-box; width:100%; border:1px solid var(--background-modifier-border); border-radius:4px;";

            const dropSelStyle = "flex:1; padding:0; border:none; outline:none; box-shadow:none; -webkit-appearance:none; appearance:none; background:transparent; color:var(--link-color); font-size:0.85em; font-weight:bold; text-align:center; text-align-last:center;";
            const nbsp = '\u00A0';
            const padCR = (v) => v + nbsp.repeat(Math.max(0, 3 - v.length));
            const crNumericLabels = CR_LABELS.filter(v => v !== "N/A");
            const crMinOptHtml = `<option value="gte:N/A" style="${optStyle}">${EM_PAD}N/A</option>`
                + crNumericLabels.map(v => `<option value="gte:${v}" style="${optStyle}">${EM_PAD}≥${nbsp}${padCR(v)}</option>`).join("");
            const crMaxOptHtml = `<option value="lte:N/A" style="${optStyle}">${EM_PAD}N/A</option>`
                + crNumericLabels.map(v => `<option value="lte:${v}" style="${optStyle}">${EM_PAD}≤${nbsp}${padCR(v)}</option>`).join("");
            crDropWrap.innerHTML = `
                <select id="cr-min-sel" style="${dropSelStyle}">
                    ${crMinOptHtml}
                </select>
                <span id="cr-label" style="font-size:0.85em; color:var(--text-muted); flex:0 0 auto; padding:0 6px;">CR</span>
                <select id="cr-max-sel" style="${dropSelStyle}">
                    ${crMaxOptHtml}
                </select>
            `;
            const crMinSel = crDropWrap.querySelector("#cr-min-sel");
            const crMaxSel = crDropWrap.querySelector("#cr-max-sel");
            const crLabelMobile = crDropWrap.querySelector("#cr-label");
            const crDropIndicator = makeIndicator(crDropWrap, 'var(--interactive-accent)');

            // --- Shared CR state ---
            const updateCRState = () => {
                const lPct = getPercent(lowIdx);
                const hPct = getPercent(highIdx);
                lowHandle.style.left  = `${lPct}%`;
                highHandle.style.left = `${hPct}%`;
                rangeFill.style.left  = `${lPct}%`;
                rangeFill.style.width = `${hPct - lPct}%`;
                crDisplay.innerHTML = `<span style="font-size:0.85em; color:var(--text-muted)"><span id="cr-low-prefix" style="visibility:hidden">⊘ </span>CR ≥ <strong id="cr-low-val" style="color:var(--text-normal); display:inline-block; min-width:3.5ch; text-align:left; padding-left:0.3ch;">${CR_LABELS[lowIdx]}</strong></span>`
                                    + `<span class="cr-label-center" style="font-size:1em; color:var(--text-muted); position:relative; left:-4px;">Combat Rating</span>`
                                    + `<span style="font-size:0.85em; color:var(--text-muted)"><span id="cr-high-prefix" style="visibility:hidden">⊘ </span>CR ≤ <strong id="cr-high-val" style="color:var(--text-normal); display:inline-block; min-width:3.5ch; text-align:left; padding-left:0.3ch;">${CR_LABELS[highIdx]}</strong></span>`;
                crMinSel.value = `gte:${CR_LABELS[lowIdx]}`;
                crMaxSel.value = `lte:${CR_LABELS[highIdx]}`;
                const crChanged = lowIdx !== 1 || highIdx !== CR_VALUES.length - 1;
                crIndicator.style.display = crChanged ? 'block' : 'none';
                crDropIndicator.style.display = crChanged ? 'block' : 'none';
            };
            updateCRState();

            // Slider drag
            const getIdxFromClientX = (clientX) => {
                const rect = trackArea.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                return Math.round(ratio * (CR_VALUES.length - 1));
            };

            const makeDraggable = (handle, isLow) => {
                const onMove = (clientX) => {
                    let idx = getIdxFromClientX(clientX);
                    if (isLow) { lowIdx = idx; if (lowIdx > highIdx) highIdx = lowIdx; }
                    else        { highIdx = idx; if (highIdx < lowIdx) lowIdx = highIdx; }
                    updateCRState();
                    renderList();
                };
                handle.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    handle.style.cursor = "grabbing";
                    const onMouseMove = (e) => onMove(e.clientX);
                    const onMouseUp = () => {
                        handle.style.cursor = "grab";
                        document.removeEventListener("mousemove", onMouseMove);
                        document.removeEventListener("mouseup", onMouseUp);
                    };
                    document.addEventListener("mousemove", onMouseMove);
                    document.addEventListener("mouseup", onMouseUp);
                });
                handle.addEventListener("touchstart", (e) => {
                    e.preventDefault();
                    const onTouchMove = (e) => onMove(e.touches[0].clientX);
                    const onTouchEnd = () => {
                        document.removeEventListener("touchmove", onTouchMove);
                        document.removeEventListener("touchend", onTouchEnd);
                    };
                    document.addEventListener("touchmove", onTouchMove, { passive: false });
                    document.addEventListener("touchend", onTouchEnd);
                }, { passive: false });
            };
            makeDraggable(lowHandle, true);
            makeDraggable(highHandle, false);

            // Dropdown changes (mobile)
            crMinSel.addEventListener("change", () => {
                const idx = CR_LABELS.indexOf(crMinSel.value.replace("gte:", ""));
                if (idx !== -1) { lowIdx = idx; if (lowIdx > highIdx) highIdx = lowIdx; }
                updateCRState();
                renderList();
            });
            crMaxSel.addEventListener("change", () => {
                const idx = CR_LABELS.indexOf(crMaxSel.value.replace("lte:", ""));
                if (idx !== -1) { highIdx = idx; if (highIdx < lowIdx) lowIdx = highIdx; }
                updateCRState();
                renderList();
            });

            // Alphabet Bar
            const activeLetters = new Set(allMonsters.map(m => m.baseName[0].toUpperCase()));
            const alphaBar = wrapper.createEl("div");
            alphaBar.className = "monster-alpha-bar";
            alphaBar.style = "display:flex; flex-wrap:wrap; gap:4px; margin-top:0; margin-bottom:2px; align-items:center; justify-content:center; min-height:1.1em; border:1px solid var(--background-modifier-border); border-radius:4px; padding:4px 8px; box-sizing:border-box;";
            const alphaIndicator = makeIndicator(alphaBar, 'var(--interactive-accent)');

            const renderAlpha = (deadAlpha = new Set()) => {
                alphaBar.style.fontSize = '';
                alphaBar.innerHTML = ALPHABET.map(letter => {
                    if (activeLetters.has(letter)) {
                        const isSelected = letter === selectedLetter;
                        const isDead = deadAlpha.has(letter);
                        const size = isSelected ? "1.1em" : "0.85em";
                        const extraStyle = isDead
                            ? "color:var(--text-muted); font-style:italic;"
                            : (!isSelected && selectedLetter) ? "opacity:0.75;" : "";
                        return `<span style="display:inline-flex; width:1.1em; height:1.1em; align-items:center; justify-content:center;"><a class="alpha-link" data-letter="${letter}" href="#" style="font-weight:bold; font-size:${size}; line-height:1; ${extraStyle}">${letter}</a></span>`;
                    } else {
                        return `<span style="display:inline-flex; width:1.1em; height:1.1em; align-items:center; justify-content:center; color:var(--text-muted); font-style:italic; font-size:0.85em; line-height:1;">${letter}</span>`;
                    }
                }).join("");
                alphaBar.appendChild(alphaIndicator);
                alphaIndicator.style.display = selectedLetter ? 'block' : 'none';
                for (const size of ['0.9em', '0.8em']) {
                    const spans = alphaBar.querySelectorAll('span');
                    if (!spans.length) break;
                    const firstTop = spans[0].offsetTop;
                    if (!Array.from(spans).some(s => s.offsetTop > firstTop)) break;
                    alphaBar.style.fontSize = size;
                }
            };
            renderAlpha();

            setupScrollObserver(true);

            alphaBar.addEventListener("click", (e) => {
                const link = e.target.closest(".alpha-link");
                if (!link) return;
                e.preventDefault();
                selectedLetter = selectedLetter === link.dataset.letter ? null : link.dataset.letter;
                renderAlpha();
                renderList();
            });

            // Tally
            const tallyEl = wrapper.createEl("p");
            tallyEl.className = "monster-tally";
            tallyEl.style = "color:var(--text-muted); margin-top:0.3em; margin-bottom:0.5em; font-style:italic;";

            // List Container
            const listContainer = wrapper.createEl("div");
            listContainer.className = "monster-list";
            listContainer.style.overflow = "hidden";

            // --- Search clear animation ---
            let searchAnimTimers = [];
            const cancelSearchAnim = () => { searchAnimTimers.forEach(clearTimeout); searchAnimTimers = []; };

            const animateSearchClear = (onComplete) => {
                cancelSearchAnim();
                const source = input.value;
                if (!source) { input.value = ''; onComplete?.(); return; }
                const target = mobileQuery.matches ? SearchTextS : SearchTextL;
                const toRune = ch => FUTHARK[ch.toLowerCase()] || ch;
                let chars = [...source].map(toRune);
                input.value = chars.join('');

                const sched = (fn, delay) => { const id = setTimeout(fn, delay); searchAnimTimers.push(id); };

                sched(() => {
                    const targetChars = [...target];
                    const targetRunes = targetChars.map(toRune);
                    const diff = chars.length - targetRunes.length;
                    const morphTicks = Math.abs(diff);
                    const tickDelay = morphTicks > 0 ? Math.round(200 / morphTicks) : 0;
                    let targetOffset = 0;

                    const startFlip = () => {
                        const indices = targetChars.map((_, i) => i);
                        for (let i = indices.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [indices[i], indices[j]] = [indices[j], indices[i]];
                        }
                        const n = Math.max(1, indices.length - 1);
                        indices.forEach((charIdx, flipIdx) => {
                            const t = Math.round(flipIdx / n * 350);
                            sched(() => { chars[charIdx] = targetChars[charIdx]; input.value = chars.join(''); }, t);
                        });
                        sched(() => { input.value = ''; onComplete?.(); }, 390);
                    };

                    const doMorphTick = (tick) => {
                        if (tick >= morphTicks) { startFlip(); return; }
                        if (diff > 0) {
                            chars.pop();
                            if (targetOffset < targetRunes.length) { chars[targetOffset] = targetRunes[targetOffset]; targetOffset++; }
                        } else {
                            chars.push(targetRunes[chars.length]);
                        }
                        input.value = chars.join('');
                        sched(() => doMorphTick(tick + 1), tickDelay);
                    };

                    morphTicks === 0 ? startFlip() : doMorphTick(0);
                }, 40);
            };

            const renderList = () => {
                const filtered = allMonsters.filter(m => filterPasses(m));

                const grouped = {};
                for (const m of filtered) {
                    const letter = m.baseName[0].toUpperCase();
                    if (!grouped[letter]) grouped[letter] = [];
                    grouped[letter].push(m);
                }

                let html = '<div class="monster-toc">';
                for (const letter of Object.keys(grouped).sort()) {
                    html += `<div class="toc-section"><h2 class="toc-letter">${letter}</h2><ul class="toc-list">`;
                    for (const m of grouped[letter]) {
                        const crLabel = ` <span class="cr-label" data-cr="${m.cr || 'N/A'}" style="color:var(--text-muted);font-size:0.7em">(CR ${formatCR(m.cr)})</span>`;
                        let mainLinks, detailLink = "";
                        if (m.localOnly) {
                            mainLinks = `<a class="monster-link" data-path="${m.localPath}" data-name="${m.baseName}" data-type="local" href="#">${m.baseName}</a>`;
                        } else {
                            mainLinks = m.versions.map(v =>
                                `<a class="monster-link" data-name="${v.name}" data-type="bestiary" href="#">${v.name}</a>`
                            ).join('<span class="ml-sep"> / </span>');
                            detailLink = m.localPath
                                ? ` <span style="color:var(--text-muted)">(<a class="monster-link" data-path="${m.localPath}" data-name="${m.baseName}" data-type="local" href="#">More details...</a>)</span>`
                                : "";
                        }
                        html += `<li>${mainLinks}${crLabel}${detailLink}</li>`;
                    }
                    html += `</ul></div>`;
                }
                html += `<div aria-hidden="true" style="line-height:1em;">&nbsp;</div><div aria-hidden="true" style="line-height:1em;">&nbsp;</div>`;

                const total = filtered.length;
                const flavorPool = total === 0
                    ? TALLY_FLAVORS.filter((_, i) => !TALLY_ZERO_SKIP.has(i))
                    : TALLY_FLAVORS;
                const tallyFlavor = flavorPool[Math.floor(Math.random() * flavorPool.length)];
                let tallyText;
                if (total === 0) {
                    const s = pluralize(tallyFlavor(0), 0);
                    tallyText = (s.startsWith('0') ? 'No' + s.slice(1) : s.replace('0', 'no')) + '.';
                } else {
                    tallyText = pluralize(tallyFlavor(total), total) + '.';
                }
                const crFiltered = !!(searchTerm || selectedLetter || selectedBaseType || subtypeSearch || selectedSize);
                const isFiltered = crFiltered || lowIdx !== 1 || highIdx !== CR_VALUES.length - 1;
                tallyEl.innerHTML = tallyText + (isFiltered ? ` <a id="monster-reset-btn" href="#" style="font-size:0.8em; white-space:nowrap; font-style:normal;">Reset all filters</a>` : "");
                searchIndicator.style.display = searchTerm ? 'block' : 'none';
                positionIndicator(filterIndicator,  typeSelect,    !!selectedBaseType);
                positionIndicator(subtypeIndicator, subtypeSelect, !!subtypeSearch);
                positionIndicator(sizeIndicator,    sizeSelect,    !!selectedSize);

                html += '</div>';
                listContainer.innerHTML = html;

                // [MAGIC SCROLL] — arcane reveal
                requestAnimationFrame(() => {
                    const lis = Array.from(listContainer.querySelectorAll("li"));
                    if (!lis.length) return;
                    const vr = scrollEl ? scrollEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
                    const visible = lis.filter(li => {
                        const r = li.getBoundingClientRect();
                        return r.top < vr.bottom && r.bottom > vr.top;
                    });

                    const liHideable = new Map();
                    const liCrData = new Map();
                    const linkText = new Map();
                    const allSnaps = [];
                    visible.forEach(li => {
                        const links = Array.from(li.querySelectorAll(".monster-link"));
                        if (!links.length) return;
                        const hideable = Array.from(li.children).filter(c =>
                            !c.classList.contains('monster-link') && !c.classList.contains('cr-label')
                        );
                        hideable.forEach(c => { c.style.opacity = '0'; });
                        liHideable.set(li, hideable);
                        const crEl = li.querySelector('.cr-label');
                        if (crEl) {
                            crEl.innerHTML = crToPentadicSVG(crEl.dataset.cr);
                            liCrData.set(li, crEl);
                        }
                        links.forEach(link => {
                            const text = link.textContent;
                            const runeChars = [...text].filter(ch => FUTHARK[ch.toLowerCase()]);
                            if (!runeChars.length) return;
                            linkText.set(link, text);
                            link.innerHTML = runeChars.map(ch =>
                                `<span style="letter-spacing:0.1em">${FUTHARK[ch.toLowerCase()]}</span>`
                            ).join('');
                            Array.from(link.querySelectorAll('span')).forEach((span, ci) => {
                                allSnaps.push({ span, ch: runeChars[ci], link, li });
                            });
                        });
                    });
                    for (let i = allSnaps.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allSnaps[i], allSnaps[j]] = [allSnaps[j], allSnaps[i]];
                    }
                    const totalDuration = 300;
                    const RUNE_HOLD = 150;
                    const flipDuration = totalDuration - RUNE_HOLD;
                    const n = Math.max(1, allSnaps.length - 1);
                    const linkLastSnap = new Map();
                    const liLastSnap = new Map();
                    allSnaps.forEach(({ span, ch, link, li }, idx) => {
                        const t = RUNE_HOLD + Math.round(idx / n * flipDuration);
                        setTimeout(() => { span.textContent = ch; }, t);
                        linkLastSnap.set(link, Math.max(linkLastSnap.get(link) || 0, t));
                        liLastSnap.set(li, Math.max(liLastSnap.get(li) || 0, t));
                    });
                    linkLastSnap.forEach((t, link) => {
                        const text = linkText.get(link);
                        if (text) setTimeout(() => { link.textContent = text; }, t + 30);
                    });
                    liLastSnap.forEach((t, li) => {
                        const h = liHideable.get(li);
                        if (h) setTimeout(() => { h.forEach(c => { c.style.opacity = '1'; }); }, t + 30);
                    });
                    liCrData.forEach((crEl, li) => {
                        const nameT = (liLastSnap.get(li) || 0) + 30;
                        const rawCr = crEl.dataset.cr;
                        const crText = `(CR ${formatCR(rawCr === 'N/A' ? null : rawCr)})`;
                        setTimeout(() => {
                            crEl.innerHTML = [...crText].map(ch => `<span style="opacity:0">${esc(ch)}</span>`).join('');
                            const spans = Array.from(crEl.querySelectorAll('span'));
                            spans.forEach((span, i) => {
                                setTimeout(() => { span.style.opacity = '1'; }, i * 30);
                            });
                            setTimeout(() => { crEl.textContent = crText; }, (spans.length - 1) * 30 + 30);
                        }, nameT);
                    });
                });
                // [end MAGIC SCROLL]

                // Gray out, italicize, and prefix dead options with ⊘ (always occupies prefix space)
                const markOption = (opt, zero) => {
                    opt.style.color = zero ? 'var(--text-muted)' : 'var(--text-normal)';
                    opt.style.fontStyle = zero ? 'italic' : 'normal';
                    const stripped = opt.textContent.replace(/^[\u2298\u2007] /, '');
                    opt.textContent = (zero ? EM : EM_PAD) + stripped;
                };
                Array.from(sizeSelect.options).forEach(opt => {
                    markOption(opt, countWith({ selectedSize: opt.value }) === 0);
                });
                Array.from(typeSelect.options).forEach(opt => {
                    markOption(opt, countWith({ selectedBaseType: opt.value, subtypeSearch: null }) === 0);
                });
                if (selectedBaseType) {
                    Array.from(subtypeSelect.options).forEach(opt => {
                        markOption(opt, countWith({ subtypeSearch: opt.value }) === 0);
                    });
                }

                let liveCRNums;
                if (crFiltered) {
                    liveCRNums = new Set(allMonsters.filter(m => filterPassesNonCR(m)).map(m => m.crNum));
                }
                const liveByIdx = CR_VALUES.map(crVal => !crFiltered || liveCRNums.has(crVal));
                liveByIdx.forEach((live, idx) => {
                    crTicks[idx].style.height  = live ? '5px' : '3px';
                    crTicks[idx].style.opacity = live ? (crFiltered ? '1.0' : '0.8') : '0.3';
                    const lbl = crTickLabels.get(idx);
                    if (lbl) { lbl.style.fontStyle = live ? 'normal' : 'italic'; lbl.style.opacity = live ? '1' : '0.5'; }
                });
                Array.from(crMinSel.options).forEach(opt => {
                    const idx = CR_LABELS.indexOf(opt.value.replace(/^gte:/, ''));
                    if (idx < 0) return;
                    markOption(opt, total === 0 || !liveByIdx[idx]);
                });
                Array.from(crMaxSel.options).forEach(opt => {
                    const idx = CR_LABELS.indexOf(opt.value.replace(/^lte:/, ''));
                    if (idx < 0) return;
                    markOption(opt, total === 0 || !liveByIdx[idx]);
                });

                const crColor = total > 0 ? 'var(--interactive-accent)' : 'var(--text-muted)';
                const crFontStyle = total > 0 ? 'normal' : 'italic';
                crLabelMobile.style.color = crColor;
                crLabelMobile.style.fontStyle = crFontStyle;
                Array.from(crDisplay.children).forEach(span => {
                    span.style.color = crColor;
                    span.style.fontStyle = crFontStyle;
                });
                const applyValueStyle = (strong, live) => {
                    if (!strong) return;
                    strong.style.color = live ? 'var(--interactive-accent)' : 'var(--text-muted)';
                    strong.style.fontStyle = live ? 'normal' : 'italic';
                };
                applyValueStyle(crDisplay.querySelector('#cr-low-val'),  total === 0 ? false : liveByIdx[lowIdx]);
                applyValueStyle(crDisplay.querySelector('#cr-high-val'), total === 0 ? false : liveByIdx[highIdx]);
                const applyPrefixEM = (id, dead) => {
                    const el = crDisplay.querySelector(id);
                    if (el) el.style.visibility = dead ? 'visible' : 'hidden';
                };
                applyPrefixEM('#cr-low-prefix',  !liveByIdx[lowIdx]);
                applyPrefixEM('#cr-high-prefix', !liveByIdx[highIdx]);
                const setCRSelStyle = (sel, dead) => {
                    sel.style.color = dead ? 'var(--text-muted)' : 'var(--link-color)';
                    sel.style.fontStyle = dead ? 'italic' : 'normal';
                };
                setCRSelStyle(crMinSel, total === 0 || !liveByIdx[lowIdx]);
                setCRSelStyle(crMaxSel, total === 0 || !liveByIdx[highIdx]);

                const withoutLetterFilter = selectedLetter
                    ? allMonsters.filter(m => filterPasses(m, { selectedLetter: null }))
                    : filtered;
                const liveLetters = new Set(withoutLetterFilter.map(m => m.baseName[0].toUpperCase()));
                const deadAlpha = new Set([...activeLetters].filter(l => !liveLetters.has(l)));
                renderAlpha(deadAlpha);
                if (!input.value && document.activeElement !== input) {
                    input.value = mobileQuery.matches ? SearchTextS : SearchTextL;
                    animateSearchClear(() => {});
                }
            };

            renderList();

            input.addEventListener("input", () => {
                cancelSearchAnim();
                searchTerm = input.value;
                clearBtn.style.display = searchTerm ? "block" : "none";
                renderList();
            });

            clearBtn.addEventListener("click", () => {
                animateSearchClear(() => input.focus());
                searchTerm = null;
                clearBtn.style.display = "none";
                renderList();
            });

            sizeSelect.addEventListener("change", () => {
                selectedSize = sizeSelect.value || null;
                renderList();
            });

            typeSelect.addEventListener("change", () => {
                selectedBaseType = typeSelect.value || null;
                subtypeSearch = null;
                subtypeSelect.value = "";
                if (selectedBaseType && getSubtypes(selectedBaseType).length > 0) {
                    updateSubtypeOptions(selectedBaseType);
                    subtypeSelect.style.display = "block";
                } else {
                    subtypeSelect.style.display = "none";
                    subtypeSelect.innerHTML = `<option value="" style="${optStyle}">${EM_PAD}All Subtypes</option>`;
                }
                renderList();
            });

            subtypeSelect.addEventListener("change", () => {
                subtypeSearch = subtypeSelect.value || null;
                renderList();
            });

            tallyEl.addEventListener("click", (e) => {
                if (!e.target.closest("#monster-reset-btn")) return;
                e.preventDefault();
                clearBtn.style.display = "none";
                searchTerm = null;
                selectedLetter = null;
                lowIdx = 1;
                highIdx = CR_VALUES.length - 1;
                selectedSize = null;
                sizeSelect.value = "";
                selectedBaseType = null;
                subtypeSearch = null;
                typeSelect.value = "";
                subtypeSelect.value = "";
                subtypeSelect.style.display = "none";
                subtypeSelect.innerHTML = `<option value="" style="${optStyle}">${EM_PAD}All Subtypes</option>`;
                updateCRState();
                renderAlpha();
                renderList();
                if (input.value) animateSearchClear(() => {});
            });

            listContainer.addEventListener("click", (e) => {
                const link = e.target.closest(".monster-link");
                if (!link) return;
                e.preventDefault();
                showMonster(link.dataset.type, link.dataset.name, link.dataset.path);
            });

            scrollToTop();
        };

        // ─── VIEW: Monster Detail ──────────────────────────────────────────────────────
        const showMonster = async (type, name, path) => {
            upBtn.style.display = "none";
            wrapper.innerHTML = "";
            wrapper.prepend(scrollH1);
            scrollH1.style.cursor = "pointer";
            scrollH1.onclick = () => showList();
            animateH1(scrollH1, TitleBeast);
            const recentFile = (app.workspace.getLastOpenFiles?.() ?? [])[0];
            const sourcePath = type === "local" ? path : (recentFile ?? app.vault.getMarkdownFiles()[0]?.path ?? '');

            if (type === "bestiary" && view.plugin.settings.useForgottenRealmsAPI) {
                // Tab bar
                const tabBar = wrapper.createEl("div", { cls: "fr-tab-bar" });
                const statsTabBtn = tabBar.createEl("button", { text: "Stats", cls: "fr-tab fr-tab-active" });
                const imageTabBtn = tabBar.createEl("button", { text: "Image", cls: "fr-tab" });
                imageTabBtn.style.display = "none";

                // Tab panels — statsPanel is a plain container; statblock gets its own
                // markdown-preview-view wrapper so Obsidian's file-margins padding doesn't
                // create whitespace above the lead text.
                const statsPanel = wrapper.createEl("div", { cls: "fr-panel" });
                const imagePanel = wrapper.createEl("div", { cls: "fr-panel" });
                imagePanel.style.display = "none";

                // Lore section — always visible below tabs
                const loreSection = wrapper.createEl("div", { cls: "fr-lore" });
                const loreLoading = loreSection.createEl("p", { cls: "fr-lore-loading", text: "Loading Forgotten Realms lore…" });

                // Tab switching
                statsTabBtn.addEventListener("click", () => {
                    statsPanel.style.display = "";
                    imagePanel.style.display = "none";
                    statsTabBtn.classList.add("fr-tab-active");
                    imageTabBtn.classList.remove("fr-tab-active");
                });
                imageTabBtn.addEventListener("click", () => {
                    statsPanel.style.display = "none";
                    imagePanel.style.display = "";
                    imageTabBtn.classList.add("fr-tab-active");
                    statsTabBtn.classList.remove("fr-tab-active");
                });

                // Fetch FR data first so image URL is available for the statblock
                const frData = await fetchFRData(name).catch(() => null);
                loreLoading.remove();

                // Lead paragraph above the statblock (e.g. creatures with no section headings)
                if (frData?.lead) {
                    const leadEl = statsPanel.createEl("div", { cls: "fr-lead" });
                    frData.lead.split('\n\n').forEach(para => leadEl.createEl("p", { text: para }));
                }

                // Render statblock into its own markdown wrapper so file-margins padding
                // is scoped to the statblock, not the whole stats tab.
                const sbWrapper = statsPanel.createEl("div", { cls: "markdown-preview-view markdown-rendered" });
                const imageParam = frData?.imageUrl ? `\nimage: "${frData.imageUrl}"` : '';
                try {
                    await MarkdownRenderer.render(app, `\`\`\`statblock\nmonster: ${name}${imageParam}\ncolumnWidth: 350\ncolumn: 2\n\`\`\``, sbWrapper, sourcePath, view);
                } catch (e) {
                    statsPanel.createEl("p", { text: `Could not render "${name}": ${e.message}` });
                }

                // Populate lore section with already-fetched data
                if (!frData) {
                    loreSection.createEl("p", { cls: "fr-lore-missing", text: "No Forgotten Realms article found." });
                } else {
                    if (frData.imageUrl) {
                        imageTabBtn.style.display = "";
                        const imgWrapper = imagePanel.createEl("div", { cls: "markdown-preview-view markdown-rendered" });
                        imgWrapper.style.padding = "0";
                        await MarkdownRenderer.render(app, `![${name}](${frData.imageUrl})`, imgWrapper, sourcePath, view);
                        const renderedImg = imgWrapper.querySelector('img');
                        if (renderedImg) {
                            renderedImg.style.cursor = 'zoom-in';
                            renderedImg.addEventListener('click', () => new FRImageModal(app, frData.imageUrl, name).open());
                        }
                    }
                    if (frData.extract) {
                        const loreText = loreSection.createEl("div", { cls: "fr-lore-text" });
                        loreText.innerHTML = frData.extract;
                    } else {
                        loreSection.createEl("p", { cls: "fr-lore-missing", text: "Lore text unavailable from the Forgotten Realms wiki." });
                    }
                    if (frData.pageUrl) {
                        const cite = loreSection.createEl("p", { cls: "fr-lore-cite" });
                        cite.createEl("span", { text: "Source: " });
                        const citeLink = cite.createEl("a", { text: frData.pageTitle ?? "Forgotten Realms Wiki", href: frData.pageUrl });
                        citeLink.target = "_blank";
                        citeLink.rel = "noopener";
                    }
                }

            } else {
                const embedContainer = wrapper.createEl("div");
                embedContainer.addClass('markdown-preview-view');
                embedContainer.addClass('markdown-rendered');
                const content = type === "local"
                    ? `![[${path}|center wtall hfull no-title clean]]`
                    : `\`\`\`statblock\nmonster: ${name}\ncolumnWidth: 350\ncolumn: 2\n\`\`\``;
                try {
                    await MarkdownRenderer.render(app, content, embedContainer, sourcePath, view);
                } catch (e) {
                    embedContainer.createEl("p", { text: `Could not render "${name}": ${e.message}` });
                }
            }

            scrollToTop();
            setupScrollObserver(false);
        };

        // ─── Init ─────────────────────────────────────────────────────────────────────
        showList();
    }

    async onClose() {
        if (this._doCleanup) { this._doCleanup(); this._doCleanup = null; }
    }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
class ScrollOfBeastsSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Monster folders')
            .setHeading();

        containerEl.createEl('p', {
            text: 'Vault paths to folders containing local monster notes (e.g. DnD/Common/Monsters). Optional — the 5e Statblocks bestiary is always included. The 5e Statblocks plugin must be installed and enabled.',
            cls: 'setting-item-description'
        });

        const folderListEl = containerEl.createEl('div');

        const renderFolders = () => {
            folderListEl.empty();

            this.plugin.settings.monsterFolders.forEach((folder, index) => {
                new Setting(folderListEl)
                    .setName(`Folder ${index + 1}`)
                    .addText(text => text
                        .setPlaceholder('DnD/Common/Monsters')
                        .setValue(folder)
                        .onChange(async (value) => {
                            this.plugin.settings.monsterFolders[index] = value;
                            await this.plugin.saveSettings();
                        }))
                    .addButton(btn => btn
                        .setIcon('trash')
                        .setTooltip('Remove folder')
                        .onClick(async () => {
                            this.plugin.settings.monsterFolders.splice(index, 1);
                            await this.plugin.saveSettings();
                            renderFolders();
                        }));
            });

            new Setting(folderListEl)
                .addButton(btn => btn
                    .setButtonText('Add folder')
                    .setCta()
                    .onClick(async () => {
                        this.plugin.settings.monsterFolders.push('');
                        await this.plugin.saveSettings();
                        renderFolders();
                    }));
        };

        renderFolders();

        new Setting(containerEl)
            .setName('Forgotten Realms wiki')
            .setHeading();

        new Setting(containerEl)
            .setName('Fetch lore & image from Forgotten Realms wiki')
            .setDesc('When enabled, bestiary entries show a Stats / Image / Lore layout pulled from the Forgotten Realms Fandom wiki. Requires an internet connection.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useForgottenRealmsAPI)
                .onChange(async (value) => {
                    this.plugin.settings.useForgottenRealmsAPI = value;
                    await this.plugin.saveSettings();
                }));
    }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
class ScrollOfBeastsPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.registerView(VIEW_TYPE, (leaf) => new ScrollOfBeastsView(leaf, this));

        this.addRibbonIcon('scroll', 'Scroll of Beasts', () => this.activateView());

        this.addCommand({
            id: 'open-scroll-of-beasts',
            name: 'Open Scroll of Beasts',
            callback: () => this.activateView()
        });

        this.addSettingTab(new ScrollOfBeastsSettingTab(this.app, this));
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

module.exports = ScrollOfBeastsPlugin;
