// Synthesizes an in-sync soundtrack with ffmpeg only (no samples, no API keys).
// Inputs: cues [{t, sfx, gain?}], optional music {bpm, gain?}, optional external track.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 48000;
// name -> [aevalsrc expression, duration s, post-filter]
const N = '(random(0)*2-1)';
export const SFX = {
  tick:   [`0.35*sin(2*PI*2600*t)*exp(-140*t)`, 0.05, 'anull'],
  type:   [`0.22*${N}*exp(-260*t)`, 0.03, 'highpass=f=1800'],
  pop:    [`0.5*sin(2*PI*(500*t+2600*t*t))*exp(-32*t)`, 0.16, 'anull'],
  click:  [`0.45*sin(2*PI*1400*t)*exp(-90*t)+0.15*${N}*exp(-300*t)`, 0.07, 'anull'],
  whoosh: [`0.55*${N}*pow(sin(PI*t/0.45),2)`, 0.45, 'bandpass=f=1800:width_type=q:w=0.7,volume=1.6'],
  swoosh: [`0.5*${N}*pow(sin(PI*t/0.3),3)`, 0.3, 'highpass=f=2500,volume=1.4'],
  rise:   [`(0.25*sin(2*PI*(180*t+260*t*t))+0.2*${N})*pow(t/1.2,2.2)`, 1.2, 'lowpass=f=5000'],
  boom:   [`0.9*sin(2*PI*(38*t+5.5*(1-exp(-14*t))))*exp(-3.2*t)+0.25*${N}*exp(-18*t)`, 1.4, 'lowpass=f=1800'],
  hit:    [`0.7*sin(2*PI*(60*t+4*(1-exp(-30*t))))*exp(-9*t)+0.35*${N}*exp(-35*t)`, 0.5, 'lowpass=f=6000'],
  chime:  [`0.18*(sin(2*PI*880*t)+0.6*sin(2*PI*1318.5*t)+0.4*sin(2*PI*1760*t))*exp(-5*t)`, 1.0, 'anull'],
  glitch: [`0.3*${N}*(mod(floor(t*90),2))*exp(-6*t)`, 0.35, 'bandpass=f=3000:width_type=q:w=1'],
};

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function synthMusic(dir, dur, { bpm = 118, gain = 1, style = 'pulse' } = {}) {
  const P = (60 / bpm).toFixed(5);
  const b = `mod(t,${P})`, off = `mod(t+${P}/2,${P})`, bar = `mod(t,4*${P})`;
  const kick = `0.75*sin(2*PI*(45*${b}+4.4*(1-exp(-25*${b}))))*exp(-7*${b})`;
  const hat = `0.07*${N}*exp(-90*${off})`;
  // A-minor-ish pad, slow swell per bar, sidechain-style dip on each kick
  const pad = `0.05*(sin(2*PI*110*t)+0.7*sin(2*PI*130.81*t)+0.6*sin(2*PI*164.81*t)+0.3*sin(2*PI*220*t))*(0.7+0.3*sin(PI*${bar}/(4*${P})))*(1-0.8*exp(-9*${b}))`;
  const bass = `0.18*sin(2*PI*55*t)*(1-exp(-12*${b}))*exp(-2.5*${b})`;
  const out = join(dir, 'music.wav');
  if (style === 'ambient') {
    // no kick: warm major-7 pad swelling per bar + soft plucked notes on each beat
    const bar4 = `mod(t,4*${P})`;
    const amb = `0.045*(sin(2*PI*130.81*t)+0.8*sin(2*PI*164.81*t)+0.7*sin(2*PI*196*t)+0.5*sin(2*PI*246.94*t)+0.35*sin(2*PI*65.41*t))*(0.55+0.45*sin(PI*${bar4}/(4*${P})))`;
    const pluck = `0.09*sin(2*PI*(523.25+261.6*eq(mod(floor(t/${P}),4),2)+130.8*eq(mod(floor(t/${P}),4),3))*${b})*exp(-5*${b})`;
    ff(['-f', 'lavfi', '-i', `aevalsrc='${amb}':s=${SR}:d=${dur}`,
        '-f', 'lavfi', '-i', `aevalsrc='${pluck}':s=${SR}:d=${dur}`,
        '-f', 'lavfi', '-i', `aevalsrc='${hat}*0.5':s=${SR}:d=${dur}`,
        '-filter_complex', `[0]lowpass=f=1800[a];[1]lowpass=f=3500,aecho=0.6:0.4:${Math.round(P*750)}:0.35[p];[2]highpass=f=7000[h];[a][p][h]amix=inputs=3:normalize=0,volume=${gain},afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, dur - 2)}:d=2[o]`,
        '-map', '[o]', '-ac', '2', out]);
    return out;
  }
  ff(['-f', 'lavfi', '-i', `aevalsrc='${kick}+${bass}':s=${SR}:d=${dur}`,
      '-f', 'lavfi', '-i', `aevalsrc='${hat}':s=${SR}:d=${dur}`,
      '-f', 'lavfi', '-i', `aevalsrc='${pad}':s=${SR}:d=${dur}`,
      '-filter_complex', `[1]highpass=f=6000[h];[2]lowpass=f=1400[p];[0][h][p]amix=inputs=3:normalize=0,volume=${gain},afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, dur - 1.5)}:d=1.5[o]`,
      '-map', '[o]', '-ac', '2', out]);
  return out;
}

