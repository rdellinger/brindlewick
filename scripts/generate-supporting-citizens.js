#!/usr/bin/env node
/**
 * Generates 893 supporting citizens for Brindlewick.
 * Principal citizens (50) are in citizens/principal.json.
 * Supporting citizens have: id, name, age, gender, occupation, address,
 * household, personality_trait, routine_summary, gossip, help_task (nullable).
 */

const fs = require('fs');
const path = require('path');

// ── Data pools ──────────────────────────────────────────────────────────────

const firstNamesF = [
  'Abigail','Ada','Agnes','Alice','Alma','Amelia','Anna','Annie','Beatrice',
  'Bertha','Bethany','Bonnie','Brenda','Bridget','Calla','Candace','Carol',
  'Catherine','Cecelia','Charity','Charlotte','Clara','Claudia','Colleen',
  'Constance','Coral','Cornelia','Daisy','Dana','Deborah','Delia','Della',
  'Diane','Dolores','Donna','Dora','Dorothy','Edith','Eileen','Elaine',
  'Eleanor','Elena','Eliza','Elizabeth','Ella','Ellen','Eloise','Elsie',
  'Emily','Emma','Esther','Ethel','Eva','Evelyn','Faith','Fanny','Faye',
  'Felicity','Fern','Florence','Frances','Gail','Gertrude','Gladys','Gloria',
  'Grace','Hannah','Harriet','Hazel','Heather','Helen','Hester','Holly',
  'Hope','Ida','Ingrid','Iris','Irma','Isabel','Ivy','Jane','Janet','Jean',
  'Jess','Joan','Josephine','Joy','Joyce','Julia','June','Karen','Kate',
  'Kay','Lena','Leona','Lily','Lois','Louise','Lucy','Lydia','Mae','Maggie',
  'Mabel','Maren','Margery','Marion','Martha','Mary','Maud','May','Mildred',
  'Millie','Minerva','Miriam','Molly','Muriel','Myrtle','Nancy','Nell',
  'Nellie','Nora','Norma','Olive','Pamela','Patricia','Pearl','Peggy',
  'Penelope','Phyllis','Polly','Prudence','Rachel','Rebecca','Regina',
  'Roberta','Rosa','Rose','Ruth','Sadie','Sally','Sandra','Sara','Selma',
  'Shirley','Sophia','Sue','Susan','Susanna','Sylvia','Tess','Tilda',
  'Vera','Victoria','Viola','Violet','Virginia','Vivian','Wanda','Winona',
  'Winifred','Yvonne','Zelda',
  // modern names
  'Aaliyah','Ava','Brianna','Chloe','Emma','Grace','Harper','Isabella',
  'Jade','Kayla','Lauren','Madison','Mia','Natalie','Olivia','Paige',
  'Quinn','Riley','Samantha','Sofia','Taylor','Zoe'
];

const firstNamesM = [
  'Aaron','Abraham','Adam','Albert','Alfred','Alton','Alvin','Andrew',
  'Anthony','Archibald','Arthur','Barney','Benjamin','Bernard','Bert',
  'Blake','Boyd','Bradley','Brian','Bruce','Byron','Calvin','Carl',
  'Carroll','Cecil','Charles','Chester','Clarence','Clark','Claude',
  'Clayton','Clifford','Clyde','Conrad','Curtis','Dale','Daniel','David',
  'Dean','Dennis','Donald','Douglas','Earl','Eddie','Edgar','Edmund',
  'Edward','Edwin','Eli','Elmer','Ernest','Eugene','Ezra','Floyd',
  'Francis','Frank','Fred','Frederic','Gary','George','Gerald','Glen',
  'Gordon','Grant','Gregory','Harold','Harry','Harvey','Henry','Herbert',
  'Herman','Howard','Hugh','Irwin','Ivan','Jack','Jacob','James','Jason',
  'Jay','Jeffrey','Jerome','Jesse','Joel','John','Jonathan','Joseph',
  'Kenneth','Lawrence','Leonard','Lester','Lewis','Lloyd','Loren','Louis',
  'Lucas','Luther','Martin','Matthew','Maurice','Melvin','Michael',
  'Mitchell','Monroe','Nathan','Neil','Nelson','Norman','Oliver','Orville',
  'Oscar','Otto','Owen','Patrick','Paul','Peter','Philip','Ralph','Raymond',
  'Richard','Robert','Roger','Roland','Ronald','Roscoe','Roy','Russell',
  'Samuel','Scott','Sherman','Sidney','Stanley','Stephen','Stuart','Thomas',
  'Timothy','Todd','Tracy','Trevor','Ulysses','Vernon','Victor','Vincent',
  'Walter','Warren','Wayne','Wesley','Wilbur','William','Wilson','Woodrow',
  // modern names
  'Aiden','Brandon','Caleb','Dylan','Ethan','Finn','Gavin','Hudson',
  'Ian','Jake','Liam','Mason','Noah','Owen','Parker','Ryan','Tyler','Wyatt'
];

