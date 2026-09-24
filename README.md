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
- The recording and questionnaire share one view. New visitors start on demo 1 with the first question expanded; returning visitors resume their saved demo and next unanswered question.
- Listening is optional. The recording stays above the questions, with seeking, speed, and volume controls. Playing or finishing it does not interrupt the questionnaire.
- Each questionnaire contains three multiple-choice questions and a required written takeaway. Two correct answers complete the demo; missed questions can be retried.
- Choosing an answer opens the next unanswered question automatically. There is no separate confidence rating.
- Search, manager filters, and completion filters help find a call. Four stats cards show completed demos, the average of saved best quiz scores, questions answered (including drafts), and the selected demo’s best quiz score in a circular gauge. The score chart follows demo order; unanswered demos have no score. On mobile, the cards scroll horizontally.
- Answers, feedback, notes, playback position, and progress are saved in this browser using local storage. There is no server or shared employee reporting. Use the same browser and URL to resume saved progress.
- Passing the last remaining demo opens a congratulations page. Passing means at least two correct answers per demo, not a perfect score. From there, learners can open AI call practice or return to review the demos.
- `#/completed`, `#/ai-practice`, and `#/training` use hash navigation so direct links and reloads work on GitHub Pages. Completion and practice views require all 10 demos to be passed in this browser. This is a local onboarding flow, not a server-enforced access control.

## AI call practice

AI practice now has three scenario-specific voice partners and coaching feedback:

- **Prepare:** choose a scenario and see whether the call service is available. An optional six-second microphone check measures sound locally and shows an input meter; it does not record or upload audio and works even before the call service is configured.
- **Voice call:** OpenAI Realtime over WebRTC, with microphone permission, connection progress, natural interruptions, mute/unmute, a timer, an optional live transcript, and end/cancel controls. Leaving the page releases the microphone. Browser autoplay restrictions show an explicit audio-enable button.
- **Call review:** ending the conversation automatically prepares feedback. The microphone stops immediately; the connection stays open for up to two seconds to collect pending transcription before review. A notice identifies incomplete transcription. The coach evaluates Opening, Discovery, Listening, and Next step (0–5 each), gives evidence from the available transcript, and suggests a phrase to try next. Failed reviews can be retried without repeating the call. Empty attempts are not scored. This is coaching, not certification.
- The last five coaching summaries are saved in this browser and can be cleared. The app does not save call audio or transcripts. Audio and transcripts are processed by OpenAI; provider retention is separate from browser storage. Coaching requests use `store: false`.
- Practice is limited to five minutes in the UI. The backend also schedules a voice hangup after five minutes. Network/provider failures can prevent that hangup request; the browser closes its peer connection independently.

### Enable locally

Use Node.js 22. The existing static training app still runs without a key. AI conversations require an OpenAI API project with access to the configured models.

1. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` there. Never commit this file or put an API key in a `VITE_` variable. Optional model overrides are `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`) and `OPENAI_COACH_MODEL` (default `gpt-4o-mini`).
2. Run `npm run dev`. The practice API runs inside Vite, so no second process is needed.
3. Open the local URL printed by Vite (normally http://127.0.0.1:5173/calls/), complete the demos, then open AI call practice. Choose a scenario, optionally check your microphone, and start a practice call. Allow microphone access and use headphones. End the call to receive coaching automatically.

Vite serves `/api/practice` on the same port as the app in development and preview. Restart Vite after changing `.env.local`. The separate backend remains available through `npm run dev:api` when needed. A missing or unreachable service is shown as unavailable, never as a pretend live conversation. API/model/quota errors let the learner retry.

To serve the production build and API together locally, run `npm run build`, then `npm start`, and open http://127.0.0.1:8787/calls/.

### Connect the published site

GitHub Pages serves static files and cannot run this backend. Deploy `server/index.mjs` to a persistent Node.js 22 service, with `npm start` as its start command. It can serve the frontend too if you run `npm ci && npm run build` during deployment.

Configure these variables on the backend host:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | Private provider key, on the backend only |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` (the local default is `127.0.0.1`) |
| `PORT` | The port supplied by the host, or 8787 |
| `PRACTICE_ACCESS_CODE` | A private code of at least 16 characters to share with trainees |
| `ALLOWED_ORIGINS` | `https://adnangodance.github.io` for Pages; add the backend's own HTTPS origin if serving the frontend there too; comma-separated origins, no paths or trailing slash |

For the existing Pages frontend, set the repository's **Actions variable** `VITE_PRACTICE_API_URL` to the backend's public HTTPS origin (no `/api` suffix), then rerun the deploy workflow. This URL is public. Keep the API key and access code out of GitHub frontend variables. For a frontend served by the same Node server, leave `VITE_PRACTICE_API_URL` empty.

The backend reports availability at `GET /api/practice/config`. Production refuses AI requests until the provider key, access code, and allowed origins are configured. Trainees enter only the shared practice code; it stays in memory. Demo completion remains a browser-only onboarding gate, not authorization. The shared code is suitable for a small pilot; this app does not yet have individual trainee accounts.

Request/body limits and call deadlines live in one Node process. Limits are shared behind a reverse proxy because forwarded IP headers are not trusted. Use one persistent instance for this pilot; a multi-instance/serverless deployment needs shared limits and a durable call scheduler. Set provider spending controls before broader rollout. No backend has been deployed by this code change.

Implementation follows the official [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc), [Realtime conversation events](https://developers.openai.com/api/docs/guides/realtime-conversations), and [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## Replace sample recordings

Edit `src/calls.json` for the calls and questionnaires. Source transcripts are retained for regenerating sample audio and are not displayed in the app. Replace WAV files under `public/audio/`, and update the audio path and duration in seconds. Each question's `correct` value is the zero-based index of its correct option. The course currently contains 10 demos with three scored questions each.

The sample recordings can be regenerated on macOS with `python3 scripts/generate-audio.py`, using the local Daniel and Samantha voices.

## Verification

Automated React/DOM tests cover immediate questionnaire access, submission without playback, validation, retries, optional playback, call navigation, progress restoration, course completion, and navigation to AI practice. Practice tests cover voice conversations, automatic feedback/history, retry and cancellation, access codes, provider failures, request limits, transcript ordering and finalization, local microphone checks (sound, silence, cancellation, and cleanup), microphone denial, and WebRTC cleanup. Provider responses and media events are controlled test doubles; they do not verify real model output, audio quality, or microphone hardware. A live AI conversation still requires a configured provider key and a manual smoke test. `node scripts/check-pages-build.mjs` verifies production asset paths and sample recordings after building.
