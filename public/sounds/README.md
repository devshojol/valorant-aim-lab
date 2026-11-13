# Recorded sounds

Every sound is synthesised in the browser by default (gunshots in `src/game/audio/gunSynth.ts`, everything else in
`src/game/audio/AudioEngine.ts`). A key in `manifest.json` with one or more files replaces the synthesised sound for
that slot. An empty list keeps the synthesised one.

## Slots

| Key | Plays when | Synthesised fallback |
| --- | --- | --- |
| `vandal`, `phantom`, `spectre`, `guardian`, `operator`, `classic`, `ghost`, `sheriff` | that gun fires | layered shot per weapon |
| `footstep` | the player or a bot takes a step | four short scuffs |
| `jump` | you jump | shoe push-off with a clothes-and-gear rustle |
| `land` | you land (louder after a bigger drop) | low thud with a scuff |
| `reload` | any gun reloads (replaces the three mag-out / mag-in / bolt cues) | three mechanical clicks |
| `reload-vandal`, `reload-phantom`, `reload-spectre`, `reload-guardian`, `reload-operator`, `reload-classic`, `reload-ghost`, `reload-sheriff` | that gun reloads (wins over `reload`) | as above |
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
  with `scripts/extract-gun-samples.py`. The owner also added `footstep.mp3`, `reload.wav` and `kill-1.mp3` …
  `kill-5.mp3`. The jump, landing and headshot slots have no recording, so they stay synthesised.
- The Classic, Ghost, Spectre, Guardian and Operator takes were cut from recordings supplied by the project owner
  with `scripts/extract-gun-samples-2.py` (isolated shots with their natural tail; the Spectre takes are the last
  shot of each burst). They replace the earlier stand-ins from the CC0 Free Firearm Sound Library
  (`scripts/extract-firearm-library.py`).
- WAV, MP3 or OGG all work. When a slot lists several files, one is picked at random each time (footsteps and shots
  also get a small pitch variation), so repeats don't sound looped.
- Silence at the start and end of every file is trimmed when it loads, so sounds play on time. The engine adds
  distance filtering, HRTF panning and reverb for sounds made by enemies.
- A `footstep` file longer than 0.8 s is treated as a walking recording and cut into single steps when it loads
  (one is picked at random per step). Each walker only ever plays one step at a time.
- A reload file is cut in two at the pause between its two loudest sounds (magazine out, magazine in) and each half
  is played when the reload animation reaches that moment, whatever the gun's reload time. A file with no such pause
  is played whole when the reload starts. Either way it stops if the reload is cut short (weapon switch).
- Only one kill sound plays at a time: a quick second kill cuts the first. When the kill sound is a recording, the
  synthesised headshot ping is skipped on that kill so the two don't clash (record a `headshot` file to keep one).
- Only ship recordings you have the rights to. The single-file build (`npm run build:single`) never includes these files.
