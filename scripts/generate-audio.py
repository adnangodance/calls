"""Generate clearly labeled sample conversations using macOS's local voices.

Run: python3 scripts/generate-audio.py
Real recordings can replace these WAV files and their transcript timestamps.
No text or audio is sent to an external service.
"""
import json
import pathlib
import subprocess
import tempfile
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src' / 'calls.json'
OUTPUT = ROOT / 'public' / 'audio'
OUTPUT.mkdir(parents=True, exist_ok=True)
calls = json.loads(SOURCE.read_text())

with tempfile.TemporaryDirectory(prefix='targetone-audio-') as temp:
    for call in calls:
        frames = []
        count = 0
        for index, line in enumerate(call['transcript']):
            segment = pathlib.Path(temp) / f'{call["id"]}-{index}.wav'
            voice = 'Daniel' if index % 2 == 0 else 'Samantha'
            subprocess.run(['say', '-v', voice, '-r', '175', '-o', str(segment), '--data-format=LEI16@22050', line['text']], check=True)
            with wave.open(str(segment), 'rb') as audio:
                if audio.getnframes() == 0:
                    raise RuntimeError('Speech synthesis returned no audio. macOS speech services may be blocked by the sandbox.')
                if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 22050:
                    raise ValueError('Unexpected audio format')
                line['at'] = round(count / 22050, 3)
                frames.append(audio.readframes(audio.getnframes()))
                count += audio.getnframes()
            silence = b'\0' * (int(22050 * 0.25) * 2)
            frames.append(silence)
            count += len(silence) // 2
        with wave.open(str(OUTPUT / f'{call["id"]}.wav'), 'wb') as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(22050)
            out.writeframes(b''.join(frames))
        call['duration'] = round(count / 22050, 3)
        call['audio'] = f'/audio/{call["id"]}.wav'
        print(f'{call["id"]}: {call["duration"]:.1f}s', flush=True)

SOURCE.write_text(json.dumps(calls, ensure_ascii=False, indent=2) + '\n')
