#!/usr/bin/env node
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {parseArgs, numberArg, stringArg} from './lib/args.mjs';
import {runVisualQa} from './lib/visual-qa.mjs';

const usage = `Usage:
  node scripts/qa-video.mjs VIDEO [--output report.json] [--frames-dir qa-frames]
    [--width 1080 --height 1440 --fps 30 --duration 12]
    [--duration-tolerance 0.15 --fps-tolerance 0.02]
    [--color-after 2.5 --samples 9] [--compact] [--portable] [--no-fail-on-qa]

The report is always emitted as machine-readable JSON on stdout.`;

const args = parseArgs(process.argv.slice(2));
if (args.help === true || args.h === true) {
  console.log(usage);
  process.exit(0);
}

const inputArg = args._[0];
const fail = (message) => {
  console.log(JSON.stringify({
    kind: 'visual-qa-error',
    schemaVersion: '1.0',
    status: 'error',
    passed: false,
    error: message,
  }, null, args.compact === true ? 0 : 2));
  process.exitCode = 2;
};

if (!inputArg) {
  fail('A video path is required');
} else {
  const input = resolve(process.cwd(), inputArg);
  if (!existsSync(input)) {
    fail(`Video does not exist: ${input}`);
  } else {
    try {
      const optionalNumber = (key) => numberArg(args, key);
      const expected = {
        width: optionalNumber('width'),
        height: optionalNumber('height'),
        fps: optionalNumber('fps'),
        durationSec: optionalNumber('duration'),
        fpsTolerance: optionalNumber('fps-tolerance'),
        durationToleranceSec: optionalNumber('duration-tolerance'),
      };
      const outputArg = stringArg(args, 'output');
      const framesArg = stringArg(args, 'frames-dir');
      const report = runVisualQa(input, {
        expected,
        colorAfterSec: optionalNumber('color-after'),
        timelineSamples: optionalNumber('samples'),
        framesDir: framesArg ? resolve(process.cwd(), framesArg) : undefined,
        artifactsRelativeTo: args.portable === true ? process.cwd() : undefined,
        ffmpeg: stringArg(args, 'ffmpeg', 'ffmpeg'),
        ffprobe: stringArg(args, 'ffprobe', 'ffprobe'),
      });
      const json = JSON.stringify(report, null, args.compact === true ? 0 : 2);
      if (outputArg) {
        const output = resolve(process.cwd(), outputArg);
        mkdirSync(dirname(output), {recursive: true});
        writeFileSync(output, `${json}\n`, 'utf8');
      }
      console.log(json);
      if (!report.passed && args['fail-on-qa'] !== false) process.exitCode = 1;
    } catch (error) {
      fail(error.message);
    }
  }
}
