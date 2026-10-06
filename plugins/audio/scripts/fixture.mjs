// The Field Notes fixture: four macOS voices read the same intro, the way a
// text-to-speech agent would send its takes with --attach. Each take is
// written in a different format (WAV, MP3, M4A, Ogg Opus), with word
// timings found from the pauses in its own recording. Writes the audio to
// fixtures/fieldnotes/, and beside it the pending fixture and the decided
// one.
//
//   node scripts/fixture.mjs
//
// Needs macOS (say, afconvert), lame for the MP3 and ffmpeg for the Ogg.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "fixtures", "fieldnotes");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audio-fixture-"));
fs.mkdirSync(out, { recursive: true });

const SEGMENTS = [
  { id: "s1", text: "Welcome back to Field Notes." },
  {
    id: "s2",
    text: "This week, Linh Nguyen walks us through the new harbour bridge, and why it took eleven years to build.",
  },
  { id: "s3", text: "Stay with us." },
];
const SCRIPT = SEGMENTS.map((s) => s.text).join(" ");

const TAKES = [
  {
    id: "samantha",
    name: "Samantha",
    voice: "Samantha",
    rate: 175,
    file: "samantha.wav",
    format: "wav",
    details: ["en-US", "175 wpm", "WAV"],
    reasoning: "The house voice from the last season. Clear and even, a little *newsreader*.",
  },
  {
    id: "daniel",
    name: "Daniel",
    voice: "Daniel",
    rate: 195,
    file: "daniel.mp3",
    format: "mp3",
    details: ["en-GB", "195 wpm", "MP3"],
    reasoning:
      "British and brisk. Pushed to 195 words a minute to leave room in the slot; listen to whether **the name** survives the speed.",
  },
  {
    id: "moira",
    name: "Moira",
    voice: "Moira",
    rate: 170,
    file: "moira.m4a",
    format: "m4a",
    details: ["en-IE", "170 wpm", "AAC"],
    reasoning: "Warmer, and the slowest of the four. Runs past eight seconds, so something would have to go.",
  },
  {
    id: "karen",
    name: "Karen",
    voice: "Karen",
    rate: 180,
    file: "karen.ogg",
    format: "ogg",
    details: ["en-AU", "180 wpm", "Opus"],
    reasoning: "The brightest read. Included as the outlier.",
  },
];

const MEDIA = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg" };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });

