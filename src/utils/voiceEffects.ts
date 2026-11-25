import type { VoiceEffectType } from '../types/app';

export const VOICE_EFFECTS: { id: VoiceEffectType; label: string; desc: string }[] = [
  { id: 'normal', label: 'Original', desc: 'Voz natural limpa' },
  { id: 'deep', label: 'Grave', desc: 'Tom profundo e encorpado' },
  { id: 'chipmunk', label: 'Agudo', desc: 'Voz acelerada e aguda' },
  { id: 'robot', label: 'Robô', desc: 'Modulação metálica sintética' },
  { id: 'space', label: 'Espacial', desc: 'Eco ambiente com reverberação' },
  { id: 'radio', label: 'Rádio', desc: 'Filtro analógico vintage' },
];

/**
 * Extracts normalized amplitude bars (0..1) from an AudioBuffer or fallback array.
 */
export async function computeWaveformFromDataUrl(
  dataUrl: string,
  bars = 28
): Promise<number[]> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return defaultWaveform(bars);

    const res = await fetch(dataUrl);
    const arrayBuffer = await res.arrayBuffer();
    const ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channelData.length / bars));
    const result: number[] = [];

    for (let i = 0; i < bars; i++) {
      let sum = 0;
      const start = i * step;
      for (let j = 0; j < step && start + j < channelData.length; j++) {
        sum += Math.abs(channelData[start + j]);
      }
      const avg = sum / step;
      result.push(Math.min(1, Math.max(0.14, avg * 3.8)));
    }
    await ctx.close();
    return result;
  } catch {
    return defaultWaveform(bars);
  }
}

export function defaultWaveform(bars = 28): number[] {
  return Array.from({ length: bars }, (_, idx) => {
    const wave = Math.sin(idx * 0.6) * 0.35 + Math.cos(idx * 1.1) * 0.25 + 0.45;
    return Number(Math.min(0.95, Math.max(0.18, wave)).toFixed(2));
  });
}

/**
 * Plays an audio dataUrl through Web Audio API applying the chosen voice effect in real time.
 * Returns a stop() handle and calls onEnded when playback finishes.
 */
export async function playAudioWithVoiceEffect(
  dataUrl: string,
  effect: VoiceEffectType,
  playbackSpeed: number,
  onEnded?: () => void
): Promise<{ stop: () => void; duration: number }> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    const audio = new Audio(dataUrl);
    audio.playbackRate = playbackSpeed;
    audio.onended = () => onEnded?.();
    await audio.play();
    return {
      stop: () => {
        audio.pause();
        audio.currentTime = 0;
      },
      duration: audio.duration || 0,
    };
  }

  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  const ctx = new AudioCtx();
  const decoded = await ctx.decodeAudioData(buf);

  const source = ctx.createBufferSource();
  source.buffer = decoded;

  // Apply pitch/rate adjustments
  let rate = playbackSpeed;
  if (effect === 'deep') rate *= 0.78;
  if (effect === 'chipmunk') rate *= 1.38;
  source.playbackRate.value = rate;

  let tailNode: AudioNode = source;

  if (effect === 'deep') {
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 320;
    lowShelf.gain.value = 10;
    tailNode.connect(lowShelf);
    tailNode = lowShelf;
  } else if (effect === 'chipmunk') {
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 1800;
    highShelf.gain.value = 7;
    tailNode.connect(highShelf);
    tailNode = highShelf;
  } else if (effect === 'robot') {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const modGain = ctx.createGain();
    modGain.gain.value = 0.65;
    const ringGain = ctx.createGain();
    ringGain.gain.value = 0.5;
    osc.connect(modGain);
    modGain.connect(ringGain.gain);
    tailNode.connect(ringGain);
    osc.start();
    source.onended = () => {
      try {
        osc.stop();
      } catch {
        // ignore
      }
      ctx.close().catch(() => {});
      onEnded?.();
    };
    ringGain.connect(ctx.destination);
    source.start(0);
    return {
      stop: () => {
        try {
          source.stop();
          osc.stop();
        } catch {
          // ignore
        }
        ctx.close().catch(() => {});
      },
      duration: decoded.duration / rate,
    };
  } else if (effect === 'space') {
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.22;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;

    tailNode.connect(dry);
    tailNode.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(ctx.destination);
    wet.connect(ctx.destination);

    source.onended = () => {
      setTimeout(() => ctx.close().catch(() => {}), 350);
      onEnded?.();
    };
    source.start(0);
    return {
      stop: () => {
        try {
          source.stop();
        } catch {
          // ignore
        }
        ctx.close().catch(() => {});
      },
      duration: decoded.duration / rate,
    };
  } else if (effect === 'radio') {
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1400;
    bandpass.Q.value = 2.4;
    tailNode.connect(bandpass);
    tailNode = bandpass;
  }

  tailNode.connect(ctx.destination);
  source.onended = () => {
    ctx.close().catch(() => {});
    onEnded?.();
  };
  source.start(0);

  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // ignore
      }
      ctx.close().catch(() => {});
    },
    duration: decoded.duration / rate,
  };
}

