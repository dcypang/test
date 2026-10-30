/* Timbre course content: modules, lessons, exercises and quizzes.
 *
 * Lesson shape:
 *   { id, title, minutes, cards: [{ title, body, tips? }], exercise }
 * Exercise types (rendered by js/exercises.js):
 *   breath   – animated breathing pacer        { pattern:[in,hold,out,hold], rounds }
 *   steps    – guided timed steps               { steps:[{ text, secs }] }
 *   sustain  – hold a sound as long as you can  { sound, goal }
 *   pitch    – live pitch tracker               { prompt, goal:'range'|'steady'|'variation'|'fall', target }
 *   record   – record and play back             { prompts:[], checklist:[] }
 *   pace     – read a passage, measure WPM      { text, target:[min,max] }
 *   voicecheck – full assessment read           { text? }
 *   volume   – level meter vs. your baseline    { levels:[{ label, db }] }
 *   tally    – timed talk with a filler counter { topics:[], secs }
 *   checklist– self-check list                  { items:[] }
 * Quiz question shape: { q, options:[], answer, explain }
 */
window.TIMBRE_CONTENT = (function () {
  const VOICE_CHECK_PASSAGE =
    'Every voice tells a story before the words arrive. When you speak, people hear your energy, ' +
    'your confidence, and your care. A clear voice does not need to be loud. It needs breath behind it, ' +
    'space around it, and a reason to be heard. Read this passage at your natural pace. Pause where the ' +
    'commas invite you. Let the important words rise, and let each sentence land firmly at the end. ' +
    'In a few weeks, read it again and listen to how far you have come.';

  const PACE_PASSAGE =
    'The lighthouse keeper climbed the spiral stairs one last time before the storm. ' +
    'Below him, the harbor emptied as fishing boats hurried home, their engines humming against the wind. ' +
    'He checked the lamp, wiped the glass, and wound the old brass clock that had kept perfect time for forty years. ' +
    'When the first wave struck the rocks, he did not flinch. He had seen a hundred storms like this one. ' +
    'He lit the lamp, watched the beam sweep across the dark water, and waited for the morning to come.';

  const modules = [
    /* ------------------------------------------------------------------ */
    {
      id: 'breath',
      title: 'Breath & Posture',
      blurb: 'Your breath is the engine of your voice. Build a steady, low, relaxed supply.',
      lessons: [
        {
          id: 'breath-1',
          title: 'Breathe from your belly',
          minutes: 4,
          cards: [
            {
              title: 'Breath powers every word',
              body: 'Your voice is air turned into sound. When you breathe high in your chest, the air supply is shallow and your throat tightens to compensate. When you breathe low, the diaphragm does the work and your voice sounds fuller and calmer.',
            },
            {
              title: 'How the diaphragm works',
              body: 'The diaphragm is a dome-shaped muscle under your lungs. When you inhale, it contracts and flattens, which pushes your belly and lower ribs outward. When you exhale, it relaxes and rises again. Speakers call this low, wide breath "diaphragmatic breathing".',
            },
            {
              title: 'Check yourself',
              body: 'Put one hand on your chest and one on your belly. Breathe in through your nose. The lower hand should move first and most. If your shoulders lift or your chest hand moves most, slow down and let the breath drop lower.',
              tips: ['Breathe in through the nose when you have time; it warms and filters the air.', 'Don\'t push your belly out. Let it release.'],
            },
          ],
          exercise: {
            type: 'breath',
            title: 'Low breathing pacer',
            intro: 'Follow the circle. Breathe in for 4, out for 6. Keep your shoulders still.',
            pattern: [4, 0, 6, 0],
            rounds: 6,
          },
        },
        {
          id: 'breath-2',
          title: 'Stand like a speaker',
          minutes: 3,
          cards: [
            {
              title: 'Posture shapes sound',
              body: 'Slumping squeezes your lungs and pushes your head forward, which tightens the muscles around your larynx. Good alignment opens the path for air and lets your voice resonate freely.',
            },
            {
              title: 'Build it from the ground up',
              body: 'Feet hip-width apart, weight balanced. Knees soft, never locked. Pelvis neutral. Ribs gently lifted. Shoulders down and back. Chin level, as if a string pulled the crown of your head toward the ceiling.',
              tips: ['Sitting? Plant both feet, sit toward the front of the chair, and keep the same tall spine.'],
            },
            {
              title: 'The wall check',
              body: 'Stand with your heels, hips, shoulder blades and the back of your head lightly touching a wall. That is roughly neutral alignment. Step away and try to keep it without stiffening.',
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Alignment routine',
            intro: 'Work through each step. The timer moves you on.',
            steps: [
              { text: 'Plant your feet hip-width apart and feel your weight spread evenly.', secs: 10 },
              { text: 'Unlock your knees. Let them soften slightly.', secs: 8 },
              { text: 'Roll your shoulders up, back and down. Let them rest there.', secs: 10 },
              { text: 'Lengthen the back of your neck. Imagine a string lifting the crown of your head.', secs: 10 },
              { text: 'Breathe low three times while holding this posture. Say "Hello, I\'m ready" on the last exhale.', secs: 20 },
            ],
          },
        },
        {
          id: 'breath-3',
          title: 'The long hiss',
          minutes: 4,
          cards: [
            {
              title: 'Control, not capacity',
              body: 'Running out of air mid-sentence is rarely about lung size. It\'s about how evenly you release the air. A steady, controlled exhale gives you longer phrases and a more even tone.',
            },
            {
              title: 'How to do the hiss',
              body: 'Take a low breath. Then release it on a quiet, even "sss", like a slow tire leak. Keep the sound the same volume from start to finish. Don\'t let the ribs collapse at the start; let them close slowly.',
              tips: ['Most people start around 15 seconds. 25 to 30 seconds is a strong target.', 'Stop before you strain. Never squeeze out the last bit of air.'],
            },
          ],
          exercise: {
            type: 'sustain',
            title: 'Sustained "sss"',
            intro: 'Breathe low, then hiss evenly. The timer runs while it hears you.',
            sound: 'sss',
            goal: 20,
          },
        },
        {
          id: 'breath-4',
          title: 'Let go of tension',
          minutes: 4,
          cards: [
            {
              title: 'Tension steals your tone',
              body: 'A tight jaw, a pulled-back tongue, or raised shoulders all squeeze the vocal tract. The result is a thin, pressed sound and a tired throat. Releasing tension before you speak is one of the fastest ways to sound better.',
            },
            {
              title: 'Where tension hides',
              body: 'Jaw: teeth clenched or the jaw jutting forward. Tongue: pulled back or pressed up. Neck: chin pushed forward. Shoulders: creeping toward your ears. Notice which one is yours.',
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Release routine',
            intro: 'Go slowly. Nothing here should hurt.',
            steps: [
              { text: 'Massage your jaw muscles in small circles just in front of your ears.', secs: 15 },
              { text: 'Let your jaw drop open loosely and wiggle it gently side to side.', secs: 10 },
              { text: 'Yawn widely, then sigh out on a relaxed "haaah" sliding from high to low.', secs: 12 },
              { text: 'Stick your tongue out and down toward your chin, then relax it back.', secs: 10 },
              { text: 'Slowly drop your ear toward each shoulder. Breathe into the stretch.', secs: 20 },
              { text: 'Shrug your shoulders up hard for two seconds, then drop them. Repeat three times.', secs: 12 },
            ],
          },
        },
      ],
      quiz: [
        { q: 'When you inhale with diaphragmatic breathing, what should move first and most?', options: ['Your shoulders', 'Your upper chest', 'Your belly and lower ribs', 'Your collarbones'], answer: 2, explain: 'The diaphragm flattens as you inhale, pushing the belly and lower ribs outward.' },
        { q: 'Running out of air mid-sentence is usually caused by…', options: ['Small lungs', 'Releasing air unevenly', 'Breathing through the nose', 'Standing up straight'], answer: 1, explain: 'Breath control matters more than capacity. An even release gives longer phrases.' },
        { q: 'What should your knees be doing when you stand to speak?', options: ['Locked straight', 'Deeply bent', 'Soft and slightly unlocked', 'It doesn\'t matter'], answer: 2, explain: 'Locked knees create tension that travels up the body. Keep them soft.' },
        { q: 'During the long hiss exercise, the sound should…', options: ['Start loud and fade', 'Stay even from start to finish', 'Get louder at the end', 'Pulse on and off'], answer: 1, explain: 'An even hiss trains a steady, controlled release of air.' },
        { q: 'Which is a common sign of jaw tension?', options: ['Teeth clenched or jaw jutting forward', 'A relaxed open mouth', 'Breathing through the nose', 'Smiling while talking'], answer: 0, explain: 'Clenched teeth and a forward jaw squeeze the vocal tract and thin the tone.' },
        { q: 'A good speaking posture includes…', options: ['Chin lifted high', 'Shoulders pulled toward the ears', 'Chin level and the back of the neck long', 'Weight on your heels'], answer: 2, explain: 'A level chin and long neck keep the larynx free.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'warmup',
      title: 'Warm-ups & Vocal Care',
      blurb: 'Warm up like an athlete and protect your voice for the long run.',
      lessons: [
        {
          id: 'warmup-1',
          title: 'Lip trills and hums',
          minutes: 4,
          cards: [
            {
              title: 'Why warm up?',
              body: 'Your vocal folds are muscle and tissue. A few minutes of gentle sound increases blood flow, loosens tension, and makes speaking feel easier. Warming up before a call, a presentation, or a long day of talking pays off immediately.',
            },
            {
              title: 'Semi-occluded sounds',
              body: 'Lip trills ("brrr"), humming and straw phonation all partly close the mouth. That creates gentle back-pressure that helps the vocal folds vibrate efficiently with less effort. Coaches call these semi-occluded vocal tract (SOVT) exercises.',
              tips: ['Can\'t do a lip trill? Press lightly on your cheeks with your fingertips, or use a tongue trill or a hum instead.'],
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Three-minute warm-up',
            intro: 'Keep everything easy and comfortable. Quiet is fine.',
            steps: [
              { text: 'Hum "mmm" on a comfortable note. Feel the buzz on your lips.', secs: 20 },
              { text: 'Lip trill "brrr" on one steady note.', secs: 20 },
              { text: 'Lip trill while sliding gently up and back down, like a siren.', secs: 25 },
              { text: 'Hum "mmm" and open into "mah": mmm-mah, mmm-mah, mmm-mah.', secs: 25 },
              { text: 'Chew while humming, as if eating something sticky. Keep the jaw loose.', secs: 20 },
              { text: 'Speak the days of the week with the same easy buzz you just found.', secs: 20 },
            ],
          },
        },
        {
          id: 'warmup-2',
          title: 'Sirens: wake up your range',
          minutes: 4,
          cards: [
            {
              title: 'Glide through your voice',
              body: 'A siren is a smooth slide from low to high and back. It stretches the vocal folds gently and helps you move between the lower and upper parts of your voice without bumps or breaks.',
            },
            {
              title: 'How to siren',
              body: 'Use "ng" (as at the end of "sing") or "oo". Start low, slide up as high as is comfortable, then back down. Keep it soft. A crack in the middle is normal; keep sliding through it.',
              tips: ['Never push to reach a high note. Range grows from ease, not force.'],
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Siren on "ng"',
            intro: 'Slide from your lowest comfortable note to your highest and back. Try to cover at least one octave (12 semitones).',
            prompt: 'ng… (low → high → low)',
            goal: 'range',
            target: 12,
          },
        },
        {
          id: 'warmup-3',
          title: 'Straw phonation',
          minutes: 3,
          cards: [
            {
              title: 'The voice coach\'s secret tool',
              body: 'Humming through a drinking straw is one of the most effective semi-occluded exercises. The narrow straw creates back-pressure that balances the air pressure above and below the vocal folds, so they vibrate with very little effort.',
            },
            {
              title: 'How to do it',
              body: 'Hold a straw between your lips (not your teeth) and make an "ooo" sound through it. Slide up and down your range, or hum a simple tune. For extra resistance, put the other end in a glass with a few centimetres of water and keep the bubbles steady.',
              tips: ['Seal your lips around the straw so no air escapes from your nose or mouth corners.', 'A great reset after a long day of talking.'],
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Straw routine',
            intro: 'Grab a straw. No straw? Use a gentle lip trill instead.',
            steps: [
              { text: 'Steady "ooo" through the straw on a comfortable note.', secs: 20 },
              { text: 'Slow slides up and down through the straw.', secs: 30 },
              { text: 'Hum "Happy Birthday" (or any simple tune) through the straw.', secs: 30 },
              { text: 'Remove the straw and say "one, two, three, four, five". Notice how easy it feels.', secs: 15 },
            ],
          },
        },
        {
          id: 'warmup-4',
          title: 'Everyday vocal care',
          minutes: 4,
          cards: [
            {
              title: 'Hydrate inside and out',
              body: 'Vocal folds need a thin layer of mucus to vibrate smoothly. Drink water steadily through the day, since what you drink now helps a few hours from now. Breathing steam gives direct surface hydration. Caffeine and alcohol can dry you out, so balance them with extra water.',
            },
            {
              title: 'Habits that hurt',
              body: 'Throat clearing slams the vocal folds together. Swallow or sip water instead. Shouting over noise and talking for hours without breaks wear the voice down. Forceful whispering can strain more than soft speech. If you need to rest your voice, rest it fully.',
            },
            {
              title: 'Know when to get help',
              body: 'Hoarseness that lasts more than two weeks, pain when speaking, or a sudden change in your voice is a reason to see a doctor (an ENT or laryngologist) or a speech-language pathologist. This app is training, not medical care.',
            },
          ],
          exercise: {
            type: 'checklist',
            title: 'My vocal care plan',
            intro: 'Tick the habits you\'ll commit to this week.',
            items: [
              'Keep a water bottle with me while I work',
              'Swallow or sip instead of clearing my throat',
              'Warm up for 3 minutes before important calls',
              'Take a 5-minute voice break every hour of heavy talking',
              'Avoid shouting over loud noise',
              'Breathe steam (shower or bowl of hot water) when my voice feels dry',
            ],
          },
        },
      ],
      quiz: [
        { q: 'Lip trills, humming and straw phonation are examples of…', options: ['Projection drills', 'Semi-occluded vocal tract exercises', 'Articulation drills', 'Pitch tests'], answer: 1, explain: 'They partly close the vocal tract, creating helpful back-pressure.' },
        { q: 'What is the best alternative to clearing your throat?', options: ['Cough harder', 'Swallow or sip water', 'Whisper', 'Hum loudly'], answer: 1, explain: 'Throat clearing slams the folds together. Swallowing is gentler.' },
        { q: 'If your voice cracks during a siren, you should…', options: ['Stop immediately', 'Push harder through it', 'Keep sliding gently through it', 'Only practise low notes'], answer: 2, explain: 'Breaks are normal. Gentle, repeated slides smooth them over time.' },
        { q: 'Hoarseness lasting longer than this is a reason to see a professional:', options: ['Two hours', 'Two days', 'Two weeks', 'Two months'], answer: 2, explain: 'Persistent hoarseness beyond about two weeks should be checked by a doctor or SLP.' },
        { q: 'When doing straw phonation, hold the straw…', options: ['Between your teeth', 'Between your lips with a seal', 'Loosely, letting air escape', 'In your nose'], answer: 1, explain: 'Sealing the lips keeps all the air going through the straw.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'resonance',
      title: 'Resonance & Tone',
      blurb: 'Turn a thin sound into a rich, warm, forward voice.',
      lessons: [
        {
          id: 'resonance-1',
          title: 'What resonance is',
          minutes: 3,
          cards: [
            {
              title: 'Source and filter',
              body: 'Your vocal folds create a small buzzing sound. The spaces above them (your throat, mouth and nasal passages) shape and amplify it, the way a guitar body amplifies a string. That shaping is resonance, and it is what makes a voice sound warm, bright, thin or full.',
            },
            {
              title: 'Where you feel it',
              body: 'Low notes tend to buzz in the chest. Higher notes buzz around the face. Coaches call the area around the nose, cheeks and lips the "mask". A voice with good mask resonance carries well without effort.',
            },
            {
              title: 'You can change it',
              body: 'Small changes in jaw opening, tongue position and soft palate height make a big difference. Unlike pitch, resonance is almost entirely a skill, so it responds quickly to practice.',
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Feel the vibrations',
            intro: 'Rest a hand where the step tells you and notice where the buzz is strongest.',
            steps: [
              { text: 'Hand on your chest. Say "mmm" on a low, relaxed note. Feel the chest buzz.', secs: 15 },
              { text: 'Fingertips on the bridge of your nose. Hum higher, "mmm". Feel the face buzz.', secs: 15 },
              { text: 'Fingertips on your lips. Hum "mmm" until your lips tickle.', secs: 15 },
              { text: 'Say "my name is…" and keep the lip tickle while you speak.', secs: 15 },
            ],
          },
        },
        {
          id: 'resonance-2',
          title: 'Find your mask with "mm-hmm"',
          minutes: 4,
          cards: [
            {
              title: 'The "mm-hmm" trick',
              body: 'Say "mm-hmm" the way you would if a friend said something you agree with. That relaxed, spontaneous sound usually sits right in your natural speaking pitch and carries a strong buzz in the mask.',
            },
            {
              title: 'Bridge it into speech',
              body: 'Say "mm-hmm", then go straight into a word: "mm-hmm… one", "mm-hmm… my", "mm-hmm… morning". Keep the same buzz and the same pitch. That is the voice you are aiming for.',
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Steady hum',
            intro: 'Say "mm-hmm", then hold a steady "mmm" for 5 seconds. Aim for a flat, steady line.',
            prompt: 'mm-hmm… mmmmm',
            goal: 'steady',
            target: 1,
          },
        },
        {
          id: 'resonance-3',
          title: 'Move your voice forward',
          minutes: 4,
          cards: [
            {
              title: 'Forward placement',
              body: 'When speech feels "stuck in the throat", it often sounds muffled. Thinking of the sound landing on your lips and teeth brightens it and makes it easier to understand.',
            },
            {
              title: 'Use nasal consonants as a ladder',
              body: 'M, N and NG naturally buzz in the mask. Start a phrase on one of them and let the vowels that follow ride on the same buzz.',
              tips: ['Imagine your voice travelling out of your mouth and landing on a wall across the room.'],
            },
          ],
          exercise: {
            type: 'record',
            title: 'Forward phrases',
            intro: 'Record each line. Play it back and listen for a buzzing, forward tone.',
            prompts: [
              'Mmm-me, mmm-may, mmm-ma, mmm-mo, mmm-moo',
              'Many men made more money on Monday.',
              'Nine nice neighbours knew nothing new.',
              'My mind is made up, and I mean it.',
            ],
            checklist: ['I could feel buzz around my lips and nose', 'The sound felt easy, not pushed', 'It sounded clearer than my usual voice'],
          },
        },
        {
          id: 'resonance-4',
          title: 'Fix nasal or breathy tone',
          minutes: 5,
          cards: [
            {
              title: 'Too nasal?',
              body: 'Pinch your nose and say "Look at the big blue sky." There are no nasal sounds in that sentence, so it should sound the same pinched or not. If it changes a lot, air is leaking through your nose. Practise yawning slightly as you speak to lift the soft palate.',
            },
            {
              title: 'Too breathy?',
              body: 'A breathy voice lets extra air escape between the vocal folds. It sounds soft and tired and doesn\'t carry. Try a gentle "uh-oh": the small catch before "oh" brings the vocal folds together. Then say vowel-starting words with that same clean start: "apple", "only", "every".',
            },
            {
              title: 'The balanced onset',
              body: 'There are three ways to start a sound: breathy (air first), hard (a click or "glottal attack"), and balanced (air and sound start together). Aim for balanced. Say "hhh-ah" (breathy), "!ah" (hard), then find the clean middle.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Clean onsets',
            intro: 'Record each line. Listen for a clear start with no puff of air and no harsh click.',
            prompts: [
              'Look at the big blue sky. (Try it with your nose pinched too.)',
              'Uh-oh. Uh-oh. Oh. Oh. Oh.',
              'Apples are always available in August.',
              'Every evening, Ellen eats early.',
            ],
            checklist: ['The pinched and unpinched versions sounded similar', 'Vowel starts were clean, not breathy', 'No harsh clicks at the start of words'],
          },
        },
      ],
      quiz: [
        { q: 'In the source-filter model, what creates the original sound?', options: ['The tongue', 'The vocal folds', 'The nasal cavity', 'The diaphragm'], answer: 1, explain: 'The vocal folds are the source. The throat, mouth and nose are the filter.' },
        { q: 'The "mask" refers to…', options: ['The area around the nose, cheeks and lips', 'The chest', 'The back of the throat', 'The stomach'], answer: 0, explain: 'Mask resonance is buzz felt around the front of the face.' },
        { q: 'You pinch your nose and say "Look at the big blue sky". It sounds very different. That suggests…', options: ['Too little nasal resonance', 'Air leaking through the nose', 'Perfect resonance', 'Low pitch'], answer: 1, explain: 'The sentence has no nasal sounds, so a big change means air is escaping through the nose.' },
        { q: 'Which onset should you aim for in everyday speech?', options: ['Breathy', 'Hard glottal', 'Balanced', 'Whispered'], answer: 2, explain: 'A balanced onset starts air and sound together, efficiently and gently.' },
        { q: 'Which sounds naturally buzz in the mask?', options: ['S and F', 'M, N and NG', 'P and B', 'K and G'], answer: 1, explain: 'Nasal consonants send vibration through the face, which makes them great for practice.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'pitch',
      title: 'Pitch',
      blurb: 'Find the pitch where your voice sounds best and moves freely.',
      lessons: [
        {
          id: 'pitch-1',
          title: 'Your optimal pitch',
          minutes: 5,
          cards: [
            {
              title: 'Lower isn\'t always better',
              body: 'Many people push their voice down to sound authoritative. Speaking below your natural range causes strain, vocal fry and a muffled tone. Your optimal pitch is where your voice resonates best with the least effort.',
            },
            {
              title: 'Typical ranges',
              body: 'Average speaking pitch for lower adult voices is roughly 85 to 155 Hz, and for higher adult voices roughly 165 to 255 Hz. Yours can sit anywhere within or outside those ranges and still be healthy. These are averages, not targets.',
            },
            {
              title: 'Find yours',
              body: 'Say a relaxed "mm-hmm", then count "one, two, three, four, five" at the same pitch. The note your voice settles on is a good estimate of your natural speaking pitch.',
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Measure your speaking pitch',
            intro: 'Say "mm-hmm", then count from one to ten in your normal voice. The tracker reports your median pitch.',
            prompt: 'mm-hmm… one, two, three, four, five, six, seven, eight, nine, ten',
            goal: 'median',
            target: 0,
          },
        },
        {
          id: 'pitch-2',
          title: 'Stretch your range',
          minutes: 4,
          cards: [
            {
              title: 'Range gives you colour',
              body: 'You don\'t speak on one note, and you shouldn\'t. A flexible range lets you sound curious, warm, firm or excited. Training range in exercises makes it available when you speak.',
            },
            {
              title: 'Five-note slides',
              body: 'On "ah", slide up five notes and back down, like "do-re-mi-fa-so-fa-mi-re-do". Start each slide a little higher than the last, then work back down. Stay easy and quiet.',
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Range builder',
            intro: 'Slide up and down on "ah" or "oo". Try to cover 10 semitones or more.',
            prompt: 'ah… (slide up five notes, and back)',
            goal: 'range',
            target: 10,
          },
        },
        {
          id: 'pitch-3',
          title: 'Vocal fry and uptalk',
          minutes: 5,
          cards: [
            {
              title: 'Vocal fry',
              body: 'Vocal fry is the creaky, rattling sound at the bottom of your voice. It often shows up at the end of sentences when you run out of breath or drop below your natural pitch. Used constantly, it reduces clarity and can tire the voice.',
              tips: ['Fix: take a breath before you run out, and finish sentences on your natural pitch instead of sinking below it.'],
            },
            {
              title: 'Uptalk',
              body: 'Uptalk is a rising pitch at the end of statements, so they sound like questions. It can make you sound unsure even when you aren\'t.',
              tips: ['Fix: let your pitch fall on the last stressed word of a statement. Think of "landing" the sentence.'],
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Land the sentence',
            intro: 'Say each statement and let the pitch fall at the end. The tracker checks whether the last part is lower than the start.',
            prompt: 'I finished the report today. The meeting starts at nine. This is my decision.',
            goal: 'fall',
            target: 0,
          },
        },
      ],
      quiz: [
        { q: 'Speaking below your natural range often leads to…', options: ['More resonance', 'Strain and vocal fry', 'Better projection', 'Faster speech'], answer: 1, explain: 'Pushing the pitch down tends to cause strain and a creaky, muffled sound.' },
        { q: 'A good way to estimate your natural speaking pitch is to…', options: ['Sing your highest note', 'Say a relaxed "mm-hmm" and count at that pitch', 'Whisper', 'Speak as low as possible'], answer: 1, explain: 'The spontaneous "mm-hmm" tends to land near your natural pitch.' },
        { q: 'Uptalk means…', options: ['Speaking too loudly', 'A rising pitch at the end of statements', 'Speaking too fast', 'A creaky voice'], answer: 1, explain: 'Rising at the end makes statements sound like questions.' },
        { q: 'Vocal fry often appears…', options: ['At the start of sentences', 'At the end of sentences when breath runs low', 'Only when singing', 'When shouting'], answer: 1, explain: 'Low breath and sinking pitch at phrase ends invite fry.' },
        { q: 'How many semitones are in an octave?', options: ['5', '8', '10', '12'], answer: 3, explain: 'An octave is 12 semitones, a doubling of frequency.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'melody',
      title: 'Intonation & Expression',
      blurb: 'Use the melody of speech to hold attention and make meaning clear.',
      lessons: [
        {
          id: 'melody-1',
          title: 'Escape the monotone',
          minutes: 4,
          cards: [
            {
              title: 'Speech has a melody',
              body: 'Listeners use pitch movement to tell what is important, what is new, and how you feel. A flat voice makes even exciting content sound dull, and listeners tune out.',
            },
            {
              title: 'Measure it in semitones',
              body: 'Timbre measures your pitch variation as the spread of your pitch in semitones. As a rough guide, below about 1.8 sounds flat, about 1.8 to 3.5 sounds natural and conversational, and above 3.5 sounds lively and animated.',
            },
            {
              title: 'Exaggerate first',
              body: 'To unlock variation, overdo it in practice. Read like you\'re telling a story to a five-year-old. In real conversations you\'ll naturally pull it back, but you\'ll keep more melody than before.',
            },
          ],
          exercise: {
            type: 'pitch',
            title: 'Storyteller read',
            intro: 'Read this as if telling a child a bedtime story. Aim for a pitch variation above 2.5 semitones.',
            prompt: 'Once upon a time, a tiny dragon found a giant golden egg. "Is it mine?" she whispered. Then, crack! Something wonderful happened.',
            goal: 'variation',
            target: 2.5,
          },
        },
        {
          id: 'melody-2',
          title: 'Stress the words that matter',
          minutes: 5,
          cards: [
            {
              title: 'Operative words',
              body: 'In every sentence, one or two words carry the meaning. Actors call them operative words. Stressing them, with a little more pitch, length or volume, tells the listener where to focus.',
            },
            {
              title: 'One sentence, seven meanings',
              body: '"I didn\'t say she stole the money." Stress a different word each time and the meaning changes completely. I didn\'t say it (someone else did). I didn\'t SAY it (I implied it). I didn\'t say SHE stole it (someone else did). And so on.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Seven meanings',
            intro: 'Record the sentence seven times, stressing the capitalised word each time. Listen back. Can you hear each meaning?',
            prompts: [
              'I didn\'t say she stole the money.',
              'I DIDN\'T say she stole the money.',
              'I didn\'t SAY she stole the money.',
              'I didn\'t say SHE stole the money.',
              'I didn\'t say she STOLE the money.',
              'I didn\'t say she stole THE money.',
              'I didn\'t say she stole the MONEY.',
            ],
            checklist: ['Each version sounded different', 'I used pitch, not just volume, for stress', 'The stress felt natural, not shouted'],
          },
        },
        {
          id: 'melody-3',
          title: 'Statements, questions, authority',
          minutes: 4,
          cards: [
            {
              title: 'Up asks, down tells',
              body: 'A rising pitch invites a response: it signals a question or that you\'re not finished. A falling pitch closes the thought: it signals certainty. Use the fall for facts, decisions and requests you mean.',
            },
            {
              title: 'Lists and suspense',
              body: 'In a list, keep each item slightly up and drop on the last one: "We need bread ↗, milk ↗, and eggs ↘." Holding pitch up before a pause creates suspense; dropping it creates closure.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Up and down',
            intro: 'Record each pair. Make the first rise and the second fall.',
            prompts: [
              'You\'re coming tomorrow? ↗ / You\'re coming tomorrow. ↘',
              'The deadline is Friday? ↗ / The deadline is Friday. ↘',
              'We need bread ↗, milk ↗, and eggs ↘.',
              'And the winner is… ↗ (pause) …you. ↘',
            ],
            checklist: ['Questions clearly rose', 'Statements clearly fell', 'The final list item dropped'],
          },
        },
        {
          id: 'melody-4',
          title: 'Emotion in your voice',
          minutes: 4,
          cards: [
            {
              title: 'The voice carries feeling',
              body: 'Happiness tends to raise pitch and widen its range. Sadness lowers and narrows it. Anger adds force and sharp onsets. Calm uses an even pace and gentle falls. You can choose these colours deliberately.',
            },
            {
              title: 'Feel it, then say it',
              body: 'The most natural way to colour your voice is to picture the situation first. Imagine the moment, let your face react, then speak. A genuine smile changes the shape of your mouth, and listeners can hear it even on the phone.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'One word, five feelings',
            intro: 'Say "Really?" or "Oh, really." in each emotion. Picture a situation before each take.',
            prompts: ['Excited: you just won a trip', 'Doubtful: you don\'t believe the story', 'Bored: you\'ve heard this ten times', 'Warm: a friend shares good news', 'Annoyed: someone took your parking spot'],
            checklist: ['A listener could guess each emotion', 'Pitch and pace changed, not just volume', 'My face changed with each emotion'],
          },
        },
      ],
      quiz: [
        { q: 'Operative words are…', options: ['Filler words', 'The words that carry the key meaning', 'Words at the start of a sentence', 'Technical terms'], answer: 1, explain: 'Stressing operative words directs the listener\'s attention.' },
        { q: 'A falling pitch at the end of a sentence signals…', options: ['A question', 'Uncertainty', 'Certainty and closure', 'That you\'re not finished'], answer: 2, explain: 'Falling intonation closes the thought and sounds confident.' },
        { q: 'In a list, the pitch usually…', options: ['Falls on every item', 'Rises on each item and falls on the last', 'Stays completely flat', 'Rises on the last item'], answer: 1, explain: 'Rising items say "more coming"; the final fall says "done".' },
        { q: 'To unlock pitch variation in practice, you should…', options: ['Read in a whisper', 'Exaggerate, like telling a child a story', 'Speak on one note', 'Speed up'], answer: 1, explain: 'Exaggeration in practice leaves you with more natural melody in real speech.' },
        { q: 'Which change usually comes with happiness in the voice?', options: ['Lower, narrower pitch', 'Higher pitch with a wider range', 'Slower and flatter', 'Creaky voice'], answer: 1, explain: 'Happiness tends to lift pitch and widen its movement.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'diction',
      title: 'Articulation & Diction',
      blurb: 'Be understood the first time, every time.',
      lessons: [
        {
          id: 'diction-1',
          title: 'Meet your articulators',
          minutes: 3,
          cards: [
            {
              title: 'The tools of clarity',
              body: 'Your lips, tongue, teeth, the ridge behind your top teeth (the alveolar ridge), the hard and soft palate, and your jaw shape raw sound into words. Mumbling usually means these move too little.',
            },
            {
              title: 'Consonants give shape',
              body: 'Vowels carry the sound; consonants carry the meaning. Plosives (P, B, T, D, K, G) release a small burst of air. Fricatives (F, V, S, Z, SH, TH) create friction. Crisp consonants make you easy to understand, even in noisy rooms.',
            },
          ],
          exercise: {
            type: 'steps',
            title: 'Articulator workout',
            intro: 'Exaggerate every movement. It should feel a bit silly.',
            steps: [
              { text: 'Lips: alternate a big smile "eee" and a tight pucker "ooo".', secs: 15 },
              { text: 'Lips: "puh-buh-puh-buh-puh-buh", crisp and fast.', secs: 12 },
              { text: 'Tongue tip: "tuh-duh-tuh-duh-luh-nuh", tapping behind the top teeth.', secs: 12 },
              { text: 'Back of tongue: "kuh-guh-kuh-guh-kuh-guh".', secs: 12 },
              { text: 'Combine: "puh-tuh-kuh, puh-tuh-kuh", getting faster.', secs: 20 },
              { text: 'Jaw: say "wah-wah-wah", opening wide each time.', secs: 12 },
            ],
          },
        },
        {
          id: 'diction-2',
          title: 'Tongue twisters',
          minutes: 5,
          cards: [
            {
              title: 'Slow is the secret',
              body: 'Tongue twisters train precision, not speed. Say each one slowly and perfectly three times, then a little faster. If you stumble, slow down again. Clarity first; speed follows.',
            },
            {
              title: 'Target your weak sounds',
              body: 'Each twister works a different movement. Notice which ones trip you up. Those are the sounds to practise most.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Twister set',
            intro: 'Record each twister: slowly, then faster. Play back and listen for any blurred sounds.',
            prompts: [
              'Red leather, yellow leather.',
              'Unique New York, you know you need unique New York.',
              'She sells seashells by the seashore.',
              'Peter Piper picked a peck of pickled peppers.',
              'Six slippery snails slid slowly seaward.',
              'Truly rural, truly rural, truly rural.',
            ],
            checklist: ['Slow versions were perfectly clear', 'I kept clarity as I sped up', 'I found the sounds that trip me up'],
          },
        },
        {
          id: 'diction-3',
          title: 'The cork drill',
          minutes: 4,
          cards: [
            {
              title: 'An old actor\'s trick',
              body: 'Speaking with an obstacle between your front teeth forces your tongue and lips to work harder. When you remove it, your normal speech feels and sounds noticeably crisper.',
            },
            {
              title: 'How to do it safely',
              body: 'Hold a clean wine cork, or the tip of your knuckle, lightly between your front teeth. Read a few sentences as clearly as you can. Then remove it and read again. Keep the jaw relaxed; don\'t bite down hard. Never use anything you could choke on.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Before and after',
            intro: 'Record line 1 with the cork or knuckle in place, then line 2 without it. Compare.',
            prompts: [
              'WITH cork: The quick brown fox jumps over the lazy dog, and then naps in the afternoon sun.',
              'WITHOUT cork: The quick brown fox jumps over the lazy dog, and then naps in the afternoon sun.',
            ],
            checklist: ['The second take sounded crisper', 'My lips and tongue felt more active', 'My jaw stayed relaxed'],
          },
        },
        {
          id: 'diction-4',
          title: 'Crisp endings',
          minutes: 4,
          cards: [
            {
              title: 'Don\'t drop the last sound',
              body: 'Many unclear speakers swallow the ends of words: "wan" for "want", "fine" for "find", "ask" for "asked". Final consonants carry meaning, such as tense and plurals. Finishing them is the fastest win in clarity.',
            },
            {
              title: 'Linking without losing',
              body: 'When a word ends in a consonant and the next starts with a vowel, link them: "an apple" → "a-napple". This keeps speech smooth while every sound stays present.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Finish every word',
            intro: 'Record these and exaggerate the final consonants. Then try a natural version.',
            prompts: [
              'I asked, I picked, I walked, I worked.',
              'Hand, find, mind, kind, behind.',
              'The best test is the last test.',
              'She wanted to find what they\'d lost.',
            ],
            checklist: ['Every final T, D and K was audible', 'Past-tense endings were clear', 'It still sounded natural'],
          },
        },
      ],
      quiz: [
        { q: 'Which of these are plosive consonants?', options: ['F, V, S', 'P, T, K', 'M, N, NG', 'L, R, W'], answer: 1, explain: 'Plosives release a small burst of air: P, B, T, D, K, G.' },
        { q: 'When practising tongue twisters, start…', options: ['As fast as possible', 'Slowly and precisely', 'Whispering', 'With a cork only'], answer: 1, explain: 'Precision comes first. Speed builds on accuracy.' },
        { q: 'The cork drill works because…', options: ['It lowers your pitch', 'It forces lips and tongue to work harder', 'It improves breathing', 'It makes you louder'], answer: 1, explain: 'The obstacle makes your articulators overwork, so normal speech feels crisper.' },
        { q: 'Saying "wan" instead of "want" is an example of…', options: ['Uptalk', 'Dropping final consonants', 'Vocal fry', 'Over-articulation'], answer: 1, explain: 'Swallowing word endings is one of the most common clarity problems.' },
        { q: 'The alveolar ridge is…', options: ['The ridge just behind your top front teeth', 'The tip of the tongue', 'Part of the vocal folds', 'The soft palate'], answer: 0, explain: 'Your tongue tip taps the alveolar ridge for T, D, N and L.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'pace',
      title: 'Pace & Pauses',
      blurb: 'Control your speed and use silence as a tool.',
      lessons: [
        {
          id: 'pace-1',
          title: 'Find your speaking rate',
          minutes: 5,
          cards: [
            {
              title: 'Words per minute',
              body: 'Everyday conversation in English often runs around 150 words per minute. For presentations, about 130 to 160 is easy to follow. Faster than about 180 and listeners start to miss things; slower than about 110 and it can sound hesitant.',
            },
            {
              title: 'Nerves speed you up',
              body: 'Most people speak faster under pressure without noticing. Knowing your baseline lets you notice when you drift, and slow down on purpose.',
            },
          ],
          exercise: {
            type: 'pace',
            title: 'Pace check',
            intro: 'Tap Start, read the passage aloud at your natural pace, and tap Stop when you finish.',
            text: PACE_PASSAGE,
            target: [130, 160],
          },
        },
        {
          id: 'pace-2',
          title: 'The power of the pause',
          minutes: 5,
          cards: [
            {
              title: 'Silence is not a mistake',
              body: 'A well-placed pause gives listeners time to absorb a point, signals that something matters, and makes you look calm and in control. Silence that feels long to you usually feels natural to the audience.',
            },
            {
              title: 'Three kinds of pause',
              body: 'Short pause (/): about half a second, at commas and between ideas. Full pause (//): about one second, at the end of a point. Dramatic pause (///): two seconds or more, before or after something important.',
              tips: ['Breathe during your pauses. They\'re free refills.'],
            },
          ],
          exercise: {
            type: 'pace',
            title: 'Marked script',
            intro: 'Read the script, pausing at each mark: / short, // full, /// dramatic. The tool counts your pauses.',
            text: 'Last year / our team faced a choice. // We could play it safe / or we could try something new. /// We chose new. // It was hard, / it was messy, / and it was the best decision we ever made. /// Today / I want to show you why.',
            target: [100, 140],
          },
        },
        {
          id: 'pace-3',
          title: 'Drop the fillers',
          minutes: 5,
          cards: [
            {
              title: 'Um, uh, like, you know',
              body: 'Filler words fill silence while your brain catches up. A few are normal. Many make you sound unprepared and dilute your message.',
            },
            {
              title: 'Replace them with a pause',
              body: 'The fix is not to think faster but to get comfortable with silence. When you feel a filler coming, close your mouth and pause instead. Awareness alone cuts fillers dramatically, so the first step is counting them.',
            },
          ],
          exercise: {
            type: 'tally',
            title: 'Filler counter',
            intro: 'Pick a topic and talk for 60 seconds. Tap the counter each time you hear yourself use a filler. Recording is optional for listening back.',
            topics: ['Describe your morning routine', 'Your favourite place and why', 'Explain your job to a 10-year-old', 'The best meal you\'ve ever had', 'A skill you\'d love to learn'],
            secs: 60,
          },
        },
      ],
      quiz: [
        { q: 'A comfortable presentation pace is roughly…', options: ['60–90 wpm', '130–160 wpm', '200–230 wpm', '250+ wpm'], answer: 1, explain: 'Around 130 to 160 words per minute is easy for most listeners to follow.' },
        { q: 'What usually happens to pace when you\'re nervous?', options: ['It slows down', 'It speeds up', 'It stays the same', 'It becomes monotone'], answer: 1, explain: 'Adrenaline speeds most people up without them noticing.' },
        { q: 'The best replacement for a filler word is…', options: ['A different filler', 'A short pause', 'Speaking faster', 'A cough'], answer: 1, explain: 'A pause does what a filler does, buying time, but sounds confident.' },
        { q: 'A dramatic pause lasts about…', options: ['0.1 seconds', '0.5 seconds', '2 seconds or more', '10 seconds'], answer: 2, explain: 'Two seconds or more of silence before or after a key line adds weight.' },
        { q: 'Why breathe during pauses?', options: ['To look relaxed only', 'They\'re a natural moment to refill your air', 'To make the pause longer', 'You shouldn\'t'], answer: 1, explain: 'Pauses let you refill without breaking the flow of your speech.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'projection',
      title: 'Volume & Projection',
      blurb: 'Be heard at the back of the room without shouting.',
      lessons: [
        {
          id: 'projection-1',
          title: 'Projection isn\'t shouting',
          minutes: 4,
          cards: [
            {
              title: 'Shouting vs projecting',
              body: 'Shouting pushes more force through the throat. It sounds harsh and tires your voice quickly. Projection combines low breath support, forward resonance and clear intention, so the voice carries with far less strain.',
            },
            {
              title: 'Your level, not a number',
              body: 'Microphones vary, so Timbre measures loudness relative to your own normal speaking level. First you set a baseline, then you practise stepping up and down from it. Each step of 6 dB is roughly a doubling of sound pressure.',
            },
          ],
          exercise: {
            type: 'volume',
            title: 'Find your levels',
            intro: 'Set a baseline in your normal voice, then try to hit each level. Keep your throat relaxed.',
            levels: [
              { label: 'Quiet, close conversation', db: -6 },
              { label: 'Normal conversation', db: 0 },
              { label: 'Meeting room', db: 6 },
              { label: 'Large room, projected', db: 10 },
            ],
          },
        },
        {
          id: 'projection-2',
          title: 'Throw your voice',
          minutes: 4,
          cards: [
            {
              title: 'Aim your voice',
              body: 'Your voice follows your intention. Pick a target, such as a person or a point on a wall, and imagine your sound landing there. As the target moves further away, let breath and resonance grow; keep your neck free.',
            },
            {
              title: 'The "hey" ladder',
              body: 'Call "hey!" to an imaginary friend 1 metre away, then 3 metres, then 10 metres, then across a street. Breathe low before each call. If your throat tightens, back off a step.',
              tips: ['Use your whole body: stand tall, open your arms slightly, and feel the push come from your belly.'],
            },
          ],
          exercise: {
            type: 'volume',
            title: '"Hey" ladder',
            intro: 'Set your baseline, then call "hey!" to targets further and further away.',
            levels: [
              { label: '1 metre away', db: 0 },
              { label: '3 metres away', db: 4 },
              { label: '10 metres away', db: 8 },
              { label: 'Across the street', db: 12 },
            ],
          },
        },
        {
          id: 'projection-3',
          title: 'Dynamics for emphasis',
          minutes: 4,
          cards: [
            {
              title: 'Contrast holds attention',
              body: 'A speaker who stays at one volume becomes background noise. Shifting between louder and softer creates contrast, and contrast is what the ear notices.',
            },
            {
              title: 'Go quiet to draw them in',
              body: 'Getting louder adds energy. Getting quieter, with clear diction, makes people lean in. Use a drop in volume for secrets, sincerity, or the most important line.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Loud and soft',
            intro: 'Record these with a clear volume contrast inside each line.',
            prompts: [
              'We had one goal. (normal) And we DID IT! (loud)',
              'Everyone expected us to fail. (normal) …but here\'s what they didn\'t know. (soft)',
              'Three. Two. One. (getting louder) GO!',
            ],
            checklist: ['Loud parts stayed free, not shouted', 'Soft parts stayed clear and audible', 'The contrast made the line more dramatic'],
          },
        },
      ],
      quiz: [
        { q: 'Projection relies mainly on…', options: ['Throat force', 'Breath support, resonance and intention', 'Speaking faster', 'A higher pitch'], answer: 1, explain: 'Projection carries through support and resonance, not throat effort.' },
        { q: 'Why does Timbre measure volume relative to your baseline?', options: ['Microphones and rooms vary', 'Absolute dB is illegal', 'Baselines are louder', 'It doesn\'t'], answer: 0, explain: 'Every mic is different, so a personal baseline gives a fair comparison.' },
        { q: 'An increase of about 6 dB is roughly…', options: ['No change', 'A doubling of sound pressure', 'Ten times louder', 'Half as loud'], answer: 1, explain: 'Each 6 dB step roughly doubles the sound pressure.' },
        { q: 'If your throat tightens while projecting, you should…', options: ['Push harder', 'Back off and rebuild with breath', 'Raise your chin', 'Hold your breath'], answer: 1, explain: 'Tightness means the throat is doing the work. Return to breath support.' },
        { q: 'Dropping your volume for a key line usually…', options: ['Loses the audience', 'Makes people lean in', 'Sounds angry', 'Speeds up delivery'], answer: 1, explain: 'A quiet, clear line creates intimacy and focus.' },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'presence',
      title: 'Confidence & Presence',
      blurb: 'Put it all together and speak like you mean it.',
      lessons: [
        {
          id: 'presence-1',
          title: 'Calm the nerves',
          minutes: 4,
          cards: [
            {
              title: 'Nerves are physical',
              body: 'Before a talk, adrenaline raises your heart rate, tightens your throat and makes breathing shallow. Your voice rises, speeds up and shakes. Because the cause is physical, the fastest fix is physical too.',
            },
            {
              title: 'The physiological sigh',
              body: 'Inhale through your nose, then take a second short inhale on top to fully fill the lungs. Then exhale slowly and completely through your mouth. A few of these calm the body quickly and are easy to do discreetly.',
            },
            {
              title: 'Call it excitement',
              body: 'Nervousness and excitement feel almost the same in the body. Telling yourself "I\'m excited" rather than trying to "calm down" helps many speakers channel that energy into their voice.',
            },
          ],
          exercise: {
            type: 'breath',
            title: 'Physiological sighs',
            intro: 'Double inhale through the nose (2 + 1), then a long exhale through the mouth.',
            pattern: [3, 0, 7, 1],
            rounds: 5,
            labels: ['In… and a little more', '', 'Long, slow exhale', 'Rest'],
          },
        },
        {
          id: 'presence-2',
          title: 'Speak with conviction',
          minutes: 4,
          cards: [
            {
              title: 'Cut the hedges',
              body: '"I just think maybe", "sort of", "kind of", "I\'m not sure but" all weaken a statement before it starts. Say what you mean, then stop. You can still be polite without being vague.',
            },
            {
              title: 'Finish strong',
              body: 'Confidence is heard at the end of sentences. Keep breath for the final word, land the pitch, then pause. Trailing off tells the listener you don\'t believe it.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'Hedge vs. clear',
            intro: 'Record the hedged version, then the clear one. Notice the difference in your voice.',
            prompts: [
              'HEDGED: I just kind of think maybe we should consider changing the plan?',
              'CLEAR: We should change the plan. Here\'s why.',
              'HEDGED: Sorry, this might be a dumb question, but…',
              'CLEAR: I have a question.',
            ],
            checklist: ['The clear versions ended with a falling pitch', 'I kept breath to the last word', 'I paused after the clear statement'],
          },
        },
        {
          id: 'presence-3',
          title: 'Tell it like a story',
          minutes: 5,
          cards: [
            {
              title: 'Stories are easier to hear',
              body: 'People remember stories far better than lists of facts. Stories also give your voice natural reasons to change pace, pitch and volume, so expressiveness comes for free.',
            },
            {
              title: 'A simple structure',
              body: 'Hook: one line that makes them curious. Context: where and when. Turn: the problem or surprise. Point: what it means. Aim for about one minute.',
            },
          ],
          exercise: {
            type: 'record',
            title: 'One-minute story',
            intro: 'Pick a prompt and tell the story using hook, context, turn, point.',
            prompts: ['A time something went wrong and you fixed it', 'The moment you changed your mind about something', 'A small win you\'re proud of'],
            checklist: ['I opened with a hook', 'My voice changed at the turn', 'I landed the final point with a fall and a pause'],
          },
        },
        {
          id: 'presence-4',
          title: 'Final challenge',
          minutes: 6,
          cards: [
            {
              title: 'Put it all together',
              body: 'Breathe low. Stand tall. Warm up. Find your mask. Vary your pitch, stress the key words, pace yourself, pause, project, and finish strong. This is your graduation talk.',
            },
            {
              title: 'Measure yourself',
              body: 'Read the voice check passage again, then compare your results with your first voice check on the Progress tab. Small numbers add up.',
            },
          ],
          exercise: {
            type: 'voicecheck',
            title: 'Graduation voice check',
            intro: 'Read the passage with everything you\'ve learned. Your results are saved to Progress so you can compare them with your first check.',
          },
        },
      ],
      quiz: [
        { q: 'A physiological sigh is…', options: ['A long inhale and a short exhale', 'A double inhale followed by a long exhale', 'Holding your breath', 'Sighing loudly at the audience'], answer: 1, explain: 'Two inhales to fill the lungs, then a slow, full exhale.' },
        { q: 'Which phrase is a hedge?', options: ['"We should change the plan."', '"I kind of think maybe…"', '"Here\'s why."', '"I have a question."'], answer: 1, explain: 'Hedges soften a statement before it starts.' },
        { q: 'Confidence is heard most at…', options: ['The start of a sentence', 'The end of a sentence', 'Only in volume', 'Only in pitch height'], answer: 1, explain: 'Landing the final word with breath and a pitch fall sounds certain.' },
        { q: 'A simple story structure is…', options: ['Hook, context, turn, point', 'Intro, intro, intro', 'Facts, facts, conclusion', 'Joke, joke, joke'], answer: 0, explain: 'Hook, context, turn and point give stories shape and momentum.' },
        { q: 'Reframing nerves as excitement works because…', options: ['They feel physically similar', 'It removes adrenaline', 'It lowers your pitch', 'It slows your heart'], answer: 0, explain: 'The body state is similar, so relabelling it is easier than calming down.' },
      ],
    },
  ];

  const badges = [
    { id: 'first-lesson', title: 'First Note', desc: 'Complete your first lesson' },
    { id: 'first-check', title: 'Baseline', desc: 'Finish your first voice check' },
    { id: 'streak-3', title: 'Warmed Up', desc: 'Practise 3 days in a row' },
    { id: 'streak-7', title: 'In Tune', desc: 'Practise 7 days in a row' },
    { id: 'quiz-perfect', title: 'Perfect Pitch', desc: 'Score 100% on a quiz' },
    { id: 'module-done', title: 'Movement One', desc: 'Complete every lesson in a module' },
    { id: 'half-way', title: 'Intermission', desc: 'Complete half the course' },
    { id: 'graduate', title: 'Encore', desc: 'Complete the whole course' },
  ];

  return { modules, badges, VOICE_CHECK_PASSAGE, PACE_PASSAGE };
})();