const lastNames = [
  'Abbott','Adams','Aldrich','Allen','Anderson','Andrews','Arnold','Atkins',
  'Austin','Bailey','Baker','Baldwin','Barker','Barnes','Barrett','Barry',
  'Bass','Bean','Bell','Bennett','Bishop','Black','Blake','Booth','Boyd',
  'Bradley','Brady','Briggs','Brown','Bryant','Burke','Burns','Burton',
  'Butler','Caldwell','Campbell','Carey','Carlson','Carpenter','Carroll',
  'Carter','Casey','Chapman','Chase','Clark','Cole','Coleman','Collins',
  'Cook','Cooper','Cox','Craig','Cross','Curtis','Davis','Dean','Decker',
  'Dixon','Drake','Duncan','Dunn','Edwards','Elliott','Ellis','Evans',
  'Farrell','Ferguson','Fields','Fisher','Fleming','Fletcher','Ford',
  'Foster','Fox','Franklin','Freeman','Fuller','Gallagher','Gardner',
  'Gibson','Gilbert','Graham','Gray','Green','Gregory','Griffin','Hall',
  'Hamilton','Hammond','Harper','Harris','Hart','Harvey','Hayes','Henderson',
  'Hill','Holt','Hopkins','Howard','Howell','Hudson','Hughes','Hunt',
  'Hunter','Ingram','Jackson','James','Jenkins','Johnson','Jones','Jordan',
  'Kane','Kelley','Kennedy','Kent','King','Knight','Lane','Lawrence',
  'Lee','Lewis','Long','Lynch','Mason','Matthews','May','McCarthy',
  'McDonald','McLean','Mills','Mitchell','Moore','Morgan','Morris','Murphy',
  'Murray','Myers','Nash','Nelson','Newton','Noble','Norris','Norton',
  'Owens','Page','Parker','Payne','Perry','Peterson','Phillips','Pierce',
  'Porter','Potter','Powell','Preston','Price','Quinn','Reed','Reynolds',
  'Rhodes','Rice','Richardson','Riley','Roberts','Robinson','Rogers',
  'Ross','Russell','Ryan','Sanders','Shaw','Sherman','Simmons','Simpson',
  'Sloan','Smith','Spencer','Stephens','Stevens','Stone','Sullivan',
  'Sutton','Taylor','Thompson','Thornton','Todd','Tucker','Turner','Tyler',
  'Underwood','Vaughan','Voss','Wade','Wagner','Walker','Wallace','Walsh',
  'Ward','Warren','Watson','Wells','West','Wheeler','White','Whitmore',
  'Wilkins','Williams','Willis','Wilson','Wood','Woodward','Young',
  // New England flavor
  'Alderman','Birch','Chase','Copley','Crane','Finch','Flint','Frost',
  'Gale','Hartley','Haven','Hollis','Kendall','Kimball','Larkin','Marsh',
  'Morse','Niles','Norwood','Oakes','Parris','Peabody','Phelps','Pratt',
  'Proctor','Putnam','Sawyer','Seaver','Sprague','Stearns','Storey',
  'Thayer','Wade','Whitfield','Whitney','Whittaker','Woodbury'
];