// Place clips on a timeline and mix them into one stereo wav of exactly `duration` seconds.
function mixClips(clips, duration, out, pre = 'anull') {
  const inputs = [], labels = [];
  clips.forEach((c, k) => {
    const ms = Math.max(0, Math.round(c.t * 1000));
    inputs.push('-i', c.file);
    labels.push(`[${k}]aresample=${SR},aformat=channel_layouts=stereo,${pre},adelay=${ms}|${ms},volume=${c.gain ?? 1}[c${k}]`);
  });
  const mix = clips.map((_, k) => `[c${k}]`).join('');
  ff([...inputs, '-filter_complex',
      `${labels.join(';')};${mix}amix=inputs=${clips.length}:normalize=0:duration=longest,apad,atrim=0:${duration}[o]`,
      '-map', '[o]', '-ar', String(SR), '-ac', '2', out]);
  return out;
}

// Three buses: bed (music or --audio track), sfx (cues), vox (narration).
// The bed is side-chain ducked under the voice so narration stays intelligible.
export function buildSoundtrack({ dir, duration, cues = [], music = null, track = null, sfx = true, voice = [] }) {
  mkdirSync(dir, { recursive: true });
  const hasVox = voice.length > 0;
  let bed = track || (music ? synthMusic(dir, duration, music) : null);
  if (bed) {
    const g = (music && music.gain) || 1;
    const b2 = join(dir, 'bed.wav');
    ff(['-i', bed, '-af', `aresample=${SR},aformat=channel_layouts=stereo,apad,atrim=0:${duration},afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5,volume=${(track ? g * 0.8 : 1) * (hasVox ? 0.8 : 1)}`, '-ar', String(SR), b2]);
    bed = b2;
  }
  let fx = null;
  if (sfx && cues.length) {
    const made = {}, clips = [];
    for (const c of cues) {
      const def = SFX[c.sfx];
      if (!def) { console.warn(`unknown sfx "${c.sfx}" (have: ${Object.keys(SFX).join(', ')})`); continue; }
      if (!made[c.sfx]) {
        made[c.sfx] = join(dir, `sfx-${c.sfx}.wav`);
        ff(['-f', 'lavfi', '-i', `aevalsrc='${def[0]}':s=${SR}:d=${def[1]}`, '-af', def[2], '-ac', '2', made[c.sfx]]);
      }
      clips.push({ file: made[c.sfx], t: c.t, gain: (c.gain ?? 1) * (hasVox ? 0.7 : 1) });
    }
    if (clips.length) fx = mixClips(clips, duration, join(dir, 'sfx.wav'));
  }
  const vox = hasVox ? mixClips(voice, duration, join(dir, 'vox.wav'),
    'highpass=f=70,acompressor=threshold=0.12:ratio=3:attack=5:release=90,equalizer=f=3200:t=q:w=1:g=2') : null;

  const buses = [bed, fx, vox].filter(Boolean);
  if (!buses.length) return null;
  const out = join(dir, 'soundtrack.wav');
  const ins = buses.flatMap((b) => ['-i', b]);
  const idx = (b) => buses.indexOf(b);
  let graph, tail = 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[o]';
  if (bed && vox) {
    const others = buses.filter((b) => b !== bed && b !== vox).map((b) => `[${idx(b)}]`).join('');
    graph = `[${idx(vox)}]asplit=2[v][key];[${idx(bed)}][key]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=450[bd];` +
            `[bd]${others}[v]amix=inputs=${buses.length}:normalize=0,${tail}`;
  } else {
    graph = `${buses.map((b) => `[${idx(b)}]`).join('')}amix=inputs=${buses.length}:normalize=0,${tail}`;
  }
  ff([...ins, '-filter_complex', graph, '-map', '[o]', '-ar', String(SR), out]);
  return out;
}
