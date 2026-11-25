import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  Wand2,
} from 'lucide-react';
import type { PeerNode, UserProfile, VoiceEffectType } from '../types/app';
import { Avatar } from './Avatar';
import { VOICE_EFFECTS, createLiveVoiceEffectStream } from '../utils/voiceEffects';

interface CallOverlayProps {
  mode: 'audio' | 'video';
  groupName: string;
  currentUser: UserProfile;
  peers: PeerNode[];
  remoteStreams: Record<string, MediaStream>;
  onClose: () => void;
  onAttachStream: (stream: MediaStream | null) => Promise<void>;
}

const RemoteVideoTile: React.FC<{
  stream?: MediaStream;
  name: string;
  avatarUrl: string;
  isVideoCall: boolean;
}> = ({ stream, name, avatarUrl, isVideoCall }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {});
    }
  }, [stream]);

  const hasVideoTrack = Boolean(stream && stream.getVideoTracks().some((t) => t.enabled));

  return (
    <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center min-h-[200px] sm:min-h-[260px]">
      {/* Always bind remote audio track so voice travels user-to-user even when camera is off or in audio-only calls */}
      {stream && (!hasVideoTrack || !isVideoCall) && (
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      )}
      {stream && hasVideoTrack && isVideoCall ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <Avatar src={avatarUrl} name={name} size="xl" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">{name}</p>
            <p className="text-xs text-zinc-400">
              {stream ? 'Voz conectada em tempo real' : 'Conectado na sala de chamada'}
            </p>
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs font-medium text-white">
        {name}
      </div>
    </div>
  );
};

