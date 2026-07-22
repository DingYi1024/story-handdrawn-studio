#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'examples', 'case-sprouting-note', 'audio', 'sources');
mkdirSync(outputDir, {recursive: true});

const run = (label, inputs, filter, outputName) => {
  const output = resolve(outputDir, outputName);
  const args = ['-v', 'error', '-y', ...inputs];
  if (filter) args.push('-filter_complex', filter, '-map', '[out]');
  args.push('-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output);
  const result = spawnSync('ffmpeg', args, {encoding: 'utf8', windowsHide: true});
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || result.stderr || `status ${result.status}`}`);
  }
  console.log(`${label}: ${outputName}`);
};

const chord = (duration, frequencies) => [
  '-f', 'lavfi', '-i',
  `aevalsrc=exprs=${frequencies.map((frequency, index) =>
    `${index === 0 ? 0.16 : 0.1}*sin(2*PI*${frequency}*t)`).join('+')}:s=48000:d=${duration}`,
];

run(
  'background music',
  [
    ...chord(7.15, [220, 261.626, 329.628]),
    ...chord(7.05, [196, 246.942, 329.628]),
    ...chord(7.15, [174.614, 220, 261.626]),
    ...chord(8, [130.813, 196, 261.626, 329.628]),
  ],
  [
    '[0:a]lowpass=f=1800,aecho=0.8:0.65:70|140:0.16|0.08,afade=t=in:st=0:d=0.8,afade=t=out:st=6.55:d=0.6[a0]',
    '[1:a]lowpass=f=1800,aecho=0.8:0.65:70|140:0.16|0.08,afade=t=in:st=0:d=0.6,afade=t=out:st=6.45:d=0.6[a1]',
    '[2:a]lowpass=f=1800,aecho=0.8:0.65:70|140:0.16|0.08,afade=t=in:st=0:d=0.6,afade=t=out:st=6.55:d=0.6[a2]',
    '[3:a]lowpass=f=1800,aecho=0.8:0.65:70|140:0.16|0.08,afade=t=in:st=0:d=0.6,afade=t=out:st=7.0:d=1.0[a3]',
    '[a0][a1]acrossfade=d=0.6:c1=tri:c2=tri[x1]',
    '[x1][a2]acrossfade=d=0.6:c1=tri:c2=tri[x2]',
    '[x2][a3]acrossfade=d=0.6:c1=tri:c2=tri,volume=0.42[out]',
  ].join(';'),
  'gentle-growth.m4a',
);

run(
  'rain ambience',
  ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.65:s=48000:d=7.2'],
  '[0:a]highpass=f=420,lowpass=f=6200,afftdn=nf=-34,afade=t=in:st=0:d=0.45,afade=t=out:st=6.35:d=0.85,volume=0.44[out]',
  'rain.m4a',
);

run(
  'page-turn effect',
  [
    '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.9:s=48000:d=0.85',
    '-f', 'lavfi', '-i', 'sine=frequency=120:sample_rate=48000:duration=0.85',
  ],
  [
    '[0:a]highpass=f=700,lowpass=f=8500,afade=t=in:st=0:d=0.05,afade=t=out:st=0.18:d=0.67,volume=0.36[paper]',
    '[1:a]lowpass=f=260,afade=t=in:st=0:d=0.05,afade=t=out:st=0.12:d=0.5,volume=0.08[body]',
    '[paper][body]amix=inputs=2:normalize=0[out]',
  ].join(';'),
  'page-turn.m4a',
);

run(
  'seed chime',
  [
    '-f', 'lavfi', '-i', 'sine=frequency=659.255:sample_rate=48000:duration=0.9',
    '-f', 'lavfi', '-i', 'sine=frequency=783.991:sample_rate=48000:duration=0.9',
    '-f', 'lavfi', '-i', 'sine=frequency=987.767:sample_rate=48000:duration=0.9',
  ],
  [
    '[0:a]afade=t=out:st=0.08:d=0.72,volume=0.18[c0]',
    '[1:a]afade=t=out:st=0.08:d=0.72,volume=0.14,adelay=180:all=1[c1]',
    '[2:a]afade=t=out:st=0.08:d=0.72,volume=0.11,adelay=360:all=1[c2]',
    '[c0][c1][c2]amix=inputs=3:duration=longest:normalize=0,aecho=0.8:0.65:80|150:0.22|0.12[out]',
  ].join(';'),
  'seed-chime.m4a',
);

run(
  'watering effect',
  ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.82:s=48000:d=3.2'],
  '[0:a]highpass=f=300,lowpass=f=5200,tremolo=f=5.2:d=0.72,afade=t=in:st=0:d=0.25,afade=t=out:st=2.45:d=0.75,volume=0.33[out]',
  'watering.m4a',
);

run(
  'morning birds',
  [
    '-f', 'lavfi', '-i',
    'aevalsrc=exprs=0.35*sin(2*PI*(1350*t+650*t*t))*sin(PI*min(t/0.3\\,1)):s=48000:d=0.3',
  ],
  [
    '[0:a]afade=t=out:st=0.18:d=0.12,volume=0.45[b0]',
    '[0:a]asetrate=52000,aresample=48000,afade=t=out:st=0.18:d=0.12,volume=0.32,adelay=760:all=1[b1]',
    '[0:a]asetrate=44000,aresample=48000,afade=t=out:st=0.18:d=0.12,volume=0.28,adelay=1650:all=1[b2]',
    '[b0][b1][b2]amix=inputs=3:duration=longest:normalize=0,aecho=0.8:0.55:90:0.13[out]',
  ].join(';'),
  'morning-birds.m4a',
);

console.log('Showcase soundscape sources are ready.');
