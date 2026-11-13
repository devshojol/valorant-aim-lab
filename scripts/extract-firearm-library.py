"""
Cut single gunshots for the Classic, Ghost, Spectre, Guardian and Operator out of the Free Firearm
Sound Library (CC0, https://opengameart.org/content/the-free-firearm-sound-library) and write them to
public/sounds/<weapon>-<n>.wav (48 kHz, mono, 16-bit), the format the game's sound slots use.

Usage (needs ffmpeg; Python standard library only):
    python3 scripts/extract-firearm-library.py "<path to>/Prepared SFX Library" public/sounds

Each source file holds a few separate shots recorded close to the shooter. Every shot is cut from just
before its attack, faded out and high-passed at 35 Hz. Raw recordings are a very short spike with a quiet
tail, so each take is then raised to a target loudness (RMS over its first 250 ms, chosen to sit beside
the Vandal, Phantom and Sheriff samples) and its spike soft-clipped down to a peak. The library has no suppressed
guns, so the Ghost and Spectre use a .22 pistol and a 9 mm submachine gun with the muzzle crack
filtered down (low-pass plus a shorter tail), which is what a suppressor does to the sound.
"""
import re
import subprocess
import sys
from pathlib import Path

# weapon -> (source file, clip seconds, fade-out seconds, peak dBFS, loudness dB RMS over 250 ms before clipping, extra ffmpeg filters)
# The spike above full scale is soft-clipped (tanh), the way gun sounds are usually driven, then scaled to the peak.
SOURCES = {
    'classic': ('Walther PPQ/X_39P.wav', 0.9, 0.45, -2.5, -15.0, ''),
    'ghost': ('Ruger Mark III/R_35P.wav', 0.5, 0.3, -6.0, -17.0, 'lowpass=f=2400,lowpass=f=3200,'),
    'spectre': ('Carl Gustav M45/G_31P.wav', 0.42, 0.26, -6.0, -17.0, 'lowpass=f=2800,lowpass=f=3600,'),
    'guardian': ('SKS/U_14P.wav', 1.2, 0.6, -2.0, -12.5, ''),
    'operator': ('Tikka/W_29P.wav', 1.7, 0.8, -1.0, -10.5, 'bass=g=3:f=110,'),
}
MAX_TAKES = 4
LEAD = 0.004  # seconds kept before the detected attack


def run(args):
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats', *args], capture_output=True, text=True).stderr


def onsets(path):
    """Start time of each shot: where the level first rises above -32 dB after a quiet stretch."""
    log = run(['-i', str(path), '-ac', '1', '-af', 'silencedetect=noise=-32dB:d=0.25', '-f', 'null', '-'])
    ends = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', log)]
    total = float(re.search(r'Duration: (\d+):(\d+):([0-9.]+)', log).group(3))
    return [t for t in ends if t < total - 0.3]


def main():
    lib, out = Path(sys.argv[1]), Path(sys.argv[2])
    for weapon, (rel, length, fade, peak, loud, extra) in SOURCES.items():
        src = lib / rel
        for n, t in enumerate(onsets(src)[:MAX_TAKES], 1):
            chain = (
                f'aformat=channel_layouts=mono,aresample=48000,atrim=start={max(0, t - LEAD):.4f}:duration={length},asetpts=PTS-STARTPTS,'
                f'highpass=f=35,{extra}afade=t=in:d=0.001,afade=t=out:st={length - fade:.3f}:d={fade}:curve=qsin'
            )
            # first pass: loudness of the first 250 ms after filtering; second pass: gain to the target, then soft-clip
            log = run(['-i', str(src), '-af', chain + ',atrim=duration=0.25,volumedetect', '-f', 'null', '-'])
            gain = loud - float(re.search(r'mean_volume: (-?[0-9.]+) dB', log).group(1))
            dst = out / f'{weapon}-{n}.wav'
            run(['-y', '-i', str(src), '-af', f'{chain},volume={gain:.2f}dB,asoftclip=type=tanh,volume={peak}dB', '-c:a', 'pcm_s16le', str(dst)])
            print(f'{dst.name}: shot at {t:.3f}s, gain {gain:+.1f} dB')


if __name__ == '__main__':
    main()