export const CallOverlay: React.FC<CallOverlayProps> = ({
  mode,
  groupName,
  currentUser,
  peers,
  remoteStreams,
  onClose,
  onAttachStream,
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const effectCleanupRef = useRef<() => void>(() => {});
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(mode === 'audio');
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [voiceEffect, setVoiceEffect] = useState<VoiceEffectType>('normal');
  const [showEffectsMenu, setShowEffectsMenu] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const applyAndAttachVoiceEffect = async (baseStream: MediaStream, effect: VoiceEffectType) => {
    effectCleanupRef.current();
    const { processedStream, cleanup } = createLiveVoiceEffectStream(baseStream, effect);
    effectCleanupRef.current = cleanup;
    processedStream.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
    localStreamRef.current = processedStream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = processedStream;
    }
    await onAttachStream(processedStream);
  };

  useEffect(() => {
    let cancelled = false;
    async function initMedia() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setMediaNotice('Câmera/microfone indisponíveis neste navegador. Modo de chamada silenciosa ativo.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: mode === 'video',
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        rawStreamRef.current = stream;
        await applyAndAttachVoiceEffect(stream, voiceEffect);
      } catch {
        setMediaNotice(
          'Permissão de câmera/microfone não concedida ou hardware ausente. Você continua conectado para ouvir outros participantes.'
        );
      }
    }
    initMedia();

    return () => {
      cancelled = true;
      effectCleanupRef.current();
      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((t) => t.stop());
        rawStreamRef.current = null;
      }
      localStreamRef.current = null;
      onAttachStream(null).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!rawStreamRef.current) return;
    applyAndAttachVoiceEffect(rawStreamRef.current, voiceEffect).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceEffect]);

  const toggleMic = () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    rawStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
  };

  const toggleCam = async () => {
    const nextOff = !camOff;
    setCamOff(nextOff);
    if (!nextOff && rawStreamRef.current && rawStreamRef.current.getVideoTracks().length === 0) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = videoStream.getVideoTracks()[0];
        if (track && rawStreamRef.current) {
          rawStreamRef.current.addTrack(track);
          await applyAndAttachVoiceEffect(rawStreamRef.current, voiceEffect);
        }
      } catch {
        setCamOff(true);
        setMediaNotice('Nenhuma câmera detectada neste dispositivo.');
      }
      return;
    }
    rawStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !nextOff;
    });
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !nextOff;
    });
  };

  const toggleScreenShare = async () => {
    if (screenSharing) {
      setScreenSharing(false);
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;
      setScreenSharing(true);
      setCamOff(false);
      const combined = new MediaStream([
        ...(rawStreamRef.current?.getAudioTracks() ?? []),
        screenTrack,
      ]);
      rawStreamRef.current = combined;
      await applyAndAttachVoiceEffect(combined, voiceEffect);
      screenTrack.onended = () => setScreenSharing(false);
    } catch {
      setMediaNotice('Compartilhamento de tela cancelado ou indisponível.');
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const remotePeers = peers.filter((p) => p.userId !== currentUser.id);

  return (
    <div
      role="dialog"
      aria-label="Chamada em tempo real"
      className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-xl text-white flex flex-col justify-between p-4 sm:p-6"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{groupName}</h2>
          <p className="text-xs text-zinc-400 font-mono">
            {mode === 'video' ? 'Chamada de Vídeo' : 'Chamada de Voz'} · {formatDuration(elapsedSec)} · {peers.length} conectado(s)
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowEffectsMenu((v) => !v)}
            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Wand2 className="w-4 h-4 text-blue-400" />
            <span>Voz: {VOICE_EFFECTS.find((e) => e.id === voiceEffect)?.label}</span>
          </button>
          {showEffectsMenu && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-zinc-900 border border-zinc-800 p-2 shadow-2xl z-20">
              {VOICE_EFFECTS.map((ef) => (
                <button
                  key={ef.id}
                  type="button"
                  onClick={() => {
                    setVoiceEffect(ef.id);
                    setShowEffectsMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between ${
                    voiceEffect === ef.id
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  <span className="font-medium">{ef.label}</span>
                  <span className="text-[11px] opacity-75">{ef.desc.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {mediaNotice && (
        <div className="mx-auto max-w-xl px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 text-center">
          {mediaNotice}
        </div>
      )}

      {/* Video / Participant Grid */}
      <div className="flex-1 my-4 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl w-full mx-auto items-stretch">
        {/* Local tile */}
        <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center min-h-[200px] sm:min-h-[260px]">
          {!camOff && localStreamRef.current && localStreamRef.current.getVideoTracks().length > 0 ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 p-6">
              <Avatar src={currentUser.avatarUrl} name={currentUser.name} size="xl" />
              <div className="text-center">
                <p className="text-sm font-semibold">{currentUser.name} (Você)</p>
                <p className="text-xs text-zinc-400">
                  {micMuted ? 'Microfone silenciado' : 'Microfone ativo'}
                </p>
              </div>
            </div>
          )}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs font-medium">
            Você {screenSharing ? '· Compartilhando tela' : ''}
          </div>
        </div>

        {/* Remote participants */}
        {remotePeers.length > 0 ? (
          remotePeers.map((peer) => (
            <RemoteVideoTile
              key={peer.peerId}
              stream={remoteStreams[peer.peerId]}
              name={peer.name}
              avatarUrl={peer.avatarUrl}
              isVideoCall={mode === 'video'}
            />
          ))
        ) : (
          <div className="rounded-2xl bg-zinc-900/60 border border-dashed border-zinc-800 flex flex-col items-center justify-center p-6 text-center min-h-[200px] sm:min-h-[260px]">
            <Volume2 className="w-8 h-8 text-zinc-500 mb-3" />
            <p className="text-sm font-medium text-zinc-200">Aguardando outros dispositivos na chamada</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs">
              Outros participantes do grupo com o código de acesso podem entrar na chamada a qualquer momento.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="flex items-center justify-center gap-3 sm:gap-4 pb-safe">
        <button
          type="button"
          onClick={toggleMic}
          aria-label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            micMuted ? 'bg-white text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
          }`}
        >
          {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={toggleCam}
          aria-label={camOff ? 'Ligar câmera' : 'Desligar câmera'}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            camOff ? 'bg-white text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
          }`}
        >
          {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={toggleScreenShare}
          aria-label="Compartilhar tela"
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            screenSharing ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
          }`}
        >
          <MonitorUp className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Encerrar chamada"
          className="px-6 h-12 sm:h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer"
        >
          <PhoneOff className="w-5 h-5" />
          <span>Encerrar</span>
        </button>
      </div>
    </div>
  );
};