const occupations = [
  // Trades & manual
  'carpenter','electrician','plumber','stonemason','painter','roofer',
  'mechanic','auto body technician','blacksmith (historical reproduction)',
  'logger (retired)','mill worker (retired)','dairy farmer','sheep farmer',
  'beekeeper','market gardener','tree surgeon','groundskeeper','landscaper',
  'snow plow operator','road crew worker',
  // Professional services
  'accountant','bookkeeper','insurance agent','real estate agent',
  'notary public','land surveyor','civil engineer (remote work)',
  'architect (retired)','attorney (semi-retired)','financial advisor',
  // Healthcare & care
  'home health aide','dental hygienist (drives to regional clinic)',
  'physical therapist','veterinary technician','childcare provider',
  'elder care companion',
  // Education & culture
  'retired teacher','substitute teacher','school librarian (part-time)',
  'music teacher','art teacher','school bus driver','principal (retired)',
  // Hospitality & food
  'chef (retired)','line cook','baker (part-time)','barista',
  'wait staff','hotel maintenance','inn cleaner','catering assistant',
  // Retail & commerce
  'shop clerk','delivery driver','postal worker (part-time)',
  'general store assistant','pharmacy technician','greenhouse worker',
  // Arts & crafts
  'knitter (hobbyist, part-time instructor)','quilter','woodworker',
  'bookbinder','leatherworker','jewelry maker','calligrapher',
  'watercolor artist','photographer','folk musician',
  // Rural & outdoor
  'hunting guide (seasonal)','fishing guide (seasonal)',
  'hiking guide','bird watcher (amateur naturalist)','forager',
  'wilderness first responder (volunteer)','lake patrol (volunteer)',
  // Office & admin
  'town council member','planning board member','library volunteer',
  'fire department volunteer','church council member','grange board member',
  'historical society member','garden club member',
  // Remote/modern
  'remote software developer','remote writer','remote accountant',
  'remote designer','remote customer service','freelance translator',
  'online tutor','podcast producer',
  // Retired
  'retired postman','retired nurse','retired farmer','retired teacher',
  'retired shopkeeper','retired engineer','retired librarian',
  'retired firefighter','retired social worker'
];

const personalityTraits = [
  'always has a thermos of coffee and offers to share',
  'remembers exactly what everyone ordered the last time they ate together',
  'keeps a kitchen garden and brings surplus vegetables to neighbors',
  'has strong opinions about proper pie crust and will explain them',
  'volunteers for every town committee that needs a warm body',
  'greets the mail carrier every morning without fail',
  'knows the name of every dog in town',
  'can fix most things with string and patience',
  'keeps every card and letter ever received in a shoebox',
  'makes a point of learning the names of newcomers immediately',
  'has a remarkable memory for dates and anniversaries',
  'always has a good book on the go and recommends them freely',
  'bakes something new every Sunday and leaves the extra on neighbors\' steps',
  'walks the same route every morning and greets everything on it',
  'collects small stones from places that meant something',
  'has an opinion about the weather that is usually correct',
  'photographs the lake in every season and fills albums with them',
  'grows prize-winning vegetables without making a fuss about it',
  'teaches children things they didn\'t ask to learn but are glad they know',
  'stops to help anyone who looks lost or confused',
  'keeps a journal and has for thirty years',
  'brings food to anyone who\'s had a hard week without being asked',
  'has a workshop in the garage and makes gifts for people who need them',
  'watches birds with the dedication other people give to sports',
  'knows which wild plants are edible and where to find them',
  'repairs rather than replaces whenever possible',
  'holds the door for people who are still half a block away',
  'always remembers what you told them last time',
  'has an herb garden that gets out of hand every summer',
  'makes the best pie in their household, which is saying something'
];

