#!/usr/bin/env node
/**
 * Maintainer tool: re-encode the games' WAV audio to compressed alternates.
 *
 * Why this matters more than any code change: measured with scripts/check-budget,
 * audio was the largest single cost in every game - 855 KB (lastwar) to 1270 KB
 * (whiteout) gzipped, LARGER than the Phaser engine at 365-471 KB. WAV is
 * uncompressed PCM, so gzip cannot help; the transfer is the raw samples.
 *
 * And measuring the corpus narrowed it further: one file per game is nearly all of
 * it. whiteout's music_loop.wav is 1,176,044 of its 1,270 KB. The other eleven files
 * together are under 100 KB. So the win is concentrated, not spread.
 *
 * TWO output formats, not one, because the mission targets cheap phones and old
 * browsers. Ogg/Opus is the smallest by a wide margin but older iOS Safari cannot
 * play it; AAC in m4a plays everywhere. Phaser's loader already takes an ARRAY of
 * urls and picks the first the browser supports, which the asset manifests were
 * already written as - so the player downloads exactly ONE of the two. Repo and
 * deploy size carry both; transfer does not.
 *
 * Usage:
 *   node scripts/convert-audio.mjs           # report what would change
 *   node scripts/convert-audio.mjs --write   # encode, and delete the .wav sources
 */
import { readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/**
 * Bitrates. Two profiles because one setting cannot serve both: a 22-second music
 * loop and a 40ms UI click have completely different perceptual budgets, and using
 * the music rate for clicks would waste most of the saving.
 *
 * Everything here is mono 22050 Hz already, so there is no resampling to argue
 * about - the sources were authored small.
 */
const MUSIC_SECONDS = 5;
const PROFILES = {
  music: { opus: '56k', aac: '64k' },
  sfx: { opus: '40k', aac: '48k' },
};

function ffprobeSeconds(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(out.trim()) || 0;
}

function encode(input, output, args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...args, output]);
}

const KB = (n) => Math.round((n / 1024) * 10) / 10;

const audioDirs = readdirSync(join(ROOT, 'packages'))
  .map((slug) => ({ slug, dir: join(ROOT, 'packages', slug, 'public', 'assets', 'audio') }))
  .filter(({ dir }) => existsSync(dir));

if (audioDirs.length === 0) {
  console.error('convert-audio found no packages/*/public/assets/audio directory.');
  process.exit(2);
}

let wavTotal = 0;
let opusTotal = 0;
let aacTotal = 0;
let count = 0;

for (const { slug, dir } of audioDirs) {
  const wavs = readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.wav');
  if (wavs.length === 0) continue;
  console.log(`\n${slug}`);

  for (const name of wavs) {
    const input = join(dir, name);
    const stem = basename(name, '.wav');
    const seconds = ffprobeSeconds(input);
    const profile = seconds >= MUSIC_SECONDS ? PROFILES.music : PROFILES.sfx;
    const ogg = join(dir, `${stem}.ogg`);
    const m4a = join(dir, `${stem}.m4a`);

    if (WRITE) {
      encode(input, ogg, ['-c:a', 'libopus', '-b:a', profile.opus, '-ac', '1', '-vbr', 'on']);
      encode(input, m4a, ['-c:a', 'aac', '-b:a', profile.aac, '-ac', '1']);
    }

    const wavSize = statSync(input).size;
    const oggSize = existsSync(ogg) ? statSync(ogg).size : 0;
    const aacSize = existsSync(m4a) ? statSync(m4a).size : 0;
    wavTotal += wavSize;
    opusTotal += oggSize;
    aacTotal += aacSize;
    count += 1;

    const tag = seconds >= MUSIC_SECONDS ? 'music' : 'sfx  ';
    console.log(
      `  ${tag} ${stem.padEnd(20)} ${String(KB(wavSize)).padStart(8)} KB wav` +
        (oggSize ? ` -> ${String(KB(oggSize)).padStart(7)} KB ogg, ${String(KB(aacSize)).padStart(7)} KB m4a` : ' (dry run)'),
    );

    if (WRITE) unlinkSync(input);
  }
}

console.log(
  `\n${count} file(s): ${KB(wavTotal)} KB wav -> ${KB(opusTotal)} KB ogg + ${KB(aacTotal)} KB m4a.` +
    `\nA browser downloads ONE of the two, so transfer per player is ${KB(opusTotal)} KB (Opus) or ${KB(aacTotal)} KB (AAC).`,
);
if (!WRITE) console.log('Dry run. Pass --write to encode and remove the .wav sources.');
