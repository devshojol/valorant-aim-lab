# Recorded sounds

Every sound is synthesised in the browser by default (gunshots in `src/game/audio/gunSynth.ts`, everything else in
`src/game/audio/AudioEngine.ts`). A key in `manifest.json` with one or more files replaces the synthesised sound for
that slot. An empty list keeps the synthesised one.

## Slots

| Key | Plays when | Synthesised fallback |
| --- | --- | --- |
| `vandal`, `phantom`, `classic`, `sheriff` | that gun fires | layered shot per weapon |
| `footstep` | the player or a bot takes a step | four short scuffs |
| `jump` | you jump | shoe push-off with a clothes-and-gear rustle |
| `land` | you land (louder after a bigger drop) | low thud with a scuff |
| `reload` | any reload starts (replaces the three mag-out / mag-in / bolt cues) | three mechanical clicks |
| `reload-vandal`, `reload-phantom`, `reload-classic`, `reload-sheriff` | that gun reloads (wins over `reload`) | as above |
| `headshot` | your shot hits a head | bright ringing ping |
| `kill1` … `kill5` | your 1st … 5th kill in a row (the 5th repeats after that; dying resets the streak) | rising chime, one note per kill |
| `vandal-kill1` … `sheriff-kill5` | the same, but only for kills with that gun (wins over `kill1` … `kill5`) | as above |

Example:

```json
{
  "vandal": ["vandal-1.wav", "vandal-2.wav"],
  "footstep": ["step-1.wav", "step-2.wav", "step-3.wav"],
  "reload-vandal": ["vandal-reload.wav"],
  "kill1": ["kill-1.wav"],
  "kill2": ["kill-2.wav"]
}
```

## Notes

- The current Vandal, Phantom and Sheriff takes were cut from recordings supplied by the project owner
  with `scripts/extract-gun-samples.py`. The Classic has no recording, so it keeps the synthesised shot.
- WAV, MP3 or OGG all work. When a slot lists several files, one is picked at random each time (footsteps and shots
  also get a small pitch variation), so repeats don't sound looped.
- Silence at the start and end of every file is trimmed when it loads, so sounds play on time. The engine adds
  distance filtering, HRTF panning and reverb for sounds made by enemies.
- A `footstep` file longer than 0.8 s is treated as a walking recording and cut into single steps when it loads
  (one is picked at random per step). Each walker only ever plays one step at a time.
- A reload file should cover the whole reload; it is played once when the reload starts and stops if the reload is
  cut short (weapon switch).
- Only one kill sound plays at a time: a quick second kill cuts the first. When the kill sound is a recording, the
  synthesised headshot ping is skipped on that kill so the two don't clash (record a `headshot` file to keep one).
- Only ship recordings you have the rights to. The single-file build (`npm run build:single`) never includes these files.
