"""
Cut single-shot gun samples out of longer recordings (used for public/sounds/*.wav).

Usage (needs ffmpeg, numpy, scipy):
    mkdir work && cd work
    ffmpeg -i Vandal.mp3  -ac 1 -ar 48000 vandal.wav
    ffmpeg -i Phantom.mp3 -ac 1 -ar 48000 phantom.wav
    ffmpeg -i Sheriff.mp3 -ac 1 -ar 48000 sheriff.wav
    mkdir out && python3 ../scripts/extract-gun-samples.py   # writes out/<weapon>-<n>.wav

The shot times below are specific to the supplied recordings:
  - Phantom / Sheriff: isolated taps (plus the last shot of each Sheriff string) are cut with their natural tail.
  - Vandal: the recording only contains sprays, so each take is the first shot's attack (until the 2nd shot)
    cross-faded into the spray's release tail.
Each take is trimmed to start <=1 ms before the transient, faded out, DC-filtered and loudness-matched to the
synthesised shot of the same weapon (RMS over the first 250 ms).
"""
import numpy as np, wave, sys
from scipy.signal import butter, sosfilt
def load(f):
    w=wave.open(f); d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768; return d,w.getframerate()
def save(f,y,sr):
    y=np.clip(y,-1,1); w=wave.open(f,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype(np.int16).tobytes()); w.close()
def env_db(x,sr,ms=1):
    win=max(1,int(sr*ms/1000)); return 20*np.log10(np.sqrt(np.convolve(x**2,np.ones(win)/win,'same'))+1e-9)
def refine_onset(x,sr,t):
    """Leading edge of the attack near t: first point that clears both the pre-roll level (+12 dB) and the shot peak (-24 dB)."""
    e=env_db(x,sr,1)
    pre=np.median(e[int((t-0.07)*sr):int((t-0.035)*sr)])
    i0,i1=int((t-0.035)*sr),int((t+0.035)*sr)
    pk=e[i0:i1+int(0.05*sr)].max()
    thr=max(pre+12,pk-24)
    k=np.argmax(e[i0:i1]>thr)
    return (i0+k)/sr
def shape(y,sr,length,fade_out=0.3,peak=0.95,max_lead=None,target_rms=None):
    # trim residual lead-in: start 1 ms before the first sample within 26 dB of the clip's peak
    head=np.abs(y[:int(0.06*sr)]); first=int(np.argmax(head>np.abs(y[:int(0.3*sr)]).max()*0.05))
    y=y[max(0,first-int(0.001*sr)):]
    if max_lead is not None:
        # cap the gap between the faint pre-click and the main report (keeps perceived latency low)
        pk=np.abs(y[:int(0.3*sr)]).max(); body=int(np.argmax(np.abs(y[:int(0.06*sr)])>pk*0.25))
        if body>int(max_lead*sr): y=y[body-int(max_lead*sr):]
    n=int(length*sr); y=y[:n].copy()
    fi=int(0.001*sr); y[:fi]*=np.linspace(0,1,fi)
    fo=int(fade_out*sr); y[-fo:]*=np.cos(np.linspace(0,np.pi/2,fo))**2
    sos=butter(2,30,'hp',fs=sr,output='sos'); y=sosfilt(sos,y)
    y=y*(peak/np.abs(y).max())
    if target_rms is not None:
        # match the synthesised shot's loudness over the first 250 ms (keeps the weapon mix balanced)
        rms=20*np.log10(np.sqrt((y[:int(0.25*sr)]**2).mean()))
        y=y*10**((min(target_rms-rms,0))/20)
    return y
PRE=0.002
out={}; onsets={}
x,sr=load('phantom.wav'); out['phantom']=[]
for t in [1.118,2.398,3.806]:
    o=refine_onset(x,sr,t); s=int((o-PRE)*sr); onsets.setdefault('phantom',[]).append(round(o,4))
    out['phantom'].append(shape(x[s:],sr,0.75,0.3,0.85,target_rms=-19.0))
x,sr=load('sheriff.wav'); out['sheriff']=[]
for t in [1.386,3.242,6.376,9.952]:
    o=refine_onset(x,sr,t); s=int((o-PRE)*sr); onsets.setdefault('sheriff',[]).append(round(o,4))
    out['sheriff'].append(shape(x[s:],sr,1.0,0.35,0.95,max_lead=0.006,target_rms=-12.7))
x,sr=load('vandal.wav'); e=env_db(x,sr,2)
def drop_time(a,b):
    i0,i1=int(a*sr),int(b*sr); lvl=np.median(e[i0:i1]); seg=e[i0:i1+int(0.3*sr)]
    return (i0+np.where(seg>lvl-6)[0][-1])/sr
atk=[];tails=[]
for a,b in [(0.326,0.90),(2.172,4.80)]:
    o=refine_onset(x,sr,a); dr=drop_time(o+0.05,b-0.05); onsets.setdefault('vandal',[]).append((round(o,4),round(dr,4)))
    s=int((o-PRE)*sr); atk.append(x[s:s+int((PRE+0.105+0.025)*sr)])
    ts=int((dr-0.030)*sr); tails.append(x[ts:ts+int(1.0*sr)])
xf=int(0.025*sr); body=int((PRE+0.105)*sr)
out['vandal']=[]
for ai,ti in [(0,0),(1,1),(0,1),(1,0)]:
    A,B=atk[ai],tails[ti]; w=np.linspace(0,1,xf)
    y=np.concatenate([A[:body], A[body:body+xf]*np.cos(w*np.pi/2)+B[:xf]*np.sin(w*np.pi/2), B[xf:]])
    out['vandal'].append(shape(y,sr,1.0,0.35,0.95,target_rms=-14.5))
for k,v in out.items():
    for i,y in enumerate(v): save(f'out/{k}-{i+1}.wav',y,sr)
print(onsets)
