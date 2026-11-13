"""
Cut single-shot Classic, Ghost, Spectre, Guardian and Operator samples out of the owner-supplied recordings
(companion to extract-gun-samples.py, which does Vandal / Phantom / Sheriff).

Usage (needs ffmpeg, numpy, scipy):
    mkdir work && cd work
    ffmpeg -i "Voicy_Valorant Weapon Classic SingleShots .mp3" -ac 1 -ar 48000 classic.wav
    ffmpeg -i "Valorant Weapon Ghost.mp3"                       -ac 1 -ar 48000 ghost.wav
    ffmpeg -i "Voicy_Valorant Weapon Spectre .mp3"              -ac 1 -ar 48000 spectre.wav
    ffmpeg -i "Voicy_Valorant Weapon Guardian .mp3"             -ac 1 -ar 48000 guardian.wav
    ffmpeg -i "valorant-operator.mp3"                           -ac 1 -ar 48000 operator.wav
    mkdir out && python3 ../scripts/extract-gun-samples-2.py   # writes out/<weapon>-<n>.wav

The shot times below are specific to those recordings. Only shots with a clean tail are used:
  - Classic / Ghost / Operator: isolated taps, cut with their natural tail up to the next shot.
  - Guardian: only the shots at 2.57 s and 3.60 s are isolated (4.66 s is followed by a 2nd shot 0.19 s later and
    5.93-7.93 s is a rapid string), so the third take is the last shot of that string.
  - Spectre: the recording is all bursts, so each take is the last shot of a burst (its tail is clean).
  - Operator: only the five shots before 13.5 s are gun shots (the rest of the file is something else).
Each take starts <=1 ms before the transient, is faded out, DC-filtered and loudness-matched (RMS over the first
250 ms) so the weapons stay balanced against the Vandal / Phantom / Sheriff takes.
"""
import numpy as np, wave
from scipy.signal import butter, sosfilt


def load(f):
    w = wave.open(f)
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768, w.getframerate()


def save(f, y, sr):
    y = np.clip(y, -1, 1)
    w = wave.open(f, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((y * 32767).astype(np.int16).tobytes()); w.close()


def env_db(x, sr, ms=1):
    win = max(1, int(sr * ms / 1000))
    return 20 * np.log10(np.sqrt(np.convolve(x ** 2, np.ones(win) / win, 'same')) + 1e-9)


def refine_onset(x, sr, t, back=0.035):
    """Leading edge of the attack near t: first point that clears both the pre-roll level (+12 dB) and the peak (-24 dB).
    `back` is how far before t to search; keep it short for bursts so the previous shot isn't picked up."""
    e = env_db(x, sr, 1)
    pre = np.median(e[int((t - back - 0.035) * sr):int((t - back) * sr)])
    i0, i1 = int((t - back) * sr), int((t + 0.035) * sr)
    pk = e[i0:i1 + int(0.05 * sr)].max()
    thr = max(pre + 12, pk - 24)
    if back < 0.035:
        # short look-back = shot inside a burst: the previous shot's tail would otherwise push the threshold up the attack
        thr = min(thr, pk - 12)
    k = np.argmax(e[i0:i1] > thr)
    return (i0 + k) / sr


def shape(y, sr, length, fade_out, target_rms):
    head = np.abs(y[:int(0.06 * sr)])
    first = int(np.argmax(head > np.abs(y[:int(0.3 * sr)]).max() * 0.05))
    y = y[max(0, first - int(0.001 * sr)):]
    y = y[:int(length * sr)].copy()
    fi = int(0.001 * sr); y[:fi] *= np.linspace(0, 1, fi)
    fo = int(fade_out * sr); y[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    y = sosfilt(butter(2, 30, 'hp', fs=sr, output='sos'), y)
    y = y * (0.95 / np.abs(y).max())
    rms = 20 * np.log10(np.sqrt((y[:int(0.25 * sr)] ** 2).mean()))
    return y * 10 ** (min(target_rms - rms, 0) / 20)


PRE = 0.002
# weapon: (approx shot times in s, take length s, fade-out s, target RMS dB over first 250 ms, onset look-back s)
TAKES = {
    'classic':  ([1.806, 2.584, 5.412],                0.55, 0.25, -19.0, 0.035),
    'ghost':    ([0.854, 1.708, 2.690, 3.640],         0.45, 0.20, -21.0, 0.035),
    'spectre':  ([1.858, 3.384, 5.568, 10.344],        0.32, 0.15, -20.0, 0.012),
    'guardian': ([2.571, 3.595, 7.926],                0.95, 0.35, -16.5, 0.012),
    'operator': ([1.192, 4.744, 6.986],                1.60, 0.50, -13.0, 0.035),
}

onsets = {}
for name, (times, length, fade, rms, back) in TAKES.items():
    x, sr = load(f'{name}.wav')
    for i, t in enumerate(times):
        o = refine_onset(x, sr, t, back)
        onsets.setdefault(name, []).append(round(o, 4))
        save(f'out/{name}-{i + 1}.wav', shape(x[int((o - PRE) * sr):], sr, length, fade, rms), sr)
print(onsets)
