const fs = require('fs');
const path = require('path');

const TOTAL_RECRUITS = 2000;

// Curated pool of iconic anime, gaming, cartoon, and multiverse legends
const CARTOON_AND_LEGEND_RECRUITS = [
    // --- Starters & Early Legends ---
    { name: "Astolfo", origin: "Fate/Apocrypha", type: "Fairy", persona: "Wholesome", portal: "maidCafe" },
    { name: "Felix Argyle", origin: "Re:Zero", type: "Water", persona: "Wholesome", portal: "maidCafe" },
    { name: "Venti", origin: "Genshin Impact", type: "Flying", persona: "Wholesome", portal: "maidCafe" },
    { name: "fr3xi0us", origin: "Project Nights Anthology", type: "Ghost", persona: "Netrunner", portal: "cyberCity" },

    // --- Classic & Modern Cartoons ---
    { name: "SpongeBob SquarePants", origin: "Bikini Bottom", type: "Water", persona: "Wholesome", portal: "bikiniBottom" },
    { name: "Patrick Star", origin: "Bikini Bottom", type: "Water", persona: "Wholesome", portal: "bikiniBottom" },
    { name: "Squidward Tentacles", origin: "Bikini Bottom", type: "Water", persona: "Goth", portal: "bikiniBottom" },
    { name: "Sheldon J. Plankton", origin: "Bikini Bottom", type: "Dark", persona: "Smug", portal: "bikiniBottom" },
    { name: "Sandy Cheeks", origin: "Bikini Bottom", type: "Fighting", persona: "Wholesome", portal: "bikiniBottom" },
    { name: "Eugene H. Krabs", origin: "Bikini Bottom", type: "Normal", persona: "Smug", portal: "bikiniBottom" },
    { name: "Finn the Human", origin: "Land of Ooo", type: "Fighting", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Jake the Dog", origin: "Land of Ooo", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Marceline the Vampire Queen", origin: "Land of Ooo", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Princess Bubblegum", origin: "Candy Kingdom", type: "Psychic", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Ice King", origin: "Ice Kingdom", type: "Ice", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Mordecai", origin: "The Park", type: "Flying", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Rigby", origin: "The Park", type: "Normal", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Benson", origin: "The Park", type: "Steel", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Skips", origin: "The Park", type: "Fighting", persona: "Mystic", portal: "multiverseToons" },
    { name: "Pops Maellard", origin: "The Park", type: "Cosmic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Rick Sanchez", origin: "Dimension C-137", type: "Cosmic", persona: "Smug", portal: "cyberCity" },
    { name: "Morty Smith", origin: "Dimension C-137", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Danny Phantom", origin: "Amity Park", type: "Ghost", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Vlad Plasmius", origin: "Amity Park", type: "Ghost", persona: "Smug", portal: "gothIhop" },
    { name: "Norville 'Shaggy' Rogers", origin: "Mystery Inc.", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Scooby-Doo", origin: "Mystery Inc.", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Ben Tennyson", origin: "Bellwood (Omnitrix)", type: "Cosmic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Kevin Levin", origin: "Bellwood", type: "Steel", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Gwen Tennyson", origin: "Bellwood (Anodite)", type: "Psychic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Dipper Pines", origin: "Gravity Falls", type: "Psychic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Mabel Pines", origin: "Gravity Falls", type: "Fairy", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Bill Cipher", origin: "Mindscape Void", type: "Cosmic", persona: "Smug", portal: "gothIhop" },
    { name: "Aang", origin: "Southern Air Temple", type: "Flying", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Zuko", origin: "Fire Nation", type: "Fire", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Toph Beifong", origin: "Earth Kingdom", type: "Ground", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Katara", origin: "Southern Water Tribe", type: "Water", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Robin", origin: "Teen Titans", type: "Fighting", persona: "Tsundere", portal: "multiverseToons" },
    { name: "Raven", origin: "Azarath", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Starfire", origin: "Tamaran", type: "Fire", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Beast Boy", origin: "Teen Titans", type: "Grass", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Cyborg", origin: "Teen Titans", type: "Steel", persona: "Wholesome", portal: "cyberCity" },
    { name: "Samurai Jack", origin: "Feudal Multiverse", type: "Steel", persona: "Mystic", portal: "waffleHouse" },
    { name: "Aku", origin: "Dark Realm", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Courage the Cowardly Dog", origin: "Nowhere", type: "Ghost", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Dexter", origin: "Dexter's Laboratory", type: "Electric", persona: "Smug", portal: "cyberCity" },
    { name: "Johnny Bravo", origin: "Aron City", type: "Fighting", persona: "Smug", portal: "waffleHouse" },
    { name: "Grim", origin: "Underworld", type: "Ghost", persona: "Goth", portal: "gothIhop" },
    { name: "Billy", origin: "Endsville", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Mandy", origin: "Endsville", type: "Dark", persona: "Goth", portal: "gothIhop" },

    // --- Gaming & Anime Champions ---
    { name: "Cloud Strife", origin: "Final Fantasy VII", type: "Steel", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Sephiroth", origin: "Final Fantasy VII", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Link", origin: "Hyrule Kingdom", type: "Fairy", persona: "Wholesome", portal: "maidCafe" },
    { name: "Princess Zelda", origin: "Hyrule Kingdom", type: "Psychic", persona: "Mystic", portal: "maidCafe" },
    { name: "Ganon", origin: "Gerudo Desert", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Goku", origin: "Planet Vegeta", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Vegeta", origin: "Planet Vegeta", type: "Fire", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Son Gohan", origin: "Mount Paozu", type: "Fighting", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Piccolo", origin: "Namek", type: "Ground", persona: "Mystic", portal: "waffleHouse" },
    { name: "Naruto Uzumaki", origin: "Hidden Leaf", type: "Wind", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Sasuke Uchiha", origin: "Hidden Leaf", type: "Electric", persona: "Goth", portal: "gothIhop" },
    { name: "Monkey D. Luffy", origin: "East Blue", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Roronoa Zoro", origin: "Shimotsuki Village", type: "Steel", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Ichigo Kurosaki", origin: "Karakura Town", type: "Ghost", persona: "Tsundere", portal: "gothIhop" },
    { name: "Saitama", origin: "City Z", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Genos", origin: "City Z", type: "Electric", persona: "Tsundere", portal: "cyberCity" },
    { name: "Sonic the Hedgehog", origin: "Green Hill", type: "Electric", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Miles 'Tails' Prower", origin: "Emerald Coast", type: "Flying", persona: "Wholesome", portal: "cyberCity" },
    { name: "Knuckles the Echidna", origin: "Angel Island", type: "Fighting", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Shadow the Hedgehog", origin: "Space Colony ARK", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Master Chief", origin: "UNSC Spartan II", type: "Steel", persona: "Wholesome", portal: "cyberCity" },
    { name: "Doom Slayer", origin: "Argent D'Nur", type: "Fire", persona: "Goth", portal: "waffleHouse" },
    { name: "Solid Snake", origin: "Shadow Moses", type: "Normal", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Raiden", origin: "World Marshal Hub", type: "Electric", persona: "Netrunner", portal: "cyberCity" },
    { name: "Joker", origin: "Shujin Academy", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Kratos", origin: "Sparta", type: "Fighting", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Dante", origin: "Devil May Cry", type: "Fire", persona: "Smug", portal: "gothIhop" },
    { name: "Vergil", origin: "Devil May Cry", type: "Ice", persona: "Smug", portal: "gothIhop" }
];

const ELEMENTS = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy", "Cosmic", "Luck"];
const PERSONAS = ["Wholesome", "Tsundere", "Goth", "Smug", "Mystic", "Netrunner"];
const PORTALS = ["maidCafe", "waffleHouse", "cyberCity", "gothIhop", "bikiniBottom", "multiverseToons"];

console.log(`Generating ${TOTAL_RECRUITS} recruits for UniDex...`);

const fullDatabase = [];

// 1. Add hand-crafted characters first
CARTOON_AND_LEGEND_RECRUITS.forEach((c, idx) => {
    fullDatabase.push({
        id: idx + 1,
        name: c.name,
        origin: c.origin,
        type: c.type,
        persona: c.persona,
        portal: c.portal,
        evo: `Transcendent ${c.name}`
    });
});

// 2. Procedurally generate the remaining recruits up to 2000
const PREFIXES = ["Chrono", "Cyber", "Aether", "Void", "Shadow", "Starlight", "Solar", "Lunar", "Rift", "Galactic", "Arcane", "Neo", "Prismatic", "Hyper", "Quantum"];
const SUFFIXES = ["Knight", "Operative", "Warlock", "Paladin", "Maid", "Enforcer", "Brawler", "Scout", "Ranger", "Sorcerer", "Guardian", "Pilot", "Duelist", "Samurai"];
const REALMS = ["District 9", "Neo Tokyo", "Aetheria", "Chrono Void", "Sub-Level Zero", "Emerald Spire", "Celestia", "Omega Station", "Nebula Outpost", "Valhalla Hub"];

for (let i = fullDatabase.length + 1; i <= TOTAL_RECRUITS; i++) {
    const pfx = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const sfx = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    const realm = REALMS[Math.floor(Math.random() * REALMS.length)];
    const elem = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    const portal = PORTALS[Math.floor(Math.random() * PORTALS.length)];

    fullDatabase.push({
        id: i,
        name: `${pfx} ${sfx} #${i}`,
        origin: realm,
        type: elem,
        persona: persona,
        portal: portal,
        evo: `Ascended ${pfx} ${sfx}`
    });
}

const outputPath = path.join(__dirname, 'public', 'characters.json');
fs.writeFileSync(outputPath, JSON.stringify(fullDatabase, null, 2), 'utf8');

console.log(`Successfully built and saved ${fullDatabase.length} recruits to ${outputPath}!`);