#!/usr/bin/env python3
"""Narration engine for Launch Video Kit.

stdin JSON: {"voice": "af_heart", "speed": 1.05, "out": "/tmp/dir", "lines": [{"key": "h1", "say": "text"}]}
stdout JSON: {"h1": {"file": ".../h1.wav", "dur": 1.23, "words": [{"w": "clearer", "s": 0.21, "e": 0.55}], "heard": "..."}}

TTS: Kokoro-82M (Apache-2.0, local, free) via kokoro-onnx.
     Or ElevenLabs: set voice to "el:<voice_id>" (optionally "el:<voice_id>:<model_id>") and export
     ELEVENLABS_API_KEY. Speed maps to voice_settings.speed (clamped 0.7-1.2). Key is read from env only.
Alignment: faster-whisper (small.en) word timestamps, used both to anchor visuals to
specific words and as an intelligibility check ("heard" vs "say"). Optional: if
faster-whisper is missing, words = [] and layout falls back to line-level sync.
Clips are cached by hash(voice, speed, text), so re-renders after visual edits are instant.
"""
import hashlib, json, os, re, sys
import numpy as np
import soundfile as sf

CACHE = os.environ.get('LVK_CACHE', os.path.expanduser('~/.cache/lvk'))
KOKORO_DIR = os.path.join(CACHE, 'kokoro')
HF = 'https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/'


def ensure_models():
    os.makedirs(KOKORO_DIR, exist_ok=True)
    for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
        p = os.path.join(KOKORO_DIR, f)
        if not os.path.exists(p):
            import urllib.request
            print(f'[tts] downloading {f} (one time)', file=sys.stderr)
            urllib.request.urlretrieve(HF + f, p + '.part')
            os.rename(p + '.part', p)


def eleven(text, spec, speed):
    import subprocess, tempfile, urllib.request
    parts = spec.split(':')
    vid, model = parts[1], (parts[2] if len(parts) > 2 else 'eleven_multilingual_v2')
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        sys.exit('[tts] ELEVENLABS_API_KEY not set')
    body = json.dumps({'text': text, 'model_id': model, 'voice_settings': {
        'stability': 0.5, 'similarity_boost': 0.75, 'style': 0.0, 'use_speaker_boost': True,
        'speed': max(0.7, min(1.2, speed))}}).encode()
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_128',
                                 data=body, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r, tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        f.write(r.read()); mp3 = f.name
    wav = mp3[:-4] + '.wav'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '24000', wav], check=True)
    a, sr = sf.read(wav, dtype='float32')
    os.remove(mp3); os.remove(wav)
    return a, sr


def trim(a, sr, thresh=0.008, pad=0.04):
    idx = np.where(np.abs(a) > thresh)[0]
    if not len(idx):
        return a
    s = max(0, idx[0] - int(pad * sr)); e = min(len(a), idx[-1] + int(pad * sr))
    return a[s:e]


def main():
    req = json.load(sys.stdin)
    voice, speed, out = req.get('voice', 'af_heart'), float(req.get('speed', 1.0)), req['out']
    lang = req.get('lang', 'en-us')
    os.makedirs(out, exist_ok=True)
    clipdir = os.path.join(CACHE, 'clips'); os.makedirs(clipdir, exist_ok=True)

    kokoro = whisper = None
    result = {}
    for ln in req['lines']:
        text = ln['say']
        h = hashlib.sha1(f'{voice}|{speed}|{lang}|{text}'.encode()).hexdigest()[:16]
        wav, meta = os.path.join(clipdir, h + '.wav'), os.path.join(clipdir, h + '.json')
        if not os.path.exists(wav):
            if voice.startswith('el:'):
                a, sr = eleven(text, voice, speed)
            elif kokoro is None:
                ensure_models()
                from kokoro_onnx import Kokoro
                kokoro = Kokoro(os.path.join(KOKORO_DIR, 'kokoro-v1.0.onnx'), os.path.join(KOKORO_DIR, 'voices-v1.0.bin'))
            if not voice.startswith('el:'):
                a, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            a = trim(np.asarray(a, dtype=np.float32), sr)
            sf.write(wav, a, sr)
        if not os.path.exists(meta):
            words, heard = [], None
            try:
                if whisper is None:
                    from faster_whisper import WhisperModel
                    whisper = WhisperModel('small.en', device='cpu', compute_type='int8', download_root=os.path.join(CACHE, 'whisper'))
                segs, _ = whisper.transcribe(wav, word_timestamps=True, language='en')
                segs = list(segs)
                heard = ''.join(s.text for s in segs).strip()
                for s in segs:
                    for w in s.words:
                        words.append({'w': re.sub(r'[^\w\'-]', '', w.word).lower(), 's': round(float(w.start), 3), 'e': round(float(w.end), 3)})
            except ImportError:
                pass
            json.dump({'words': words, 'heard': heard}, open(meta, 'w'))
        info = sf.info(wav)
        m = json.load(open(meta))
        result[ln['key']] = {'file': wav, 'dur': round(info.frames / info.samplerate, 3), 'words': m['words'], 'heard': m['heard']}
    json.dump(result, sys.stdout)


if __name__ == '__main__':
    main()
