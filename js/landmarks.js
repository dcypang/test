/* ============================================================
   Landmark database.

   tier 1 = world famous, 2 = well known, 3 = trickier
   wiki    = English Wikipedia article title (used to fetch a photo at runtime)
   clue    = spoiler-free description, shown if the photo cannot be loaded
   fact    = revealed after the answer
   lat/lng = the landmark itself, not the city centre
   ============================================================ */
(function (window) {
  'use strict';

  window.LANDMARKS = [
    /* ---------------- tier 1 ---------------- */
    { id:'eiffel', name:'Eiffel Tower', city:'Paris', country:'France', lat:48.8584, lng:2.2945, tier:1,
      wiki:'Eiffel Tower',
      clue:'A 330 m wrought-iron lattice tower standing on a riverside parade ground.',
      fact:'Built for the 1889 World’s Fair and meant to be dismantled after 20 years — the radio antenna on top saved it.' },

    { id:'colosseum', name:'Colosseum', city:'Rome', country:'Italy', lat:41.8902, lng:12.4922, tier:1,
      wiki:'Colosseum',
      clue:'A vast oval stone amphitheatre with tiers of arches, partly collapsed on one side.',
      fact:'It held roughly 50,000 spectators and could be emptied through 80 entrances in minutes.' },

    { id:'liberty', name:'Statue of Liberty', city:'New York City', country:'USA', lat:40.6892, lng:-74.0445, tier:1,
      wiki:'Statue of Liberty',
      clue:'A copper statue of a robed woman with a torch, standing on an island in a harbour.',
      fact:'A gift from France in 1886; the copper skin is only about 2.4 mm thick.' },

    { id:'bigben', name:'Elizabeth Tower (Big Ben)', city:'London', country:'United Kingdom', lat:51.5007, lng:-0.1246, tier:1,
      wiki:'Big Ben',
      clue:'A Gothic Revival clock tower at the end of a riverside parliament building.',
      fact:'"Big Ben" is really the 13.7-tonne bell inside; the tower was renamed Elizabeth Tower in 2012.' },

    { id:'operahouse', name:'Sydney Opera House', city:'Sydney', country:'Australia', lat:-33.8568, lng:151.2153, tier:1,
      wiki:'Sydney Opera House',
      clue:'A harbourside performing arts centre roofed with white shell-like vaults.',
      fact:'Jørn Utzon cracked the roof geometry by cutting all the shells from the surface of a single sphere.' },

    { id:'taj', name:'Taj Mahal', city:'Agra', country:'India', lat:27.1751, lng:78.0421, tier:1,
      wiki:'Taj Mahal',
      clue:'A symmetrical white marble mausoleum with a central dome and four corner minarets.',
      fact:'The minarets lean very slightly outwards so they would fall away from the tomb in an earthquake.' },

    { id:'redeemer', name:'Christ the Redeemer', city:'Rio de Janeiro', country:'Brazil', lat:-22.9519, lng:-43.2105, tier:1,
      wiki:'Christ the Redeemer (statue)',
      clue:'A 30 m soapstone statue with outstretched arms on a forested mountain above a bay.',
      fact:'It sits on Corcovado at 700 m and is struck by lightning several times a year.' },

    { id:'goldengate', name:'Golden Gate Bridge', city:'San Francisco', country:'USA', lat:37.8199, lng:-122.4783, tier:1,
      wiki:'Golden Gate Bridge',
      clue:'An orange-red suspension bridge across a fog-prone strait.',
      fact:'The colour is "International Orange", chosen over the Navy’s proposal of black with yellow stripes.' },

    { id:'burj', name:'Burj Khalifa', city:'Dubai', country:'United Arab Emirates', lat:25.1972, lng:55.2744, tier:1,
      wiki:'Burj Khalifa',
      clue:'The world’s tallest building — a tapering, spired tower in a desert city.',
      fact:'At 828 m it is so tall that people on lower floors break their Ramadan fast before those at the top.' },

    { id:'brandenburg', name:'Brandenburg Gate', city:'Berlin', country:'Germany', lat:52.5163, lng:13.3777, tier:1,
      wiki:'Brandenburg Gate',
      clue:'A neoclassical sandstone gate of twelve columns topped by a chariot drawn by four horses.',
      fact:'It stood in the no-man’s-land of the Berlin Wall from 1961 to 1989, unreachable from either side.' },

    { id:'sagrada', name:'Sagrada Família', city:'Barcelona', country:'Spain', lat:41.4036, lng:2.1744, tier:1,
      wiki:'Sagrada Família',
      clue:'An unfinished basilica of organic, melting-looking stone spires bristling with cranes.',
      fact:'Under construction since 1882; Gaudí is buried in its crypt.' },

    { id:'tokyotower', name:'Tokyo Tower', city:'Tokyo', country:'Japan', lat:35.6586, lng:139.7454, tier:1,
      wiki:'Tokyo Tower',
      clue:'A white-and-orange lattice broadcasting tower resembling a taller Eiffel Tower.',
      fact:'At 333 m it is 9 m taller than the Eiffel Tower, but weighs less than half as much.' },

    { id:'sphinx', name:'Great Sphinx of Giza', city:'Giza', country:'Egypt', lat:29.9753, lng:31.1376, tier:1,
      wiki:'Great Sphinx of Giza',
      clue:'A limestone lion-bodied figure with a human head, crouched near stepped pyramids.',
      fact:'Carved from a single ridge of bedrock, it is about 73 m long and 20 m high.' },

    { id:'pisa', name:'Leaning Tower of Pisa', city:'Pisa', country:'Italy', lat:43.7230, lng:10.3966, tier:1,
      wiki:'Leaning Tower of Pisa',
      clue:'A round marble bell tower of stacked arcades, tilting noticeably to one side.',
      fact:'It began tilting during construction in 1173; stabilising work in the 1990s removed about 45 cm of lean.' },

    { id:'spaceneedle', name:'Space Needle', city:'Seattle', country:'USA', lat:47.6205, lng:-122.3493, tier:1,
      wiki:'Space Needle',
      clue:'A 1960s-futurist observation tower with a flying-saucer top deck.',
      fact:'Built for the 1962 World’s Fair and designed to withstand winds of 320 km/h.' },

    { id:'parthenon', name:'Parthenon', city:'Athens', country:'Greece', lat:37.9715, lng:23.7267, tier:1,
      wiki:'Parthenon',
      clue:'A ruined marble temple with Doric columns crowning a rocky citadel above a city.',
      fact:'Its columns bulge slightly and lean inward — optical corrections so it looks perfectly straight.' },

    { id:'stbasils', name:'Saint Basil’s Cathedral', city:'Moscow', country:'Russia', lat:55.7525, lng:37.6231, tier:1,
      wiki:"Saint Basil's Cathedral",
      clue:'A cathedral of swirling, multicoloured onion domes beside a huge central square.',
      fact:'It is really nine chapels on one foundation; the bright colours were added centuries after it was built.' },

    { id:'cntower', name:'CN Tower', city:'Toronto', country:'Canada', lat:43.6426, lng:-79.3871, tier:1,
      wiki:'CN Tower',
      clue:'A 553 m concrete communications tower with a round pod near the top.',
      fact:'It held the record for world’s tallest free-standing structure for 32 years.' },

    { id:'marinabay', name:'Marina Bay Sands', city:'Singapore', country:'Singapore', lat:1.2834, lng:103.8607, tier:1,
      wiki:'Marina Bay Sands',
      clue:'Three curved hotel towers carrying a boat-shaped sky park with an infinity pool.',
      fact:'The rooftop SkyPark is longer than the Eiffel Tower is tall.' },

    { id:'petronas', name:'Petronas Towers', city:'Kuala Lumpur', country:'Malaysia', lat:3.1578, lng:101.7117, tier:1,
      wiki:'Petronas Towers',
      clue:'Twin steel-clad skyscrapers joined halfway up by a double-decker sky bridge.',
      fact:'The floor plans are based on an eight-pointed Islamic geometric star.' },

    /* ---------------- tier 2 ---------------- */
    { id:'charlesbridge', name:'Charles Bridge', city:'Prague', country:'Czechia', lat:50.0865, lng:14.4114, tier:2,
      wiki:'Charles Bridge',
      clue:'A medieval stone bridge lined with baroque statues, ending in a gothic gate tower.',
      fact:'Begun in 1357 — legend says egg yolks were mixed into the mortar for strength.' },

    { id:'atomium', name:'Atomium', city:'Brussels', country:'Belgium', lat:50.8949, lng:4.3415, tier:2,
      wiki:'Atomium',
      clue:'Nine giant polished spheres connected by tubes, forming a crystal shape.',
      fact:'Built for Expo 58; it models an iron crystal magnified 165 billion times.' },

    { id:'mermaid', name:'The Little Mermaid', city:'Copenhagen', country:'Denmark', lat:55.6929, lng:12.5993, tier:2,
      wiki:'The Little Mermaid (statue)',
      clue:'A small bronze figure on a harbour-side rock, far smaller than visitors expect.',
      fact:'Just 1.25 m tall, unveiled in 1913 and decapitated by vandals more than once.' },

    { id:'hagiasophia', name:'Hagia Sophia', city:'Istanbul', country:'Turkey', lat:41.0086, lng:28.9802, tier:2,
      wiki:'Hagia Sophia',
      clue:'A vast domed building in rose-coloured stone, ringed by four later minarets.',
      fact:'Cathedral for 900 years, mosque for 480, museum for 85 — and a mosque again since 2020.' },

    { id:'gatewayindia', name:'Gateway of India', city:'Mumbai', country:'India', lat:18.9220, lng:72.8347, tier:2,
      wiki:'Gateway of India',
      clue:'A basalt triumphal arch facing a harbour, next to a famous domed hotel.',
      fact:'The last British troops to leave India marched through it in 1948.' },

    { id:'machu', name:'Machu Picchu', city:'Cusco', country:'Peru', lat:-13.1631, lng:-72.5450, tier:2,
      wiki:'Machu Picchu',
      clue:'Terraced stone ruins on a saddle between steep green peaks, high in the mountains.',
      fact:'Built around 1450 at 2,430 m and abandoned barely a century later.' },

    { id:'tablemountain', name:'Table Mountain', city:'Cape Town', country:'South Africa', lat:-33.9628, lng:18.4098, tier:2,
      wiki:'Table Mountain',
      clue:'A flat-topped sandstone mountain rising straight behind a coastal city.',
      fact:'Its "tablecloth" of cloud forms when moist south-easterly wind is forced up the slope.' },

    { id:'hollywood', name:'Hollywood Sign', city:'Los Angeles', country:'USA', lat:34.1341, lng:-118.3215, tier:2,
      wiki:'Hollywood Sign',
      clue:'Giant white block letters set into a dry, scrubby hillside.',
      fact:'Erected in 1923 as "HOLLYWOODLAND", an advert for a housing development.' },

    { id:'willis', name:'Willis Tower', city:'Chicago', country:'USA', lat:41.8789, lng:-87.6359, tier:2,
      wiki:'Willis Tower',
      clue:'A black skyscraper of bundled square tubes of different heights, with twin antennas.',
      fact:'Its nine bundled tubes stop at different floors — a structural idea by engineer Fazlur Rahman Khan.' },

    { id:'rijks', name:'Rijksmuseum', city:'Amsterdam', country:'Netherlands', lat:52.3600, lng:4.8852, tier:2,
      wiki:'Rijksmuseum',
      clue:'A red-brick museum of Gothic and Renaissance revival style with a cycle passage through its middle.',
      fact:'A public bike route runs straight through the building — cyclists won that fight in the 1920s.' },

    { id:'alhambra', name:'Alhambra', city:'Granada', country:'Spain', lat:37.1761, lng:-3.5881, tier:2,
      wiki:'Alhambra',
      clue:'A red hilltop palace-fortress with courtyards, fountains and intricate carved plaster.',
      fact:'Its walls are covered in Arabic inscriptions, many repeating "there is no victor but God".' },

    { id:'cologne', name:'Cologne Cathedral', city:'Cologne', country:'Germany', lat:50.9413, lng:6.9583, tier:2,
      wiki:'Cologne Cathedral',
      clue:'A blackened twin-spired Gothic cathedral looming over a railway station.',
      fact:'Started in 1248, abandoned for 300 years, finished in 1880 to the original plans.' },

    { id:'grandpalace', name:'Grand Palace', city:'Bangkok', country:'Thailand', lat:13.7500, lng:100.4913, tier:2,
      wiki:'Grand Palace',
      clue:'Gilded spires and mirrored-glass mosaic roofs in a walled royal compound.',
      fact:'Home to the Emerald Buddha, whose robes are changed by the king three times a year.' },

    { id:'pearl', name:'Oriental Pearl Tower', city:'Shanghai', country:'China', lat:31.2397, lng:121.4998, tier:2,
      wiki:'Oriental Pearl Tower',
      clue:'A TV tower of pink spheres threaded on splayed concrete legs, on a river waterfront.',
      fact:'Its design comes from a Tang dynasty poem about pearls falling onto a jade plate.' },

    { id:'forbidden', name:'Forbidden City', city:'Beijing', country:'China', lat:39.9163, lng:116.3972, tier:2,
      wiki:'Forbidden City',
      clue:'A red-walled palace complex of yellow-tiled roofs, entered from a vast square.',
      fact:'Nearly 1,000 buildings — commoners could not enter for almost 500 years.' },

    { id:'gyeongbok', name:'Gyeongbokgung', city:'Seoul', country:'South Korea', lat:37.5796, lng:126.9770, tier:2,
      wiki:'Gyeongbokgung',
      clue:'A restored royal palace with painted eaves, framed by mountains and glass towers.',
      fact:'Built in 1395, burned in 1592, rebuilt in 1867 — and is still being restored today.' },

    { id:'obelisco', name:'Obelisco', city:'Buenos Aires', country:'Argentina', lat:-34.6037, lng:-58.3816, tier:2,
      wiki:'Obelisco de Buenos Aires',
      clue:'A white obelisk on a traffic island in the middle of an extremely wide avenue.',
      fact:'It sits on Avenida 9 de Julio, one of the widest avenues in the world.' },

    { id:'belem', name:'Belém Tower', city:'Lisbon', country:'Portugal', lat:38.6916, lng:-9.2160, tier:2,
      wiki:'Belém Tower',
      clue:'A small ornate limestone fort in Manueline style, standing at the edge of a river estuary.',
      fact:'Built in 1519 as a ceremonial gateway for ships leaving on voyages of discovery.' },

    { id:'whitehouse', name:'The White House', city:'Washington, D.C.', country:'USA', lat:38.8977, lng:-77.0365, tier:2,
      wiki:'White House',
      clue:'A white neoclassical mansion with a columned portico and a curved south front.',
      fact:'Burned by British troops in 1814; the scorch marks are still visible under later paint.' },

    { id:'niagara', name:'Niagara Falls', city:'Niagara Falls', country:'Canada', lat:43.0828, lng:-79.0742, tier:2,
      wiki:'Niagara Falls',
      clue:'A horseshoe-shaped waterfall on a wide river forming an international border.',
      fact:'About 2,800 tonnes of water go over Horseshoe Falls every second in summer.' },

    { id:'hallgrim', name:'Hallgrímskirkja', city:'Reykjavík', country:'Iceland', lat:64.1417, lng:-21.9266, tier:2,
      wiki:'Hallgrímskirkja',
      clue:'A pale concrete church whose stepped wings sweep up like columns of cooled lava.',
      fact:'Its shape echoes the basalt columns formed when Icelandic lava cools slowly.' },

    /* ---------------- tier 3 ---------------- */
    { id:'angkor', name:'Angkor Wat', city:'Siem Reap', country:'Cambodia', lat:13.4125, lng:103.8670, tier:3,
      wiki:'Angkor Wat',
      clue:'A moated sandstone temple of five lotus-bud towers, reflected in still water.',
      fact:'The largest religious monument on Earth, built in the early 12th century.' },

    { id:'petra', name:'Al-Khazneh, Petra', city:'Petra', country:'Jordan', lat:30.3222, lng:35.4515, tier:3,
      wiki:'Al-Khazneh',
      clue:'A classical facade carved directly into a rose-red sandstone cliff at the end of a gorge.',
      fact:'It is a tomb, not a treasury — the name came from a legend about a pharaoh’s gold in the urn.' },

    { id:'stonehenge', name:'Stonehenge', city:'Salisbury', country:'United Kingdom', lat:51.1789, lng:-1.8262, tier:3,
      wiki:'Stonehenge',
      clue:'A ring of huge upright stones capped with lintels, alone on an open grass plain.',
      fact:'The smaller bluestones were hauled about 250 km from the Preseli Hills in Wales.' },

    { id:'rushmore', name:'Mount Rushmore', city:'Keystone', country:'USA', lat:43.8791, lng:-103.4591, tier:3,
      wiki:'Mount Rushmore',
      clue:'Four presidential faces carved into a granite mountainside above a pine forest.',
      fact:'Each head is about 18 m tall; the carving used roughly 450,000 tonnes of dynamited rock.' },

    { id:'uluru', name:'Uluru', city:'Alice Springs', country:'Australia', lat:-25.3444, lng:131.0369, tier:3,
      wiki:'Uluru',
      clue:'A single vast sandstone monolith glowing red on a flat desert plain.',
      fact:'Most of it is underground — the visible rock is the tip of a slab kilometres deep.' },

    { id:'skytower', name:'Sky Tower', city:'Auckland', country:'New Zealand', lat:-36.8485, lng:174.7621, tier:3,
      wiki:'Sky Tower (Auckland)',
      clue:'A slender 328 m observation tower with a bulging pod, over a harbour city.',
      fact:'The tallest free-standing structure in the Southern Hemisphere.' },

    { id:'fishermans', name:'Fisherman’s Bastion', city:'Budapest', country:'Hungary', lat:47.5020, lng:19.0348, tier:3,
      wiki:"Fisherman's Bastion",
      clue:'A white fairy-tale terrace of seven pointed turrets, looking across a river at a parliament.',
      fact:'Its seven towers stand for the seven Magyar chieftains who founded the country.' },

    { id:'bran', name:'Bran Castle', city:'Brașov', country:'Romania', lat:45.5149, lng:25.3670, tier:3,
      wiki:'Bran Castle',
      clue:'A white hilltop castle with red roofs and narrow towers, in a wooded mountain pass.',
      fact:'Marketed as "Dracula’s castle", though Vlad the Impaler probably never lived there.' },

    { id:'santorini', name:'Oia', city:'Santorini', country:'Greece', lat:36.4618, lng:25.3762, tier:3,
      wiki:'Oia, Greece',
      clue:'Whitewashed houses and blue domes stacked down a cliff above a flooded volcanic caldera.',
      fact:'The caldera was formed by one of the largest volcanic eruptions in recorded history.' },

    { id:'duomo', name:'Milan Cathedral', city:'Milan', country:'Italy', lat:45.4642, lng:9.1900, tier:3,
      wiki:'Milan Cathedral',
      clue:'A white marble cathedral bristling with spires and thousands of statues.',
      fact:'It carries about 3,400 statues and took nearly 600 years to complete.' },

    { id:'himeji', name:'Himeji Castle', city:'Himeji', country:'Japan', lat:34.8394, lng:134.6939, tier:3,
      wiki:'Himeji Castle',
      clue:'A brilliant white castle keep with curving tiled roofs, on a stone base.',
      fact:'Nicknamed the "White Heron Castle"; it survived WWII bombing and major earthquakes intact.' },

    { id:'fushimi', name:'Fushimi Inari-taisha', city:'Kyoto', country:'Japan', lat:34.9671, lng:135.7727, tier:3,
      wiki:'Fushimi Inari-taisha',
      clue:'Thousands of vermilion gates forming tunnels up a wooded hillside.',
      fact:'Each of the roughly 10,000 torii was donated by a business, whose name is painted on the back.' },

    { id:'goldentemple', name:'Golden Temple', city:'Amritsar', country:'India', lat:31.6200, lng:74.8765, tier:3,
      wiki:'Golden Temple',
      clue:'A gold-plated shrine on a marble causeway in the middle of a sacred pool.',
      fact:'Its free kitchen serves free meals to around 100,000 people every single day.' },

    { id:'hassan2', name:'Hassan II Mosque', city:'Casablanca', country:'Morocco', lat:33.6083, lng:-7.6325, tier:3,
      wiki:'Hassan II Mosque',
      clue:'A mosque with a 210 m minaret standing on a platform over the Atlantic surf.',
      fact:'Part of its floor is glass, so worshippers can see the ocean beneath them.' },

    { id:'victoriafalls', name:'Victoria Falls', city:'Livingstone', country:'Zambia', lat:-17.9243, lng:25.8572, tier:3,
      wiki:'Victoria Falls',
      clue:'A curtain of water more than a kilometre wide, dropping into a narrow basalt gorge.',
      fact:'Its local name, Mosi-oa-Tunya, means "the smoke that thunders".' },

    { id:'rialto', name:'Rialto Bridge', city:'Venice', country:'Italy', lat:45.4380, lng:12.3358, tier:3,
      wiki:'Rialto Bridge',
      clue:'A single-span stone arch bridge lined with shops, crossing a busy canal.',
      fact:'Completed in 1591 on some 12,000 wooden piles driven into the mud.' },

    { id:'guggenheim', name:'Guggenheim Museum Bilbao', city:'Bilbao', country:'Spain', lat:43.2687, lng:-2.9340, tier:3,
      wiki:'Guggenheim Museum Bilbao',
      clue:'A riverside museum of curving, ship-like titanium sheets.',
      fact:'Its opening in 1997 revived the city so sharply that planners now talk of the "Bilbao effect".' },

    { id:'edinburgh', name:'Edinburgh Castle', city:'Edinburgh', country:'United Kingdom', lat:55.9486, lng:-3.1999, tier:3,
      wiki:'Edinburgh Castle',
      clue:'A fortress on a sheer volcanic crag above a city of dark stone tenements.',
      fact:'It sits on a castle rock plug of a volcano extinct for about 340 million years.' },

    { id:'schonbrunn', name:'Schönbrunn Palace', city:'Vienna', country:'Austria', lat:48.1845, lng:16.3122, tier:3,
      wiki:'Schönbrunn Palace',
      clue:'A long butter-yellow baroque palace behind formal gardens and a hilltop colonnade.',
      fact:'It has 1,441 rooms; a six-year-old Mozart performed for the empress here in 1762.' },

    { id:'chapelbridge', name:'Chapel Bridge', city:'Lucerne', country:'Switzerland', lat:47.0517, lng:8.3076, tier:3,
      wiki:'Kapellbrücke',
      clue:'A covered wooden footbridge with flower boxes, running diagonally beside a stone water tower.',
      fact:'Built around 1365, it is the oldest surviving covered wooden bridge in Europe.' },

    { id:'palaceculture', name:'Palace of Culture and Science', city:'Warsaw', country:'Poland', lat:52.2317, lng:21.0060, tier:3,
      wiki:'Palace of Culture and Science',
      clue:'A stepped Stalinist skyscraper with a spire, isolated in a wide open plaza.',
      fact:'A 1955 "gift" from the Soviet Union; locals joke the best view is from its terrace — the only place you can’t see it.' },

    { id:'dubrovnik', name:'Walls of Dubrovnik', city:'Dubrovnik', country:'Croatia', lat:42.6414, lng:18.1108, tier:3,
      wiki:'Walls of Dubrovnik',
      clue:'Complete medieval city walls wrapped around orange-roofed houses on the Adriatic.',
      fact:'Nearly 2 km of walls, never breached by an army in the republic’s long history.' },

    { id:'sofiakyiv', name:'Saint Sophia Cathedral', city:'Kyiv', country:'Ukraine', lat:50.4529, lng:30.5145, tier:3,
      wiki:'Saint Sophia Cathedral, Kyiv',
      clue:'A white cathedral with green-and-gold domes and a tall baroque bell tower.',
      fact:'Founded in the 11th century; its interior mosaics have survived almost a thousand years.' },

    { id:'capitolio', name:'El Capitolio', city:'Havana', country:'Cuba', lat:23.1367, lng:-82.3590, tier:2,
      wiki:'El Capitolio',
      clue:'A domed neoclassical capitol building, with 1950s American cars parked outside.',
      fact:'Completed in 1929 and often mistaken for a copy of the US Capitol, which it deliberately outgrew.' },

    { id:'panama', name:'Miraflores Locks', city:'Panama City', country:'Panama', lat:8.9959, lng:-79.5900, tier:3,
      wiki:'Miraflores',
      clue:'Enormous concrete canal locks lifting ships between two oceans.',
      fact:'Ships are raised about 16.5 m here in two steps, using only gravity-fed fresh water.' },

    { id:'matterhorn', name:'Matterhorn', city:'Zermatt', country:'Switzerland', lat:45.9763, lng:7.6586, tier:3,
      wiki:'Matterhorn',
      clue:'An isolated four-sided pyramid peak, the most photographed mountain in the Alps.',
      fact:'Its pyramid shape was carved by glaciers grinding away four faces at once.' }
  ];
})(window);