/**
 * Generates a subtle Apple-inspired UI sound chime using Web Audio API.
 */
export function playUiChime(kind: 'send' | 'receive' | 'call'): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (kind === 'send') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (kind === 'receive') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.setValueAtTime(980, now + 0.07);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.15);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.36);
    }

    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // ignore audio autoplay restrictions
  }
}

/**
 * Applies a real-time Web Audio voice effect to an outgoing microphone MediaStream
 * for live WebRTC calls, returning a processed MediaStream and a cleanup function.
 */
export function createLiveVoiceEffectStream(
  rawStream: MediaStream,
  effect: VoiceEffectType
): { processedStream: MediaStream; cleanup: () => void } {
  if (effect === 'normal' || rawStream.getAudioTracks().length === 0) {
    return {
      processedStream: rawStream,
      cleanup: () => {},
    };
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return { processedStream: rawStream, cleanup: () => {} };
    }

    const ctx = new AudioCtx();
    const audioOnlyStream = new MediaStream(rawStream.getAudioTracks());
    const source = ctx.createMediaStreamSource(audioOnlyStream);
    const dest = ctx.createMediaStreamDestination();
    let oscToStop: OscillatorNode | null = null;

    if (effect === 'deep') {
      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 300;
      lowShelf.gain.value = 14;
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 1400;
      source.connect(lowShelf);
      lowShelf.connect(lowPass);
      lowPass.connect(dest);
    } else if (effect === 'chipmunk') {
      const highShelf = ctx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 1400;
      highShelf.gain.value = 12;
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 420;
      source.connect(highPass);
      highPass.connect(highShelf);
      highShelf.connect(dest);
    } else if (effect === 'robot') {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const modGain = ctx.createGain();
      modGain.gain.value = 0.65;
      const ringGain = ctx.createGain();
      ringGain.gain.value = 0.55;
      osc.connect(modGain);
      modGain.connect(ringGain.gain);
      source.connect(ringGain);
      ringGain.connect(dest);
      osc.start();
      oscToStop = osc;
    } else if (effect === 'space') {
      const dry = ctx.createGain();
      dry.gain.value = 0.85;
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.2;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.38;
      const wet = ctx.createGain();
      wet.gain.value = 0.48;
      source.connect(dry);
      source.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      dry.connect(dest);
      wet.connect(dest);
    } else {
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 1450;
      bandpass.Q.value = 2.6;
      source.connect(bandpass);
      bandpass.connect(dest);
    }

    const combined = new MediaStream([
      ...dest.stream.getAudioTracks(),
      ...rawStream.getVideoTracks(),
    ]);

    return {
      processedStream: combined,
      cleanup: () => {
        try {
          oscToStop?.stop();
        } catch {
          // ignore
        }
        ctx.close().catch(() => {});
      },
    };
  } catch {
    return { processedStream: rawStream, cleanup: () => {} };
  }
}