/* 16-bit PCM from a WAV file, as floats. */
function readWav(file) {
  const b = fs.readFileSync(file);
  let at = 12,
    rate = 0,
    channels = 1;
  while (at < b.length) {
    const id = b.toString("ascii", at, at + 4),
      size = b.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(at + 10);
      rate = b.readUInt32LE(at + 12);
    }
    if (id === "data") {
      const n = size / 2 / channels,
        samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(at + 8 + i * 2 * channels) / 32768;
      return { rate, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${file}`);
}

/* Word timings from the recording: the loud 10 ms frames are speech, the
   longest pauses fall between phrases, and the words of a phrase share its
   speech by their length. Approximate, as an aligner's would be. */
function align({ rate, samples }) {
  const hop = Math.round(rate / 100);
  const rms = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / hop));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.95)] * 0.08;
  const voiced = rms.map((r) => r > threshold);
  const first = voiced.indexOf(true),
    last = voiced.lastIndexOf(true);

  const gaps = [];
  for (let i = first, start = -1; i <= last; i++) {
    if (!voiced[i] && start < 0) start = i;
    if (voiced[i] && start >= 0) {
      if (i - start >= 8) gaps.push({ start, end: i });
      start = -1;
    }
  }

  const words = SEGMENTS.flatMap((s) => s.text.split(/\s+/).map((text) => ({ text, segment: s.id })));
  const phrases = [];
  let phrase = [];
  for (const w of words) {
    phrase.push(w);
    if (/[.,]$/.test(w.text)) {
      phrases.push(phrase);
      phrase = [];
    }
  }
  if (phrase.length) phrases.push(phrase);

  const cuts = gaps
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, phrases.length - 1)
    .sort((a, b) => a.start - b.start);
  const spans = [];
  let from = first;
  for (const g of cuts) {
    spans.push([from, g.start]);
    from = g.end;
  }
  spans.push([from, last + 1]);
  while (spans.length < phrases.length) spans.push(spans.at(-1));

  const timed = [];
  phrases.forEach((ws, p) => {
    const [a, b] = spans[p];
    const frames = [];
    for (let i = a; i < b; i++) if (voiced[i]) frames.push(i);
    const weights = ws.map((w) => w.text.replace(/[^\p{L}]/gu, "").length + 2);
    const total = weights.reduce((x, y) => x + y, 0);
    let used = 0;
    ws.forEach((w, k) => {
      const i0 = Math.min(frames.length - 1, Math.round((used / total) * frames.length));
      used += weights[k];
      const i1 = Math.min(frames.length - 1, Math.round((used / total) * frames.length) - 1);
      timed.push({
        ...w,
        start_ms: frames[i0] * 10,
        end_ms: Math.max(frames[i0] + 1, frames[Math.max(i0, i1)] + 1) * 10,
      });
    });
  });
  return { words: timed, duration_ms: Math.round((samples.length / rate) * 1000) };
}

const payloadTakes = [];
const attachments = {};
const timings = {};
for (const t of TAKES) {
  const aiff = path.join(tmp, `${t.id}.aiff`),
    wav = path.join(tmp, `${t.id}.wav`),
    dest = path.join(out, t.file);
  run("say", ["-v", t.voice, "-r", String(t.rate), "-o", aiff, SCRIPT]);
  run("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiff, wav]);
  if (t.format === "wav") fs.copyFileSync(wav, dest);
  if (t.format === "mp3") run("lame", ["--silent", "-b", "48", wav, dest]);
  if (t.format === "m4a") run("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", wav, dest]);
  if (t.format === "ogg")
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", "32k", dest]);

  const { words, duration_ms } = align(readWav(wav));
  timings[t.id] = { words, duration_ms };
  const segments = SEGMENTS.map((s) => {
    const ws = words.filter((w) => w.segment === s.id);
    return {
      id: s.id,
      text: s.text,
      start_ms: ws[0].start_ms,
      end_ms: ws.at(-1).end_ms,
      words: ws.map(({ text, start_ms, end_ms }) => ({ text, start_ms, end_ms })),
    };
  });
  payloadTakes.push({
    id: t.id,
    name: t.name,
    file: { $attachment: t.file },
    details: t.details,
    reasoning: t.reasoning,
    transcript: { segments },
  });
  attachments[t.file] = { path: `fieldnotes/${t.file}`, media_type: MEDIA[t.format] };
  console.log(
    `${t.file.padEnd(14)} ${String(fs.statSync(dest).size).padStart(7)} bytes  ${(duration_ms / 1000).toFixed(2)} s`,
  );
}

const payload = {
  notes:
    'Four voices for the **Field Notes** intro, all reading the same script. It has to fit an eight-second slot, and *Linh Nguyen* must be said right ("Linh Win"). Mark what to fix on the waveform or on the words, and cut what should go.',
  script: SCRIPT,
  takes: payloadTakes,
};
const origin = { repo: "fieldnotes/episodes", workflow: "voiceover" };
const title = "Field Notes intro — voice takes";
const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + "\n");

write("fixtures/fieldnotes.json", { title, origin, payload, attachments });

/* The decided round: a comment on a word, one over a phrase, one at a point, and cuts. */
const word = (id, text) => {
  const ws = timings[id].words;
  const i = ws.findIndex((w) => w.text.replace(/[^\p{L}]/gu, "") === text);
  return { i, w: ws[i], ws };
};
const span = (id, from, to) => {
  const a = word(id, from),
    b = word(id, to);
  return {
    start_ms: a.w.start_ms,
    end_ms: b.w.end_ms,
    text: a.ws
      .slice(a.i, b.i + 1)
      .map((w) => w.text)
      .join(" "),
    words: [a.i, b.i],
  };
};
const nguyen = word("daniel", "Nguyen");
const decision = {
  decisions: [
    {
      id: "daniel",
      action: "favorite",
      duration_ms: timings.daniel.duration_ms,
      note: "The one. Fix the name and slow the middle a touch.",
      comments: [
        {
          start_ms: nguyen.w.start_ms,
          end_ms: nguyen.w.end_ms,
          text: nguyen.w.text,
          words: [nguyen.i, nguyen.i],
          segments: ["s2"],
          note: 'Mispronounced: it is "Win", one syllable',
        },
        { ...span("daniel", "walks", "bridge"), segments: ["s2"], note: "Too fast here; give the bridge a beat" },
      ],
      cuts: [
        {
          start_ms: span("daniel", "This", "week").start_ms,
          end_ms: span("daniel", "This", "week").end_ms,
          text: "This week,",
          segments: ["s2"],
        },
      ],
    },
    {
      id: "moira",
      action: "keep",
      duration_ms: timings.moira.duration_ms,
      comments: [
        {
          at_ms: word("moira", "Stay").w.start_ms,
          text: "Stay",
          words: [word("moira", "Stay").i, word("moira", "Stay").i],
          segments: ["s3"],
          note: "Lovely sign-off; keep this reading",
        },
      ],
      cuts: [{ start_ms: word("moira", "week").w.end_ms + 40, end_ms: word("moira", "Linh").w.start_ms - 40 }],
    },
    { id: "karen", action: "drop", duration_ms: timings.karen.duration_ms, note: "Too bright for the show." },
  ],
  undecided: ["samantha"],
};
write("fixtures/fieldnotes.decided.json", {
  title,
  origin,
  payload,
  decision: { decided_by: "maya", decided_at: "2026-09-24T09:30:00Z", data: decision },
  agent_note: "Daniel, with the name fixed; keep Moira's sign-off in mind.",
  attachments,
});
fs.rmSync(tmp, { recursive: true, force: true });
