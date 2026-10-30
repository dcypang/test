# Timbre Voice Coach

A mobile-first voice-training web app: short daily lessons, live microphone feedback, quizzes and progress tracking. It's a plain static site with no build step and no dependencies. All audio analysis runs in the browser, and nothing is uploaded.

## What's inside

**Course: 9 modules, 33 lessons, 46 quiz questions, plus a 12-question final exam**

| # | Module | Lessons |
|---|--------|---------|
| 1 | Breath & Posture | Breathe from your belly · Stand like a speaker · The long hiss · Let go of tension |
| 2 | Warm-ups & Vocal Care | Lip trills and hums · Sirens · Straw phonation · Everyday vocal care |
| 3 | Resonance & Tone | What resonance is · Find your mask with "mm-hmm" · Move your voice forward · Fix nasal or breathy tone |
| 4 | Pitch | Your optimal pitch · Stretch your range · Vocal fry and uptalk |
| 5 | Intonation & Expression | Escape the monotone · Stress the words that matter · Statements, questions, authority · Emotion in your voice |
| 6 | Articulation & Diction | Meet your articulators · Tongue twisters · The cork drill · Crisp endings |
| 7 | Pace & Pauses | Find your speaking rate · The power of the pause · Drop the fillers |
| 8 | Volume & Projection | Projection isn't shouting · Throw your voice · Dynamics for emphasis |
| 9 | Confidence & Presence | Calm the nerves · Speak with conviction · Tell it like a story · Final challenge |

Each lesson has 2–3 short teaching cards followed by a hands-on exercise. Each module ends with a quiz that explains every answer.

**Interactive exercises**
- **Pitch tracker**: live pitch trace (YIN algorithm) with note names, median pitch, range and variation in semitones. Goals include range, steadiness, expressiveness and falling sentence endings.
- **Voice check**: read a passage and get your speaking pitch, melody, pace (WPM), pauses and range, with recommended modules. Results are saved and charted over time.
- **Pace check**: words per minute and pause counting while you read.
- **Level meter**: projection practice measured against your own baseline in dB.
- **Breath timer**: times a sustained "sss" automatically.
- **Recorder**: record takes, play them back, and analyze them.
- **Breathing pacer, guided routines, filler-word counter, checklists.**
- No microphone? Pitch tools and the voice check can analyze an uploaded recording (for example an iPhone Voice Memo).

**App features:** onboarding, daily plan, streaks, XP and levels, badges, a 4-week activity heatmap, voice-check trend charts, and light and dark themes. It can be installed to the iPhone home screen.

## Run it locally

The microphone needs a secure context, so serve the folder over `localhost`:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Put it on your phone

1. Host the folder on any static host with HTTPS, such as GitHub Pages (Settings → Pages → deploy from branch, root folder), Netlify or Vercel.
2. On iPhone, open the URL in Safari, tap **Share → Add to Home Screen**.

Progress is stored in `localStorage` on each device.

## Project layout

```
index.html            app shell
css/styles.css        design tokens, light/dark themes, components
js/content.js         the full curriculum: lessons, exercises, quizzes, badges
js/audio.js           mic input, YIN pitch detection, loudness, recording, file analysis
js/exercises.js       interactive exercise renderers
js/ui.js              icons and DOM helpers
js/app.js             state, daily plan, views, lesson/quiz/tool screens, routing
```

To add or edit lessons, change `js/content.js`. The exercise types are documented at the top of that file.

## Notes

All lesson text, exercises and quiz questions are original. Measurements are practice guides, not clinical measurements. Timbre is not medical advice: for hoarseness lasting more than two weeks, pain, or sudden voice changes, see a doctor or speech-language pathologist.