const gossipPool = [
  'Remembers when the covered bridge was nearly demolished in 1987. Helped organize the petition that saved it.',
  'Knows the Wren & Whistle had a parrot behind the bar in the 1970s that outlived two owners before going to live at the school.',
  'Swears the best fishing spot in the lake is the shelf off Spruce Point at dawn on Tuesdays. Won\'t explain the Tuesday part.',
  'Their grandfather knew Fletcher Alderman, who woke the town during the 1879 flood. Says the story\'s in a letter somewhere.',
  'Remembers the winter of 1993 when the lake froze hard enough to drive on. The fire truck drove out to the center for a photograph.',
  'Has it on good authority that the missing Chronicle issues from 1918 were taken by a family who didn\'t want something recorded.',
  'Noticed the clocktower runs three minutes slow and once tried to report it as a maintenance issue. The response was \'Yes, we know. Leave it alone.\'',
  'Saw Constance Alderman and Agnes Perkins at the Wren & Whistle once and they were laughing about something. They claimed to be arguing.',
  'Remembers Dr. Okafor\'s first year in town — when he arrived, three different families had been making him pies competitively for months.',
  'Knows about the note that arrived under their door years ago when they were going through a hard time. Still has it.',
  'Has a photograph of the town square from 1952 where the war memorial isn\'t there yet. The square looks naked without it.',
  'Recalls the first Farmer\'s Market, which was three tables and a jar of jam. Attended the first one. Plans to attend the last.',
  'Knows the old Station Master\'s House still has the key on the nail by the door. Says Gerald Hobbs probably expected to come back.',
  'Believes the lake is deeper than anyone has officially measured. The town\'s survey boats have never covered the southern section.',
  'Grew up on the same street as Oliver Peregrine and has always suspected he wrote the Dear Neighbor column. Never asked.',
  'Says their mother taught them that certain flowers on the covered bridge mean something but has forgotten what.',
  'Claims to have seen the lake light three times and describes it differently each time — not inconsistently, but with more detail.',
  'Knows the Harvest Fair pie competition was once stopped for three years due to a judging controversy. The pie in question was a gooseberry.',
  'Their great-aunt was one of the women who organized the library\'s move to its own building in 1899. Found her name in the dedication.',
  'Mentions the hidden garden at the Alderman Estate as \'the place you can smell in summer if the wind is right.\'',
  'Says the mailman Artie Pryce once walked his route during a blizzard when no one else could get out. He says it was nothing. It wasn\'t.',
  'Remembers Harold Hartwell\'s father, who ran the general store before him, and says the store hasn\'t changed except the prices.',
  'Has a piece of original beadwork from the Finch family estate sale in 1940 that they\'ve never properly identified.',
  'Recalls a summer when the lake had an unusual clarity — you could see the bottom at fifteen feet — and everyone swam in it every day.',
  'Mentions that the bench at the Lookout was placed in memory of Dorothy Webb, Rosalind\'s mother, who went up there every birthday.',
  'Knows about the 1937 rebuild of Hartwell\'s General Store because their grandmother helped carry the new counter in.',
  'Swears the Millpond Diner\'s coffee recipe hasn\'t changed since 1993. This is correct. Wally hasn\'t touched it.',
  'Says the pottery studio cat, Penelope at the Book Nook, appears on the Local History shelf because cats know things.',
  'Remembers when the Christmas tree lighting was moved from December 6 to the first Sunday in December. There was debate.',
  'Has an opinion about the midsummer walk route and thinks the south ridge is more beautiful at sunset than the Lookout. Wrong but held sincerely.',
  'Knows that the warming hut visitor log has an entry from 2003: \'Found what I was looking for. Will return.\' Same wording as the inn guest book.',
  'Grew up believing the ice house was haunted. Now believes it\'s just cold and old. Both may be true.',
  'Says their neighbor started a compost pile in 2018 and the whole street has gotten in on it. The gardens that year were extraordinary.',
  'Remembers the year the First Snow Social was accidentally scheduled at the same time as a power outage, and someone lit candles, and it was better.',
  'Notes that the original schoolhouse bell from 1836 still rings at the elementary school every morning, which is a thing worth noticing.',
  'Heard from their cousin that Marigold Osei tried her honey cake recipe in London once and it wasn\'t right. The air here does something.',
  'Knows there are three families in town who have lived continuously in Brindlewick since before 1870. Counts them off with pride.',
  'Says the library reading room fireplace is the best place in town to wait out a rainstorm. There is a chair by it that is always warm.'
];

const streets = [
  'Finch Lane','Maple Row','Birch Hollow Road','Lake Street','Millpond Row',
  'Heron\'s Creek Road','Alderman Road','North Road','Church Street',
  'Old Mill Road','Spruce Point Lane','Lakeview Drive','Orchard Way',
  'Chapel Close','Grange Road','Station Road','Meadow Lane'
];

// ── Generator helpers ────────────────────────────────────────────────────────

