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
    { name: "Vergil", origin: "Devil May Cry", type: "Ice", persona: "Smug", portal: "gothIhop" },

    // --- Expansion batch: appended (never inserted earlier) so every existing save's
    // dex IDs 1-76 keep pointing at the same character - only new IDs are added on top. ---

    // Dragon Ball expansion
    { name: "Bulma Briefs", origin: "Capsule Corporation", type: "Normal", persona: "Smug", portal: "cyberCity" },
    { name: "Trunks", origin: "Capsule Corporation", type: "Fire", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Android 18", origin: "Red Ribbon Army Ruins", type: "Steel", persona: "Smug", portal: "cyberCity" },
    { name: "Frieza", origin: "Planet Frieza 79", type: "Ice", persona: "Smug", portal: "gothIhop" },
    { name: "Cell", origin: "Cell Games Arena", type: "Bug", persona: "Smug", portal: "gothIhop" },
    { name: "Majin Buu", origin: "Earth (Otherworld)", type: "Psychic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Beerus", origin: "Universe 7", type: "Cosmic", persona: "Smug", portal: "gothIhop" },
    { name: "Whis", origin: "Universe 7", type: "Cosmic", persona: "Mystic", portal: "maidCafe" },

    // Naruto expansion
    { name: "Kakashi Hatake", origin: "Hidden Leaf", type: "Electric", persona: "Mystic", portal: "waffleHouse" },
    { name: "Hinata Hyuga", origin: "Hidden Leaf", type: "Fighting", persona: "Wholesome", portal: "maidCafe" },
    { name: "Itachi Uchiha", origin: "Hidden Leaf", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Gaara", origin: "Hidden Sand", type: "Ground", persona: "Goth", portal: "gothIhop" },
    { name: "Jiraiya", origin: "Mount Myoboku", type: "Normal", persona: "Smug", portal: "waffleHouse" },
    { name: "Tsunade", origin: "Hidden Leaf", type: "Fighting", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Rock Lee", origin: "Hidden Leaf", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Madara Uchiha", origin: "Valley of the End", type: "Dark", persona: "Smug", portal: "gothIhop" },

    // One Piece expansion
    { name: "Nami", origin: "Cocoyasi Village", type: "Electric", persona: "Smug", portal: "bikiniBottom" },
    { name: "Nico Robin", origin: "Ohara", type: "Psychic", persona: "Mystic", portal: "gothIhop" },
    { name: "Sanji", origin: "Baratie", type: "Fire", persona: "Smug", portal: "waffleHouse" },
    { name: "Tony Tony Chopper", origin: "Drum Island", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Portgas D. Ace", origin: "East Blue", type: "Fire", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Trafalgar Law", origin: "North Blue", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Boa Hancock", origin: "Amazon Lily", type: "Fairy", persona: "Smug", portal: "maidCafe" },
    { name: "Shanks", origin: "East Blue", type: "Fire", persona: "Mystic", portal: "waffleHouse" },

    // Bleach & My Hero Academia
    { name: "Rukia Kuchiki", origin: "Soul Society", type: "Ice", persona: "Tsundere", portal: "gothIhop" },
    { name: "Toshiro Hitsugaya", origin: "Soul Society", type: "Ice", persona: "Tsundere", portal: "gothIhop" },
    { name: "Kenpachi Zaraki", origin: "Soul Society", type: "Fighting", persona: "Smug", portal: "waffleHouse" },
    { name: "Izuku Midoriya", origin: "U.A. High School", type: "Fighting", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Katsuki Bakugo", origin: "U.A. High School", type: "Fire", persona: "Tsundere", portal: "waffleHouse" },
    { name: "All Might", origin: "U.A. High School", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Ochaco Uraraka", origin: "U.A. High School", type: "Cosmic", persona: "Wholesome", portal: "maidCafe" },
    { name: "Shoto Todoroki", origin: "U.A. High School", type: "Ice", persona: "Tsundere", portal: "gothIhop" },

    // Demon Slayer & Attack on Titan
    { name: "Tanjiro Kamado", origin: "Taisho-era Japan", type: "Fire", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Nezuko Kamado", origin: "Taisho-era Japan", type: "Fire", persona: "Wholesome", portal: "maidCafe" },
    { name: "Zenitsu Agatsuma", origin: "Taisho-era Japan", type: "Electric", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Giyu Tomioka", origin: "Taisho-era Japan", type: "Water", persona: "Goth", portal: "gothIhop" },
    { name: "Eren Yeager", origin: "Shiganshina District", type: "Ground", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Mikasa Ackerman", origin: "Shiganshina District", type: "Fighting", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Levi Ackerman", origin: "Survey Corps HQ", type: "Fighting", persona: "Smug", portal: "gothIhop" },
    { name: "Armin Arlert", origin: "Shiganshina District", type: "Psychic", persona: "Wholesome", portal: "multiverseToons" },

    // Nintendo & retro gaming expansion
    { name: "Bowser", origin: "Dark Land", type: "Fire", persona: "Smug", portal: "cyberCity" },
    { name: "Princess Peach", origin: "Mushroom Kingdom", type: "Fairy", persona: "Wholesome", portal: "maidCafe" },
    { name: "Yoshi", origin: "Dinosaur Land", type: "Grass", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Kirby", origin: "Dream Land", type: "Fairy", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Meta Knight", origin: "Dream Land", type: "Dark", persona: "Mystic", portal: "gothIhop" },
    { name: "Samus Aran", origin: "Planet Zebes", type: "Steel", persona: "Tsundere", portal: "cyberCity" },
    { name: "Mega Man", origin: "Light Labs", type: "Electric", persona: "Wholesome", portal: "cyberCity" },
    { name: "Pac-Man", origin: "Pac-Land", type: "Normal", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Donkey Kong", origin: "DK Island", type: "Fighting", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Princess Zelda (Wisdom)", origin: "Hyrule Kingdom", type: "Psychic", persona: "Mystic", portal: "maidCafe" },
    { name: "Impa", origin: "Kakariko Village", type: "Steel", persona: "Mystic", portal: "waffleHouse" },
    { name: "Midna", origin: "Twilight Realm", type: "Dark", persona: "Smug", portal: "gothIhop" },

    // Fantasy & modern RPG icons
    { name: "Geralt of Rivia", origin: "The Continent", type: "Dark", persona: "Tsundere", portal: "gothIhop" },
    { name: "Yennefer of Vengerberg", origin: "Vengerberg", type: "Psychic", persona: "Smug", portal: "gothIhop" },
    { name: "Aloy", origin: "The Sacred Land", type: "Ground", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Kirito", origin: "Aincrad", type: "Steel", persona: "Wholesome", portal: "cyberCity" },
    { name: "Asuna Yuuki", origin: "Aincrad", type: "Fire", persona: "Wholesome", portal: "maidCafe" },
    { name: "Edward Elric", origin: "Resembool", type: "Steel", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Alphonse Elric", origin: "Resembool", type: "Steel", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Roy Mustang", origin: "Central City", type: "Fire", persona: "Smug", portal: "gothIhop" },

    // More Western animation
    { name: "Steven Universe", origin: "Beach City", type: "Cosmic", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Garnet", origin: "Beach City", type: "Rock", persona: "Mystic", portal: "waffleHouse" },
    { name: "Amethyst", origin: "Beach City", type: "Ground", persona: "Smug", portal: "cyberCity" },
    { name: "Pearl", origin: "Beach City", type: "Fairy", persona: "Tsundere", portal: "maidCafe" },
    { name: "Twilight Sparkle", origin: "Equestria", type: "Cosmic", persona: "Wholesome", portal: "maidCafe" },
    { name: "Rainbow Dash", origin: "Equestria", type: "Flying", persona: "Smug", portal: "multiverseToons" },
    { name: "He-Man", origin: "Eternia", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "She-Ra", origin: "Etheria", type: "Fighting", persona: "Wholesome", portal: "maidCafe" },
    { name: "Voltron (Black Lion)", origin: "Planet Arus", type: "Steel", persona: "Mystic", portal: "cyberCity" },
    { name: "Azula", origin: "Fire Nation", type: "Fire", persona: "Smug", portal: "gothIhop" },
    { name: "Iroh", origin: "Fire Nation", type: "Fire", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Appa", origin: "Southern Air Temple", type: "Flying", persona: "Wholesome", portal: "multiverseToons" },

    // Fighting games & shooters
    { name: "Ryu", origin: "Street Fighter Dojo", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Chun-Li", origin: "Street Fighter Dojo", type: "Fighting", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Scorpion", origin: "Netherrealm", type: "Fire", persona: "Goth", portal: "gothIhop" },
    { name: "Sub-Zero", origin: "Lin Kuei Temple", type: "Ice", persona: "Goth", portal: "gothIhop" },
    { name: "Tracer", origin: "Overwatch HQ", type: "Electric", persona: "Wholesome", portal: "cyberCity" },
    { name: "Reaper", origin: "Overwatch HQ", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "D.Va", origin: "Overwatch HQ", type: "Steel", persona: "Smug", portal: "cyberCity" },
    { name: "2B", origin: "YoRHa Bunker", type: "Steel", persona: "Goth", portal: "gothIhop" },

    // Genshin Impact & Persona expansion
    { name: "Paimon", origin: "Teyvat", type: "Fairy", persona: "Wholesome", portal: "maidCafe" },
    { name: "Klee", origin: "Mondstadt", type: "Fire", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Zhongli", origin: "Liyue Harbor", type: "Rock", persona: "Mystic", portal: "waffleHouse" },
    { name: "Raiden Shogun", origin: "Inazuma", type: "Electric", persona: "Smug", portal: "gothIhop" },
    { name: "Morgana", origin: "Shujin Academy", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Yusuke Kitagawa", origin: "Shujin Academy", type: "Fire", persona: "Smug", portal: "waffleHouse" },
    { name: "Ann Takamaki", origin: "Shujin Academy", type: "Fire", persona: "Tsundere", portal: "maidCafe" },

    // Sailor Moon & JoJo's Bizarre Adventure
    { name: "Sailor Moon", origin: "Crystal Tokyo", type: "Cosmic", persona: "Wholesome", portal: "maidCafe" },
    { name: "Sailor Mercury", origin: "Crystal Tokyo", type: "Water", persona: "Wholesome", portal: "maidCafe" },
    { name: "Tuxedo Mask", origin: "Crystal Tokyo", type: "Cosmic", persona: "Mystic", portal: "waffleHouse" },
    { name: "Jotaro Kujo", origin: "Morioh Town", type: "Steel", persona: "Smug", portal: "gothIhop" },
    { name: "Dio Brando", origin: "Morioh Town", type: "Dark", persona: "Smug", portal: "gothIhop" },
    { name: "Josuke Higashikata", origin: "Morioh Town", type: "Rock", persona: "Smug", portal: "waffleHouse" },

    // Halo, Doom & Metal Gear expansion
    { name: "Cortana", origin: "UNSC Infinity", type: "Cosmic", persona: "Mystic", portal: "cyberCity" },
    { name: "Arbiter", origin: "Sanghelios", type: "Steel", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Grunt (Doom)", origin: "Argent D'Nur", type: "Fire", persona: "Smug", portal: "gothIhop" },
    { name: "Revenant", origin: "Argent D'Nur", type: "Dark", persona: "Goth", portal: "gothIhop" },
    { name: "Big Boss", origin: "Outer Heaven", type: "Normal", persona: "Smug", portal: "waffleHouse" },
    { name: "Grey Fox", origin: "Shadow Moses", type: "Steel", persona: "Goth", portal: "gothIhop" },

    // God of War & Devil May Cry expansion
    { name: "Atreus", origin: "Midgard", type: "Ice", persona: "Wholesome", portal: "multiverseToons" },
    { name: "Freya", origin: "Vanaheim", type: "Fairy", persona: "Mystic", portal: "maidCafe" },
    { name: "Nero", origin: "Devil May Cry", type: "Steel", persona: "Tsundere", portal: "gothIhop" },
    { name: "Lady", origin: "Devil May Cry", type: "Normal", persona: "Smug", portal: "waffleHouse" },

    // Final Fantasy expansion
    { name: "Tifa Lockhart", origin: "Final Fantasy VII", type: "Fighting", persona: "Wholesome", portal: "maidCafe" },
    { name: "Aerith Gainsborough", origin: "Final Fantasy VII", type: "Grass", persona: "Wholesome", portal: "maidCafe" },
    { name: "Barret Wallace", origin: "Final Fantasy VII", type: "Steel", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Yuna", origin: "Spira", type: "Psychic", persona: "Wholesome", portal: "maidCafe" },
    { name: "Lightning", origin: "Cocoon", type: "Steel", persona: "Tsundere", portal: "gothIhop" },
    { name: "Noctis Lucis Caelum", origin: "Insomnia", type: "Dark", persona: "Smug", portal: "gothIhop" },

    // More classic cartoons
    { name: "Tom (Tom & Jerry)", origin: "Suburban House", type: "Normal", persona: "Smug", portal: "multiverseToons" },
    { name: "Jerry (Tom & Jerry)", origin: "Suburban House", type: "Normal", persona: "Smug", portal: "multiverseToons" },
    { name: "Bugs Bunny", origin: "Looney Tunes Burrow", type: "Normal", persona: "Smug", portal: "waffleHouse" },
    { name: "Daffy Duck", origin: "Looney Tunes Burrow", type: "Normal", persona: "Tsundere", portal: "waffleHouse" },
    { name: "Taz", origin: "Tasmania", type: "Fighting", persona: "Smug", portal: "waffleHouse" },
    { name: "Popeye", origin: "Sweethaven", type: "Fighting", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Woody Woodpecker", origin: "Woody's Forest", type: "Flying", persona: "Smug", portal: "multiverseToons" },

    // Modern streaming-era anime
    { name: "Anya Forger", origin: "Ostania", type: "Psychic", persona: "Wholesome", portal: "maidCafe" },
    { name: "Loid Forger", origin: "Ostania", type: "Dark", persona: "Smug", portal: "cyberCity" },
    { name: "Yor Forger", origin: "Ostania", type: "Fighting", persona: "Tsundere", portal: "gothIhop" },
    { name: "Rimuru Tempest", origin: "Tempest Nation", type: "Water", persona: "Wholesome", portal: "waffleHouse" },
    { name: "Rem (Re:Zero)", origin: "Roswaal Mansion", type: "Ice", persona: "Wholesome", portal: "maidCafe" },
    { name: "Emilia", origin: "Roswaal Mansion", type: "Ice", persona: "Wholesome", portal: "maidCafe" },
    { name: "Megumin", origin: "Axel Town", type: "Fire", persona: "Smug", portal: "gothIhop" },
    { name: "Kazuma Satou", origin: "Axel Town", type: "Normal", persona: "Smug", portal: "waffleHouse" }
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