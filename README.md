# TargetOne Training Calls

A standalone sales onboarding page based on the supplied TargetOne reference.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173/calls/).

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

The site is published at https://adnangodance.github.io/calls/. GitHub Pages uses **GitHub Actions** as its deployment source. The workflow in `.github/workflows/deploy.yml` installs dependencies, runs the tests, builds the app, verifies its asset paths, and publishes only `dist/` on every push to `main`.

Vite's `/calls/` base path applies to scripts, styles, the favicon, and recordings. Do not publish the repository root directly: its `index.html` is a development entry point that requires Vite to compile the app.

## Training flow

- 10 fictional, voice-generated demo calls, shown in demo order.
- The original page frame and Listen/Questionnaire tabs are retained. The Questionnaire tab opens immediately: new visitors start on demo 1 with the first question expanded; returning visitors resume their saved demo and next unanswered question.
- Listening is optional. The recording stays above the questions, with seeking, speed, and volume controls. Playing or finishing it does not interrupt the questionnaire.
- Each questionnaire contains three multiple-choice questions and a required written takeaway. Two correct answers complete the demo; missed questions can be retried.
- The optional confidence rating is saved separately and does not affect completion or scores.
- Search, manager filters, and completion filters help find a call. Stats cards show completed demos, the average of saved best quiz scores, and questions answered, including drafts. The score chart follows demo order; unanswered demos have no score. On mobile, the cards scroll horizontally.
- Answers, feedback, notes, playback position, and progress are saved in this browser using local storage. There is no server or shared employee reporting. Use the same browser and URL to resume saved progress.

## Replace sample recordings

Edit `src/calls.json` for the calls and questionnaires. Source transcripts are retained for regenerating sample audio and are not displayed in the app. Replace WAV files under `public/audio/`, and update the audio path and duration in seconds. Each question's `correct` value is the zero-based index of its correct option. The course currently contains 10 demos with three scored questions each.

The sample recordings can be regenerated on macOS with `python3 scripts/generate-audio.py`, using the local Daniel and Samantha voices.

## Verification

Automated React/DOM tests cover immediate questionnaire access, submission without playback, validation, retries, optional playback, call navigation, and progress restoration. Media events are simulated rather than decoded. `node scripts/check-pages-build.mjs` verifies production asset paths and sample recordings after building.