let seed = 12345;
function seededRandom() {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0xffffffff;
}
function pick(arr) {
  return arr[Math.floor(seededRandom() * arr.length)];
}
function pickN(arr, n) {
  const result = [];
  const copy = [...arr];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(seededRandom() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}
function randInt(min, max) {
  return Math.floor(seededRandom() * (max - min + 1)) + min;
}

const ROUTINE_LOCATIONS = [
  'home','millpond_row','town_square','lakefront_boardwalk','finch_lane',
  'maple_row','wren_and_whistle','st_agathas_chapel','library',
  'community_hall','copper_kettle_bakery','hartwells_general_store',
  'millpond_diner','farmers_market','elementary_school','fire_station',
  'copper_hill_trail','herons_creek_trail','lakeside_park','lake_pier'
];

function makeRoutine() {
  const morning = pick(['home','millpond_row','maple_row','work_location']);
  const afternoon = pick(ROUTINE_LOCATIONS);
  const evening = pick(['home','wren_and_whistle','library','community_hall','home','home']);
  const weekend = pick(ROUTINE_LOCATIONS);
  return { weekday_morning: morning, weekday_afternoon: afternoon, evening, weekend };
}

function makeHousehold(id, gender, age) {
  // Some citizens live alone, some with partner, some with family
  const r = seededRandom();
  if (age < 28 || r > 0.7) return [];
  if (r > 0.4) return [`spouse_of_${id}`];
  return [`spouse_of_${id}`, `child_of_${id}`];
}

function makeHelpTask(idx) {
  const tasks = [
    null, null, null, // most citizens have no task
    { id: `task_${idx}`, description: 'Has a garden that needs help before winter sets in.', reward_lore: 'Shares a memory of the town in a past decade.', trust_gain: 1 },
    { id: `task_${idx}`, description: 'Looking for help carrying groceries home from the market — their bicycle basket broke.', reward_lore: 'Tells you about a local family that moved away in the 1980s.', trust_gain: 1 },
    { id: `task_${idx}`, description: 'Has a package at the post office they can\'t carry alone.', reward_lore: 'Mentions a piece of town gossip relevant to an open mystery.', trust_gain: 1 },
    { id: `task_${idx}`, description: 'Needs someone to walk their dog on a day they\'re unwell.', reward_lore: 'Tells you about the dog\'s unusual habit of sitting on Artie\'s route.', trust_gain: 1 },
    null, null, null, null
  ];
  return pick(tasks);
}

// ── Main generation ──────────────────────────────────────────────────────────

const PRINCIPAL_IDS = new Set([
  'eleanor_finch_hartwell','harold_hartwell','marigold_osei','dr_okafor',
  'constance_alderman','teddy_birch','rosalind_webb','oliver_peregrine',
  'juni_salcedo','barnaby_mossgrove','fletcher_grange','agnes_perkins',
  'artie_pryce','nola_finch','mayor_windermere','sheriff_quartermaine',
  'petra_holloway','clem_rourke','sylvie_tran','wally_chen','sadie_mirabel',
  'gus_fairweather','miriam_thatcher','reverend_prewitt','dorothy_alderman',
  'beatrice_meadow','margaret_hollis','flora_kincaid','dale_putnam',
  'minji_choi','edna_thornbury','parveen_nair','vera_tibbs','june_chen',
  'dot_flowers','tommy_hall','hettie_mossgrove'
]);

const citizens = [];
let count = 0;
let nameIdx = 0;

// Build a pool of unique names
const namePool = [];
for (let i = 0; i < 600; i++) {
  namePool.push({ first: firstNamesF[i % firstNamesF.length], gender: 'female' });
}
for (let i = 0; i < 600; i++) {
  namePool.push({ first: firstNamesM[i % firstNamesM.length], gender: 'male' });
}
// Shuffle name pool
for (let i = namePool.length - 1; i > 0; i--) {
  const j = Math.floor(seededRandom() * (i + 1));
  [namePool[i], namePool[j]] = [namePool[j], namePool[i]];
}

const usedIds = new Set(PRINCIPAL_IDS);

while (count < 893) {
  const nameEntry = namePool[nameIdx % namePool.length];
  nameIdx++;

  const firstName = nameEntry.first;
  const gender = nameEntry.gender;
  const lastName = pick(lastNames);
  const age = randInt(8, 88);

  // Generate stable ID
  const rawId = `${firstName.toLowerCase()}_${lastName.toLowerCase()}_${count}`;
  const id = rawId.replace(/[^a-z0-9_]/g, '_');

  if (usedIds.has(id)) continue;
  usedIds.add(id);

  const houseNumber = randInt(1, 60);
  const street = pick(streets);

  const citizen = {
    id,
    first_name: firstName,
    last_name: lastName,
    age,
    gender,
    occupation: pick(occupations),
    address: `${houseNumber} ${street}`,
    household: makeHousehold(id, gender, age),
    personality_trait: pick(personalityTraits),
    routine: makeRoutine(),
    gossip: pick(gossipPool),
    help_task: makeHelpTask(count),
    tier: 'supporting'
  };

  citizens.push(citizen);
  count++;
}

// Write output
const outPath = path.join(__dirname, '..', 'content', 'citizens', 'supporting.json');
fs.writeFileSync(outPath, JSON.stringify({ supporting_citizens: citizens, count: citizens.length }, null, 2));
console.log(`Generated ${citizens.length} supporting citizens → ${outPath}`);
