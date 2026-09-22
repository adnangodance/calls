# TargetOne Training Calls

A standalone sales onboarding page based on the supplied TargetOne reference.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm test
npm run build
npm run preview
```

## Training flow

- 10 fictional, voice-generated demo calls with transcripts and coaching notes.
- Listen to at least 90% of each recording to unlock its questionnaire. Finishing the recording opens the questionnaire automatically once this threshold is met. Playback ranges are captured from the browser, so pausing, replaying, changing speed, and returning later preserve listening progress. Seeking or replaying the same segment does not add duplicate credit.
- Each questionnaire contains three multiple-choice questions and a required written takeaway. Two correct answers complete the demo; missed questions can be retried.
- Search, manager filters, sorting, bookmarks, playback speed, and transcript seeking are available.
- Answers, feedback, notes, bookmarks, playback position, and progress are saved in this browser using local storage. There is no server or shared employee reporting yet. Use the same browser and local URL to resume saved progress.
- The surrounding workspace navigation is visual context for this standalone preview.

## Replace sample recordings

Edit `src/calls.json` for the calls, learning objectives, transcripts, and questionnaires. Replace WAV files under `public/audio/`, and update the matching audio path, duration in seconds, and each transcript line's `at` timestamp. Each question's `correct` value is the zero-based index of its correct option. The current course is designed for 10 demos with three scored questions each.

The sample recordings can be regenerated on macOS with `python3 scripts/generate-audio.py`, using the local Daniel and Samantha voices.

## Recovery status

Resumed after the interrupted September 22 session. Finished the responsive styling, resolved the TypeScript build failure, and fixed submitted questionnaire feedback not restoring after reload. Playback progress now merges ranges in timestamp order, including when replaying earlier sections. A prominent next-step panel links listening to its questionnaire; secondary reference material and advanced filters are expandable. Automated React/DOM tests cover playback completion, quiz submission, validation, retries, and restoration across reloads. These tests simulate media events rather than decode audio. All 10 audio durations and transcript timestamps were verified. A full interactive browser walkthrough remains unverified because computer access to Chrome was not approved.
