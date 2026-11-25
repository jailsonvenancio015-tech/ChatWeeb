import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  BarChart3,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  CornerUpLeft,
  Download,
  Eraser,
  Eye,
  FileText,
  Image as ImageIcon,
  Lock,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  Minimize2,
  Paintbrush,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  SmilePlus,
  Square,
  Sticker,
  Trash2,
  Users,
  Video,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import type {
  BubbleEffect,
  ChatAttachment,
  ChatMessage,
  ContactPreference,
  GroupConfig,
  PeerNode,
  QuickReplySnippet,
  ScreenEffect,
  StickerItem,
  TapbackEmoji,
  TextStyleType,
  UnreadRoomInfo,
  UserProfile,
  VoiceEffectType,
} from '../types/app';
import { Avatar } from './Avatar';
import { MentionText } from './MentionText';
import { SketchPadModal } from './SketchPadModal';
import { StickerMakerModal } from './StickerMakerModal';
import { isMessageActive, isUserBlocked } from '../utils/meshProtocol';
import {
  VOICE_EFFECTS,
  computeWaveformFromDataUrl,
  defaultWaveform,
  playAudioWithVoiceEffect,
} from '../utils/voiceEffects';

const TAPBACK_OPTIONS: TapbackEmoji[] = ['❤️', '👍', '👎', '😂', '‼️', '❓'];

const ACCENT_BUBBLE_CLASSES: Record<GroupConfig['accentColor'], string> = {
  blue: 'bg-blue-600 text-white',
  emerald: 'bg-emerald-600 text-white',
  indigo: 'bg-indigo-600 text-white',
  rose: 'bg-rose-600 text-white',
  amber: 'bg-amber-600 text-white',
  zinc: 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950',
};

const WALLPAPER_CLASSES: Record<GroupConfig['wallpaper'], string> = {
  minimal: 'bg-zinc-50 dark:bg-zinc-950',
  gradient:
    'bg-gradient-to-b from-zinc-50 via-blue-50/40 to-zinc-100 dark:from-zinc-950 dark:via-slate-950 dark:to-zinc-900',
  grid:
    'bg-zinc-50 dark:bg-zinc-950 [background-image:radial-gradient(rgba(120,120,140,0.16)_1px,transparent_1px)] [background-size:20px_20px]',
  midnight:
    'bg-gradient-to-br from-slate-100 via-indigo-50/50 to-slate-100 dark:from-[#070b14] dark:via-[#0c1222] dark:to-[#090d16]',
  warm:
    'bg-gradient-to-b from-stone-50 to-amber-50/30 dark:from-zinc-950 dark:to-stone-950',
};

const SELF_DESTRUCT_OPTIONS: { label: string; sec: number }[] = [
  { label: 'Off', sec: 0 },
  { label: '15s', sec: 15 },
  { label: '1m', sec: 60 },
  { label: '5m', sec: 300 },
];

interface ChatViewProps {
  group: GroupConfig;
  currentUser: UserProfile;
  profiles: Record<string, UserProfile>;
  messages: ChatMessage[];
  peers: PeerNode[];
  typingUsers: Record<string, string>;
  quickReplies: QuickReplySnippet[];
  stickers: StickerItem[];
  unreadTotalCount?: number;
  unreadByRoom?: Record<string, UnreadRoomInfo>;
  isFullscreen?: boolean;
  compactMessages: boolean;
  autoRevealInvisibleInk: boolean;
  isCurrentUserAdmin: boolean;
  blockedUserIds: string[];
  removedContactIds?: string[];
  mutedRoomCodes: string[];
  contactPrefs: Record<string, ContactPreference>;
  canDeleteRoom: boolean;
  onSendMessage: (payload: {
    text: string;
    textStyle: TextStyleType;
    bubbleEffect: BubbleEffect;
    screenEffect: ScreenEffect;
    attachments: ChatAttachment[];
    replyTo?: ChatMessage['replyTo'];
    poll?: ChatMessage['poll'];
    selfDestructSec?: number;
  }) => void;
  onCreateSticker: (sticker: StickerItem) => void;
  onOpenStickerSettings: () => void;
  onToggleFullscreen?: () => void;
  onEditMessage: (messageId: string, newText: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: TapbackEmoji) => void;
  onTogglePin: (messageId: string) => void;
  onVotePoll: (messageId: string, optionId: string) => void;
  onTypingChange: (isTyping: boolean) => void;
  onStartCall: (mode: 'audio' | 'video') => void;
  onOpenGroupAdmin: () => void;
  onOpenConversationsModal: () => void;
  onStartPrivateChat: (userId: string) => void;
  onClearConversation: (roomCode: string) => void;
  onDeleteConversation: (roomCode: string) => void;
  onLeaveGroup: (roomCode: string) => void;
  onRemoveContact: (userId: string) => void;
  onToggleMuteRoom: (roomCode: string) => void;
  onToggleBlockUser: (userId: string) => void;
  onUpdateContactPref: (userId: string, pref: ContactPreference) => void;
  onOpenProfile: (userId: string) => void;
}

const AudioAttachmentPlayer: React.FC<{
  attachment: ChatAttachment;
  isOwn: boolean;
}> = ({ attachment, isOwn }) => {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const stopHandleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopHandleRef.current?.();
    };
  }, []);

  const togglePlay = async () => {
    if (playing) {
      stopHandleRef.current?.();
      stopHandleRef.current = null;
      setPlaying(false);
      return;
    }

    setPlaying(true);
    try {
      const handle = await playAudioWithVoiceEffect(
        attachment.dataUrl,
        attachment.voiceEffect ?? 'normal',
        speed,
        () => {
          setPlaying(false);
          stopHandleRef.current = null;
        }
      );
      stopHandleRef.current = handle.stop;
    } catch {
      setPlaying(false);
    }
  };

  const bars = attachment.waveform && attachment.waveform.length > 0 ? attachment.waveform : defaultWaveform(24);
  const effectLabel =
    attachment.voiceEffect && attachment.voiceEffect !== 'normal'
      ? VOICE_EFFECTS.find((e) => e.id === attachment.voiceEffect)?.label
      : null;

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-2xl min-w-[220px] max-w-[290px] ${
        isOwn
          ? 'bg-black/15 text-white'
          : 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
      }`}
    >
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pausar mensagem de áudio' : 'Reproduzir mensagem de áudio'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer ${
          isOwn ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
        }`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[2px] h-6">
          {bars.slice(0, 24).map((val, idx) => (
            <span
              key={idx}
              style={{ height: `${Math.max(22, Math.round(val * 100))}%` }}
              className={`w-[3px] rounded-full transition-opacity ${
                playing ? 'opacity-100 animate-pulse' : 'opacity-75'
              } ${isOwn ? 'bg-white' : 'bg-zinc-600 dark:bg-zinc-300'}`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] opacity-80 mt-0.5 font-mono">
          <span>{attachment.durationSec ? `${attachment.durationSec}s` : 'Áudio'}</span>
          {effectLabel && <span>Voz {effectLabel}</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSpeed((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1))}
        aria-label="Alterar velocidade do áudio"
        className="px-2 py-1 rounded-full text-[11px] font-mono font-semibold bg-black/10 dark:bg-white/10 hover:bg-black/20 cursor-pointer shrink-0"
      >
        {speed}x
      </button>
    </div>
  );
};

export const ChatView: React.FC<ChatViewProps> = ({
  group,
  currentUser,
  profiles,
  messages,
  peers,
  typingUsers,
  quickReplies,
  stickers,
  unreadTotalCount = 0,
  isFullscreen = false,
  compactMessages,
  autoRevealInvisibleInk,
  isCurrentUserAdmin,
  blockedUserIds,
  removedContactIds = [],
  mutedRoomCodes,
  contactPrefs,
  onSendMessage,
  onCreateSticker,
  onOpenStickerSettings,
  onToggleFullscreen,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
  onTogglePin,
  onVotePoll,
  onTypingChange,
  onStartCall,
  onOpenGroupAdmin,
  onOpenConversationsModal,
  onStartPrivateChat,
  onClearConversation,
  onDeleteConversation,
  onLeaveGroup,
  onRemoveContact,
  onToggleMuteRoom,
  onToggleBlockUser,
  onUpdateContactPref,
  onOpenProfile,
}) => {
  const [text, setText] = useState('');
  const [textStyle, setTextStyle] = useState<TextStyleType>('normal');
  const [bubbleEffect, setBubbleEffect] = useState<BubbleEffect>('none');
  const [screenEffect, setScreenEffect] = useState<ScreenEffect>('none');
  const [selfDestructSec, setSelfDestructSec] = useState<number>(0);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage['replyTo'] | undefined>(undefined);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const [showEffectsPopover, setShowEffectsPopover] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showStickerTray, setShowStickerTray] = useState(false);
  const [showStickerMaker, setShowStickerMaker] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showSketchPad, setShowSketchPad] = useState(false);
  const [showChatOptions, setShowChatOptions] = useState(false);
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<'all' | 'media' | 'audio' | 'polls'>('all');
  const [activeTapbackMsgId, setActiveTapbackMsgId] = useState<string | null>(null);
  const [revealedInkIds, setRevealedInkIds] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeScreenOverlay, setActiveScreenOverlay] = useState<ScreenEffect>('none');
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Poll composer state
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<{
    dataUrl: string;
    durationSec: number;
    waveform: number[];
  } | null>(null);
  const [selectedVoiceEffect, setSelectedVoiceEffect] = useState<VoiceEffectType>('normal');
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<number | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastMsgCountRef = useRef(messages.length);

  // Periodic tick to expire self-destructing messages cleanly
  useEffect(() => {
    const hasTemp = messages.some((m) => Boolean(m.expiresAt));
    if (!hasTemp) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [messages]);

  useEffect(() => {
    if (messages.length > lastMsgCountRef.current) {
      const latest = messages[messages.length - 1];
      if (latest && latest.screenEffect && latest.screenEffect !== 'none') {
        setActiveScreenOverlay(latest.screenEffect);
        const t = window.setTimeout(() => setActiveScreenOverlay('none'), 2800);
        lastMsgCountRef.current = messages.length;
        return () => window.clearTimeout(t);
      }
    }
    lastMsgCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [group.roomCode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const dmTargetId = useMemo(() => {
    if (group.kind !== 'dm' || !group.dmParticipantIds) return null;
    return group.dmParticipantIds.find((id) => id !== currentUser.id) || null;
  }, [group.kind, group.dmParticipantIds, currentUser.id]);

  const dmTargetProfile = dmTargetId ? profiles[dmTargetId] : undefined;
  const dmPref = dmTargetId ? contactPrefs[dmTargetId] : undefined;
  const isMutedRoom = mutedRoomCodes.includes(group.roomCode);
  const isDmTargetBlocked = dmTargetId ? isUserBlocked(dmTargetId, blockedUserIds) : false;

  const savedContacts = useMemo(
    () =>
      Object.values(profiles).filter(
        (p) =>
          p.id !== currentUser.id &&
          !isUserBlocked(p.id, blockedUserIds) &&
          !removedContactIds.includes(p.id)
      ),
    [profiles, currentUser.id, blockedUserIds, removedContactIds]
  );

  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (!isMessageActive(m, nowTick)) return false;
      if (!m.systemEvent && isUserBlocked(m.senderId, blockedUserIds)) return false;

      if (searchFilter === 'media') {
        if (!m.attachments.some((a) => a.kind === 'image' || a.kind === 'video')) return false;
      } else if (searchFilter === 'audio') {
        if (!m.attachments.some((a) => a.kind === 'audio')) return false;
      } else if (searchFilter === 'polls') {
        if (!m.poll) return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.text.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.attachments.some((a) => a.name.toLowerCase().includes(q))
      );
    });
  }, [messages, nowTick, searchFilter, searchQuery, blockedUserIds]);

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.pinned && isMessageActive(m, nowTick)),
    [messages, nowTick]
  );
  const hostPeer = useMemo(() => peers.find((p) => p.isHost), [peers]);

  // @mention autocomplete detection
  const mentionQuery = useMemo(() => {
    const match = text.match(/@([a-zA-Z0-9._]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [text]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    return Object.values(profiles).filter(
      (p) =>
        p.handle.toLowerCase().includes(mentionQuery) ||
        p.name.toLowerCase().includes(mentionQuery)
    );
  }, [mentionQuery, profiles]);

  const handleInputChange = (val: string) => {
    setText(val);
    onTypingChange(val.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      onTypingChange(false);
    }, 2000);
  };

  const handleSend = () => {
    const cleanText = text.trim();
    if (!cleanText && pendingAttachments.length === 0) return;

    onSendMessage({
      text: cleanText,
      textStyle,
      bubbleEffect,
      screenEffect,
      attachments: pendingAttachments,
      replyTo,
      selfDestructSec: selfDestructSec > 0 ? selfDestructSec : undefined,
    });

    if (screenEffect !== 'none') {
      setActiveScreenOverlay(screenEffect);
      window.setTimeout(() => setActiveScreenOverlay('none'), 2800);
    }

    setText('');
    setPendingAttachments([]);
    setReplyTo(undefined);
    setBubbleEffect('none');
    setScreenEffect('none');
    setTextStyle('normal');
    setSelfDestructSec(0);
    setShowEffectsPopover(false);
    onTypingChange(false);
  };

  const handleFileSelection = async (
    e: React.ChangeEvent<HTMLInputElement>,
    forceMedia: boolean
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setShowAttachMenu(false);

    const newAtts: ChatAttachment[] = [];
    for (const file of files.slice(0, 4)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      let kind: ChatAttachment['kind'] = 'file';
      if (file.type.startsWith('image/')) kind = 'image';
      else if (file.type.startsWith('video/')) kind = 'video';
      else if (file.type.startsWith('audio/')) kind = 'audio';
      else if (forceMedia) kind = 'image';

      newAtts.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
      });
    }

    setPendingAttachments((prev) => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const startVoiceRecording = async () => {
    setRecorderError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecorderError('Gravação de áudio não suportada neste navegador.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(blob);
        });
        const waveform = await computeWaveformFromDataUrl(dataUrl, 24);
        setRecordedAudio({
          dataUrl,
          durationSec: Math.max(1, recordingSeconds),
          waveform,
        });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setRecorderError('Permita acesso ao microfone para gravar mensagens de voz.');
    }
  };

  const stopVoiceRecording = () => {
    if (recordIntervalRef.current) {
      window.clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const sendRecordedAudio = () => {
    if (!recordedAudio) return;
    previewStopRef.current?.();
    const audioAttachment: ChatAttachment = {
      id: `aud-${Date.now()}`,
      kind: 'audio',
      name: `voz-${selectedVoiceEffect}.webm`,
      mimeType: 'audio/webm',
      size: recordedAudio.dataUrl.length,
      dataUrl: recordedAudio.dataUrl,
      durationSec: recordedAudio.durationSec,
      voiceEffect: selectedVoiceEffect,
      waveform: recordedAudio.waveform,
    };
    onSendMessage({
      text: '',
      textStyle: 'normal',
      bubbleEffect: 'none',
      screenEffect: 'none',
      attachments: [audioAttachment],
      replyTo,
    });
    setRecordedAudio(null);
    setSelectedVoiceEffect('normal');
    setReplyTo(undefined);
  };

  const handleCreatePoll = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQ = pollQuestion.trim();
    const cleanOpts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!cleanQ || cleanOpts.length < 2) return;

    onSendMessage({
      text: cleanQ,
      textStyle: 'normal',
      bubbleEffect: 'none',
      screenEffect: 'none',
      attachments: [],
      poll: {
        question: cleanQ,
        allowMultiple: false,
        options: cleanOpts.map((label, idx) => ({
          id: `opt-${Date.now()}-${idx}`,
          label,
          voterIds: [],
        })),
      },
    });

    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollModal(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getTextStyleClass = (style: TextStyleType) => {
    switch (style) {
      case 'bold':
        return 'font-bold tracking-tight';
      case 'editorial':
        return 'italic font-medium tracking-wide';
      case 'mono':
        return 'font-mono text-[13px]';
      case 'gradient':
        return 'font-semibold underline decoration-white/40 underline-offset-4';
      default:
        return '';
    }
  };

  const getBubbleAnimationClass = (effect: BubbleEffect) => {
    switch (effect) {
      case 'slam':
        return 'animate-msg-slam';
      case 'loud':
        return 'animate-msg-loud';
      case 'gentle':
        return 'animate-msg-gentle';
      default:
        return '';
    }
  };

  const ownBubbleColor = ACCENT_BUBBLE_CLASSES[group.accentColor] || ACCENT_BUBBLE_CLASSES.blue;
  const activeTypingList = Object.values(typingUsers).filter(Boolean);

  return (
    <div className={`relative flex-1 flex flex-col h-full min-h-0 ${WALLPAPER_CLASSES[group.wallpaper]}`}>
      {/* Screen Effects Overlay */}
      {activeScreenOverlay !== 'none' && (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {activeScreenOverlay === 'confetti' &&
            Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                style={{
                  left: `${(i * 3.7) % 100}%`,
                  animationDelay: `${(i % 7) * 0.12}s`,
                  backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#6366f1'][i % 5],
                }}
                className="absolute top-0 w-2.5 h-4 rounded-sm animate-confetti"
              />
            ))}
          {activeScreenOverlay === 'hearts' &&
            Array.from({ length: 16 }).map((_, i) => (
              <span
                key={i}
                style={{
                  left: `${(i * 6.5) % 94}%`,
                  bottom: '10%',
                  animationDelay: `${(i % 5) * 0.18}s`,
                }}
                className="absolute text-2xl animate-heart-float"
              >
                ❤️
              </span>
            ))}
          {activeScreenOverlay === 'pulse' && (
            <div className="absolute inset-0 bg-blue-500/10 animate-pulse" />
          )}
        </div>
      )}

      {/* Floating Apple iOS 27 Liquid Glass Chat Header */}
      <div className="shrink-0 px-3 sm:px-5 pt-3 z-20 space-y-2">
        <header className="px-3 sm:px-4 py-2.5 rounded-[26px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-2xl border border-zinc-200/80 dark:border-white/12 shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_10px_32px_rgba(0,0,0,0.45)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onOpenConversationsModal}
              aria-label="Trocar conversa ou contato"
              title="Contatos e Grupos"
              className="relative lg:hidden w-9 h-9 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0 cursor-pointer"
            >
              <Users className="w-4 h-4" />
              {unreadTotalCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadTotalCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenGroupAdmin}
              aria-label={group.kind === 'dm' ? 'Opções da conversa' : 'Abrir perfil do grupo'}
              className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
            >
              <Avatar src={dmTargetProfile?.avatarUrl || group.avatarUrl} name={dmPref?.alias || group.name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {group.kind === 'dm' && <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  <h1 className="font-display text-sm sm:text-base font-semibold truncate text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {dmPref?.alias || group.name}
                  </h1>
                  {isMutedRoom && <BellOff className="w-3 h-3 text-zinc-400 shrink-0" />}
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {group.kind === 'dm' ? (
                    <span>
                      Conversa 1-a-1{dmTargetProfile ? ` · @${dmTargetProfile.handle}` : ''}
                    </span>
                  ) : (
                    <>
                      <span>{peers.length || 1} ativo(s)</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono">{group.roomCode}</span>
                      {hostPeer && (
                        <>
                          <span aria-hidden="true" className="hidden sm:inline"> · </span>
                          <span className="hidden sm:inline">
                            Host: {hostPeer.userId === currentUser.id ? 'Você' : hostPeer.name}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
            </button>
          </div>

          {/* Floating iOS 27 Action Buttons in standard order: Search, Audio Call, Video Call, Options, Group/Server */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowSearch((s) => !s)}
              aria-label="Buscar mensagens no chat"
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                showSearch
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-700'
              }`}
            >
              <Search className="w-4 h-4" strokeWidth={1.75} />
            </button>

            {group.allowCalls && !isDmTargetBlocked && (
              <>
                <button
                  type="button"
                  onClick={() => onStartCall('audio')}
                  aria-label="Iniciar chamada de áudio"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                >
                  <Phone className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => onStartCall('video')}
                  aria-label="Iniciar chamada de vídeo"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400 hover:bg-blue-600/25 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                >
                  <Video className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setShowChatOptions((o) => !o);
                setConfirmClearChat(false);
                setConfirmDeleteChat(false);
              }}
              aria-label="Opções do chat e contato"
              title="Configurar contato, limpar ou apagar conversa"
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                showChatOptions
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-700'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" strokeWidth={1.75} />
            </button>

            <button
              type="button"
              onClick={onOpenGroupAdmin}
              aria-label="Perfil do grupo e servidor"
              title="Perfil do grupo e membros"
              className="hidden sm:flex w-10 h-10 rounded-full bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 items-center justify-center transition-all active:scale-95 cursor-pointer"
            >
              <Settings2 className="w-4 h-4" strokeWidth={1.75} />
            </button>

            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Usar em tela cheia'}
                title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" strokeWidth={1.75} />
                ) : (
                  <Maximize2 className="w-4 h-4" strokeWidth={1.75} />
                )}
              </button>
            )}
          </div>
        </header>

        {/* Quick Saved Contacts Jump Strip (Mobile & Tablet 1-click contact chat) */}
        {savedContacts.length > 0 && (
          <div className="lg:hidden flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
            {savedContacts.map((contact) => {
              const alias = contactPrefs[contact.id]?.alias || contact.name.split(' ')[0];
              const isActiveDm = dmTargetId === contact.id;
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => onStartPrivateChat(contact.id)}
                  className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-xs font-medium shrink-0 border transition-all cursor-pointer ${
                    isActiveDm
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-white/75 dark:bg-zinc-900/75 backdrop-blur-xl border-zinc-200/80 dark:border-white/10 text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <Avatar src={contact.avatarUrl} name={contact.name} size="xs" />
                  <span>{alias}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Chat & Contact Options Floating Popover */}
        {showChatOptions && (
          <div className="p-4 rounded-[24px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Configurar {group.kind === 'dm' ? 'Contato & Conversa' : 'Sala & Histórico'}
              </p>
              <button
                type="button"
                onClick={() => setShowChatOptions(false)}
                className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {dmTargetId && dmTargetProfile && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                    Apelido local para @{dmTargetProfile.handle}
                  </label>
                  <input
                    type="text"
                    value={dmPref?.alias ?? ''}
                    onChange={(e) =>
                      onUpdateContactPref(dmTargetId, {
                        ...dmPref,
                        alias: e.target.value,
                      })
                    }
                    placeholder={dmTargetProfile.name}
                    className="w-full px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-zinc-500 mb-1.5">
                    Cor do contato no chat
                  </p>
                  <div className="flex items-center gap-1.5">
                    {['#3b82f6', '#6366f1', '#10b981', '#f43f5e', '#f59e0b', '#06b6d4'].map(
                      (clr) => (
                        <button
                          key={clr}
                          type="button"
                          onClick={() =>
                            onUpdateContactPref(dmTargetId, {
                              ...dmPref,
                              customColor: clr,
                            })
                          }
                          style={{ backgroundColor: clr }}
                          aria-label={`Cor ${clr}`}
                          className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                            (dmPref?.customColor || dmTargetProfile.accentColor) === clr
                              ? 'border-zinc-900 dark:border-white scale-110'
                              : 'border-transparent'
                          }`}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleMuteRoom(group.roomCode)}
                className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isMutedRoom ? <Bell className="w-3.5 h-3.5 text-blue-500" /> : <BellOff className="w-3.5 h-3.5" />}
                <span>{isMutedRoom ? 'Reativar avisos' : 'Silenciar conversa'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowChatOptions(false);
                  onOpenGroupAdmin();
                }}
                className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Servidor & Visual</span>
              </button>

              {confirmClearChat ? (
                <button
                  type="button"
                  onClick={() => {
                    onClearConversation(group.roomCode);
                    setConfirmClearChat(false);
                    setShowChatOptions(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-amber-600 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Confirmar limpar mensagens
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearChat(true)}
                  className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:text-amber-500 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Limpar conversa</span>
                </button>
              )}

              {group.kind === 'group' && (
                <button
                  type="button"
                  onClick={() => {
                    onLeaveGroup(group.roomCode);
                    setShowChatOptions(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair do grupo</span>
                </button>
              )}

              {confirmDeleteChat ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteConversation(group.roomCode);
                    setConfirmDeleteChat(false);
                    setShowChatOptions(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-rose-600 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Confirmar exclusão
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChat(true)}
                  className="px-3.5 py-2 rounded-full bg-rose-500/10 text-rose-500 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{group.kind === 'group' ? 'Excluir grupo' : 'Apagar conversa'}</span>
                </button>
              )}

              {dmTargetId && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveContact(dmTargetId);
                      setShowChatOptions(false);
                    }}
                    className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:text-rose-500 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir contato</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleBlockUser(dmTargetId);
                      setShowChatOptions(false);
                    }}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      isDmTargetBlocked
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-500/10 text-rose-500'
                    }`}
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>{isDmTargetBlocked ? 'Desbloquear contato' : 'Bloquear contato'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Search & Filter Bar */}
      {showSearch && (
        <div className="shrink-0 mx-3 sm:mx-5 mt-2 px-4 py-2.5 rounded-2xl bg-white/85 dark:bg-zinc-900/85 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-md space-y-2 z-20">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar textos, nomes ou arquivos..."
              autoFocus
              className="flex-1 bg-transparent text-sm focus:outline-none text-zinc-900 dark:text-zinc-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Limpar busca"
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'Tudo'],
                ['media', 'Fotos & Vídeos'],
                ['audio', 'Áudios'],
                ['polls', 'Enquetes'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSearchFilter(id)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer ${
                  searchFilter === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pinned Banner */}
      {pinnedMessages.length > 0 && !showSearch && (
        <div className="shrink-0 mx-3 sm:mx-5 mt-2 px-4 py-2 rounded-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-zinc-200/70 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Pin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
              <span className="font-semibold">{pinnedMessages[pinnedMessages.length - 1].senderName}: </span>
              {pinnedMessages[pinnedMessages.length - 1].text || 'Anexo fixado'}
            </p>
          </div>
          {isCurrentUserAdmin && (
            <button
              type="button"
              onClick={() => onTogglePin(pinnedMessages[pinnedMessages.length - 1].id)}
              className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 shrink-0 cursor-pointer"
            >
              Desafixar
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-3 scrollbar-thin">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {searchQuery || searchFilter !== 'all'
                ? 'Nenhuma mensagem encontrada para este filtro.'
                : 'Nenhuma mensagem ainda. Comece a conversa!'}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg, index) => {
            if (msg.systemEvent) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 text-center px-3 py-1">
                    {msg.text}
                  </span>
                </div>
              );
            }

            const isOwn = msg.senderId === currentUser.id;
            const senderProfile = profiles[msg.senderId];
            const senderPref = contactPrefs[msg.senderId];
            const senderColor =
              senderPref?.customColor ||
              senderProfile?.accentColor ||
              msg.senderColor ||
              '#3b82f6';
            const displaySenderName = senderPref?.alias || senderProfile?.name || msg.senderName;
            const senderAvatarSrc = senderProfile?.avatarUrl || msg.senderAvatar;
            const isStickerOnly =
              msg.attachments.length === 1 &&
              msg.attachments[0].kind === 'sticker' &&
              !msg.text.trim();

            const isInvisible =
              msg.bubbleEffect === 'invisible' &&
              !autoRevealInvisibleInk &&
              !revealedInkIds[msg.id];

            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, users]) => users.length > 0
            );

            const remainingSec = msg.expiresAt
              ? Math.max(0, Math.ceil((msg.expiresAt - nowTick) / 1000))
              : null;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${
                  compactMessages ? 'mb-1.5' : 'mb-3'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpenProfile(msg.senderId)}
                  className={`flex items-center gap-1.5 mb-1 text-left hover:underline cursor-pointer ${
                    isOwn ? 'mr-1 flex-row-reverse' : 'ml-1'
                  }`}
                >
                  <Avatar src={senderAvatarSrc} name={displaySenderName} size="xs" />
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: senderColor }}
                  />
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: senderColor }}
                  >
                    {isOwn ? `${displaySenderName} (Você)` : displaySenderName}
                  </span>
                </button>

                <div
                  className={`group relative flex items-end gap-1.5 max-w-[86%] sm:max-w-[70%] ${
                    isOwn ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {/* Apple Messages Glass/Color Bubble or Clean Sticker with Sender Color Accent */}
                  <div
                    onClick={() => {
                      if (isInvisible) {
                        setRevealedInkIds((prev) => ({ ...prev, [msg.id]: true }));
                      }
                    }}
                    className={`relative transition-all ${getBubbleAnimationClass(
                      msg.bubbleEffect
                    )} ${
                      isStickerOnly
                        ? 'p-1 bg-transparent'
                        : isOwn
                        ? `${ownBubbleColor} rounded-[22px] rounded-br-[6px] px-4 py-2.5 shadow-sm`
                        : 'bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md text-zinc-900 dark:text-zinc-100 border border-zinc-200/80 dark:border-white/10 rounded-[22px] rounded-bl-[6px] px-4 py-2.5 shadow-sm'
                    } ${isInvisible ? 'cursor-pointer' : ''}`}
                  >
                    {msg.replyTo && (
                      <div
                        className={`mb-2 px-2.5 py-1.5 rounded-xl text-xs ${
                          isOwn
                            ? 'bg-black/15 text-white/90'
                            : 'bg-zinc-100 dark:bg-zinc-900/80 text-zinc-600 dark:text-zinc-300'
                        }`}
                      >
                        <p className="font-semibold text-[11px]">{msg.replyTo.senderName}</p>
                        <p className="truncate opacity-85">{msg.replyTo.textPreview}</p>
                      </div>
                    )}

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={isStickerOnly ? '' : 'space-y-2 mb-1.5'}>
                        {msg.attachments.map((att) => {
                          if (att.kind === 'sticker') {
                            return (
                              <img
                                key={att.id}
                                src={att.dataUrl}
                                alt={att.name || 'Figurinha'}
                                className="w-32 h-32 sm:w-36 sm:h-36 object-contain drop-shadow-lg select-none"
                              />
                            );
                          }
                          if (att.kind === 'image') {
                            return (
                              <button
                                key={att.id}
                                type="button"
                                onClick={() => setLightboxImage(att.dataUrl)}
                                className="block rounded-2xl overflow-hidden max-w-[260px] cursor-pointer"
                              >
                                <img
                                  src={att.dataUrl}
                                  alt={att.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full max-h-64 object-cover"
                                />
                              </button>
                            );
                          }
                          if (att.kind === 'video') {
                            return (
                              <video
                                key={att.id}
                                src={att.dataUrl}
                                controls
                                className="rounded-2xl max-w-[280px] max-h-64 bg-black"
                              />
                            );
                          }
                          if (att.kind === 'audio') {
                            return (
                              <AudioAttachmentPlayer
                                key={att.id}
                                attachment={att}
                                isOwn={isOwn}
                              />
                            );
                          }
                          return (
                            <a
                              key={att.id}
                              href={att.dataUrl}
                              download={att.name}
                              className={`flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs transition-colors ${
                                isOwn
                                  ? 'bg-black/15 hover:bg-black/25 text-white'
                                  : 'bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                              }`}
                            >
                              <FileText className="w-4 h-4 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{att.name}</p>
                                <p className="text-[11px] opacity-75">{formatFileSize(att.size)}</p>
                              </div>
                              <Download className="w-4 h-4 shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {msg.sharedPost && (
                      <div
                        className={`mb-2 rounded-2xl overflow-hidden border ${
                          isOwn
                            ? 'border-white/20 bg-black/15'
                            : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900'
                        }`}
                      >
                        {msg.sharedPost.imageUrl && (
                          <img
                            src={msg.sharedPost.imageUrl}
                            alt={msg.sharedPost.caption}
                            referrerPolicy="no-referrer"
                            className="w-full max-h-40 object-cover"
                          />
                        )}
                        <div className="p-2.5 text-xs">
                          <p className="font-semibold">@{msg.sharedPost.authorHandle}</p>
                          <p className="opacity-85 line-clamp-2 mt-0.5">{msg.sharedPost.caption}</p>
                        </div>
                      </div>
                    )}

                    {msg.poll && (
                      <div className="min-w-[230px] sm:min-w-[270px] space-y-2 py-1">
                        <p className="text-xs font-semibold opacity-95">{msg.poll.question}</p>
                        {(() => {
                          const totalVotes = msg.poll.options.reduce(
                            (acc, o) => acc + o.voterIds.length,
                            0
                          );
                          return msg.poll.options.map((opt) => {
                            const voted = opt.voterIds.includes(currentUser.id);
                            const pct =
                              totalVotes > 0 ? Math.round((opt.voterIds.length / totalVotes) * 100) : 0;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => onVotePoll(msg.id, opt.id)}
                                className={`relative w-full text-left px-3 py-2 rounded-xl text-xs overflow-hidden border transition-colors cursor-pointer ${
                                  isOwn
                                    ? 'border-white/25 bg-black/15 hover:bg-black/25'
                                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                                }`}
                              >
                                <div
                                  style={{ width: `${pct}%` }}
                                  className={`absolute inset-y-0 left-0 transition-all ${
                                    isOwn ? 'bg-white/20' : 'bg-blue-500/15'
                                  }`}
                                />
                                <div className="relative flex items-center justify-between gap-2">
                                  <span className="font-medium flex items-center gap-1.5">
                                    {voted && <Check className="w-3.5 h-3.5 shrink-0" />}
                                    {opt.label}
                                  </span>
                                  <span className="font-mono text-[11px] opacity-80">{pct}%</span>
                                </div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    )}

                    {/* Inline Editing OR Normal Text with @mentions */}
                    {editingMsgId === msg.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (editingText.trim()) {
                            onEditMessage(msg.id, editingText.trim());
                          }
                          setEditingMsgId(null);
                        }}
                        className="flex items-center gap-2 min-w-[200px]"
                      >
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          autoFocus
                          className="flex-1 px-2.5 py-1 rounded-lg bg-black/20 text-sm focus:outline-none"
                        />
                        <button type="submit" className="text-xs font-semibold underline">
                          Salvar
                        </button>
                      </form>
                    ) : (
                      msg.text &&
                      !msg.poll && (
                        <div className="relative">
                          <p
                            className={`select-text text-[14.5px] leading-relaxed whitespace-pre-wrap break-words ${getTextStyleClass(
                              msg.textStyle
                            )} ${isInvisible ? 'invisible-ink-blur' : 'invisible-ink-revealed'}`}
                          >
                            <MentionText
                              text={msg.text}
                              profiles={profiles}
                              onMentionClick={onOpenProfile}
                            />
                          </p>
                          {isInvisible && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] opacity-85">
                              <Eye className="w-3 h-3" />
                              Toque para revelar tinta invisível
                            </span>
                          )}
                        </div>
                      )
                    )}

                    <div
                      className={`mt-1 flex items-center gap-1.5 text-[10px] font-mono ${
                        isOwn ? 'justify-end text-white/75' : 'justify-start text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {remainingSec !== null && (
                        <span className="inline-flex items-center gap-0.5 text-amber-300 dark:text-amber-400">
                          <Clock className="w-2.5 h-2.5" />
                          {remainingSec}s
                        </span>
                      )}
                      {msg.editedAt && <span>editada</span>}
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {isOwn && <CheckCheck className="w-3 h-3" />}
                    </div>
                  </div>

                  {/* Floating Bubble Action Buttons */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTapbackMsgId((curr) => (curr === msg.id ? null : msg.id))
                      }
                      aria-label="Reagir à mensagem"
                      className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      <SmilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setReplyTo({
                          messageId: msg.id,
                          senderName: msg.senderName,
                          textPreview: msg.text || 'Anexo de mídia',
                        })
                      }
                      aria-label="Responder mensagem"
                      className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                    </button>
                    {!isOwn && group.kind === 'group' && profiles[msg.senderId] && (
                      <button
                        type="button"
                        onClick={() => onStartPrivateChat(msg.senderId)}
                        aria-label={`Responder no privado para ${displaySenderName}`}
                        title="Responder no privado"
                        className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-indigo-500 cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isOwn && msg.text && !msg.poll && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMsgId(msg.id);
                          setEditingText(msg.text);
                        }}
                        aria-label="Editar mensagem"
                        className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-blue-600 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isOwn && (
                      <button
                        type="button"
                        onClick={() => onDeleteMessage(msg.id)}
                        aria-label="Apagar mensagem"
                        className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isCurrentUserAdmin && (
                      <button
                        type="button"
                        onClick={() => onTogglePin(msg.id)}
                        aria-label={msg.pinned ? 'Desafixar mensagem' : 'Fixar mensagem'}
                        className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 hover:text-blue-600 cursor-pointer"
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {activeTapbackMsgId === msg.id && (
                    <div
                      className={`absolute -top-11 ${
                        isOwn ? 'right-0' : 'left-0'
                      } z-30 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 shadow-xl`}
                    >
                      {TAPBACK_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            onToggleReaction(msg.id, emoji);
                            setActiveTapbackMsgId(null);
                          }}
                          className="w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-center text-base transition-transform hover:scale-110 cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {reactionEntries.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                    {reactionEntries.map(([emoji, users]) => {
                      const reactedByMe = users.includes(currentUser.id);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onToggleReaction(msg.id, emoji as TapbackEmoji)}
                          className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition-colors cursor-pointer ${
                            reactedByMe
                              ? 'bg-blue-600/15 border-blue-500/40 text-blue-600 dark:text-blue-400'
                              : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="font-mono text-[11px]">{users.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}

        {activeTypingList.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 pl-2">
            <span>{activeTypingList.join(', ')} está digitando...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Recording / Preview Bar */}
      {(isRecording || recordedAudio || recorderError) && (
        <div className="shrink-0 mx-3 sm:mx-5 mb-2 px-4 py-3 rounded-2xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-lg">
          {recorderError && (
            <div className="flex items-center justify-between text-xs text-rose-500">
              <span>{recorderError}</span>
              <button type="button" onClick={() => setRecorderError(null)} className="underline">
                Fechar
              </button>
            </div>
          )}

          {isRecording && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm font-medium">Gravando áudio...</span>
                <span className="font-mono text-xs text-zinc-500">{recordingSeconds}s</span>
              </div>
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="min-h-[38px] px-4 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Parar
              </button>
            </div>
          )}

          {recordedAudio && !isRecording && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4 text-blue-500" />
                  Modificador de voz ({recordedAudio.durationSec}s)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      previewStopRef.current?.();
                      const handle = await playAudioWithVoiceEffect(
                        recordedAudio.dataUrl,
                        selectedVoiceEffect,
                        1
                      );
                      previewStopRef.current = handle.stop;
                    }}
                    className="px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Ouvir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      previewStopRef.current?.();
                      setRecordedAudio(null);
                    }}
                    aria-label="Descartar gravação"
                    className="p-2 rounded-full text-zinc-500 hover:text-rose-500 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={sendRecordedAudio}
                    className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Enviar áudio
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {VOICE_EFFECTS.map((ef) => (
                  <button
                    key={ef.id}
                    type="button"
                    onClick={() => setSelectedVoiceEffect(ef.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      selectedVoiceEffect === ef.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {ef.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reply & Attachment Preview Strip */}
      {(replyTo || pendingAttachments.length > 0) && (
        <div className="shrink-0 mx-3 sm:mx-5 mb-2 px-4 py-2.5 rounded-2xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 space-y-2">
          {replyTo && (
            <div className="flex items-center justify-between gap-2 text-xs bg-zinc-100 dark:bg-zinc-800 px-3 py-2 rounded-xl">
              <div className="min-w-0">
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  Respondendo a {replyTo.senderName}
                </span>
                <p className="truncate text-zinc-500 dark:text-zinc-400">{replyTo.textPreview}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(undefined)}
                aria-label="Cancelar resposta"
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs"
                >
                  <span className="truncate max-w-[140px] font-medium">{att.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))
                    }
                    aria-label={`Remover ${att.name}`}
                    className="text-zinc-400 hover:text-rose-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating Apple iOS 27 Glass Composer Dock */}
      <div className="relative shrink-0 px-3 sm:px-5 pb-3 pt-1">
        {/* Mention Autocomplete Popover */}
        {mentionCandidates.length > 0 && (
          <div className="absolute bottom-20 left-6 right-6 sm:right-auto sm:w-72 z-30 rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-2 space-y-1">
            <p className="px-2 py-0.5 text-[11px] font-semibold text-zinc-500">Mencionar usuário</p>
            {mentionCandidates.slice(0, 5).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setText((prev) => prev.replace(/@([a-zA-Z0-9._]*)$/, `@${p.handle} `))
                }
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer"
              >
                <Avatar src={p.avatarUrl} name={p.name} size="xs" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">@{p.handle}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Popover: Attach & Tools Menu */}
        {showAttachMenu && (
          <div className="absolute bottom-20 left-4 z-30 w-60 rounded-[24px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-2 space-y-0.5">
            {group.allowMedia && (
              <>
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                  <span>Foto ou Vídeo</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer"
                >
                  <Paperclip className="w-4 h-4 text-emerald-500" />
                  <span>Arquivo ou Documento</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(false);
                    setShowSketchPad(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer"
                >
                  <Paintbrush className="w-4 h-4 text-rose-500" />
                  <span>Lousa Rápida (Desenhar)</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setShowAttachMenu(false);
                setShowPollModal(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer"
            >
              <BarChart3 className="w-4 h-4 text-amber-500" />
              <span>Criar Enquete</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAttachMenu(false);
                setShowQuickReplies(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left cursor-pointer sm:hidden"
            >
              <Zap className="w-4 h-4 text-indigo-500" />
              <span>Conversas Rápidas</span>
            </button>
          </div>
        )}

        {/* Popover: Stickers Tray */}
        {showStickerTray && (
          <div className="absolute bottom-20 left-4 right-4 sm:right-auto sm:w-80 z-30 rounded-[26px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold">Figurinhas ({stickers.length})</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowStickerTray(false);
                    setShowStickerMaker(true);
                  }}
                  className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Criar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowStickerTray(false);
                    onOpenStickerSettings();
                  }}
                  className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold cursor-pointer"
                >
                  Gerenciar
                </button>
              </div>
            </div>

            {stickers.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-xs text-zinc-500">
                  Transforme uma foto em figurinha para enviar aqui.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowStickerTray(false);
                    setShowStickerMaker(true);
                  }}
                  className="px-4 py-1.5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 text-xs font-semibold cursor-pointer"
                >
                  Transformar imagem em figurinha
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto scrollbar-thin">
                {stickers.map((stk) => (
                  <button
                    key={stk.id}
                    type="button"
                    onClick={() => {
                      onSendMessage({
                        text: '',
                        textStyle: 'normal',
                        bubbleEffect: 'gentle',
                        screenEffect: 'none',
                        attachments: [
                          {
                            id: `att-stk-${Date.now()}`,
                            kind: 'sticker',
                            name: stk.name,
                            mimeType: 'image/png',
                            size: stk.dataUrl.length,
                            dataUrl: stk.dataUrl,
                          },
                        ],
                        replyTo,
                      });
                      setShowStickerTray(false);
                      setReplyTo(undefined);
                    }}
                    title={`Enviar ${stk.name}`}
                    className="aspect-square rounded-2xl bg-zinc-100/80 dark:bg-zinc-800/70 hover:scale-105 p-1.5 flex items-center justify-center transition-transform cursor-pointer"
                  >
                    <img src={stk.dataUrl} alt={stk.name} className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Popover: Quick Replies */}
        {showQuickReplies && (
          <div className="absolute bottom-20 left-14 z-30 w-72 rounded-[24px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-2 space-y-1">
            <p className="px-2 py-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              Conversas Rápidas
            </p>
            {quickReplies.map((qr) => (
              <button
                key={qr.id}
                type="button"
                onClick={() => {
                  setText((prev) => (prev ? `${prev} ${qr.text}` : qr.text));
                  setShowQuickReplies(false);
                }}
                className="w-full text-left px-2.5 py-2 rounded-2xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>{qr.label}</span>
                  <span className="font-mono text-[11px] text-blue-500">{qr.shortcut}</span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{qr.text}</p>
              </button>
            ))}
          </div>
        )}

        {/* Popover: Apple Effects & Self-Destruct Timer */}
        {showEffectsPopover && (
          <div className="absolute bottom-20 right-4 z-30 w-80 rounded-[24px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                Estilo do texto
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['normal', 'Normal'],
                    ['bold', 'Negrito'],
                    ['editorial', 'Itálico'],
                    ['mono', 'Código'],
                    ['gradient', 'Destaque'],
                  ] as [TextStyleType, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTextStyle(id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                      textStyle === id
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                Efeito de bolha
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['none', 'Normal'],
                    ['slam', 'Impacto'],
                    ['loud', 'Alto'],
                    ['gentle', 'Suave'],
                    ['invisible', 'Tinta Invisível'],
                  ] as [BubbleEffect, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBubbleEffect(id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                      bubbleEffect === id
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                Efeito de tela
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['none', 'Nenhum'],
                    ['confetti', 'Confete'],
                    ['hearts', 'Corações'],
                    ['pulse', 'Pulso'],
                  ] as [ScreenEffect, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScreenEffect(id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                      screenEffect === id
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>Mensagem temporária (autodestruição)</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SELF_DESTRUCT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelfDestructSec(opt.sec)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                      selfDestructSec === opt.sec
                        ? 'bg-amber-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => handleFileSelection(e, true)}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFileSelection(e, false)}
          className="hidden"
        />

        {/* Floating iOS 27 Composer Bar */}
        <div className="flex items-end gap-1.5 sm:gap-2 p-2 rounded-[28px] bg-white/85 dark:bg-zinc-900/80 backdrop-blur-2xl border border-zinc-200/80 dark:border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)]">
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu((v) => !v);
              setShowQuickReplies(false);
              setShowEffectsPopover(false);
              setShowStickerTray(false);
            }}
            aria-label="Anexar mídia, arquivo ou enquete"
            className="w-10 h-10 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0 transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-5 h-5" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowStickerTray((v) => !v);
              setShowAttachMenu(false);
              setShowQuickReplies(false);
              setShowEffectsPopover(false);
            }}
            aria-label="Abrir figurinhas"
            title="Figurinhas"
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer ${
              showStickerTray
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200'
            }`}
          >
            <Sticker className="w-4 h-4" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowQuickReplies((v) => !v);
              setShowAttachMenu(false);
              setShowEffectsPopover(false);
              setShowStickerTray(false);
            }}
            aria-label="Abrir conversas rápidas"
            className="w-10 h-10 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-zinc-200 dark:hover:bg-zinc-700 hidden sm:flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0 transition-all active:scale-95 cursor-pointer"
          >
            <Zap className="w-4 h-4" strokeWidth={1.75} />
          </button>

          <div className="flex-1 flex items-end gap-1.5 rounded-2xl bg-zinc-100/70 dark:bg-zinc-950/60 border border-zinc-200/60 dark:border-white/5 px-3.5 py-1 min-h-[40px]">
            <textarea
              rows={1}
              value={text}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Mensagem ou @mencionar..."
              aria-label="Escrever mensagem"
              className="flex-1 bg-transparent resize-none py-1.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none max-h-28"
            />
            <button
              type="button"
              onClick={() => {
                setShowEffectsPopover((v) => !v);
                setShowAttachMenu(false);
                setShowQuickReplies(false);
              }}
              aria-label="Escolher estilo e animação do texto"
              className={`p-1.5 rounded-full transition-colors cursor-pointer shrink-0 mb-0.5 ${
                bubbleEffect !== 'none' ||
                screenEffect !== 'none' ||
                textStyle !== 'normal' ||
                selfDestructSec > 0
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-500/15'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Wand2 className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>

          {text.trim() || pendingAttachments.length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              aria-label="Enviar mensagem"
              className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer"
            >
              <Send className="w-4 h-4" strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              aria-label={isRecording ? 'Parar gravação de voz' : 'Gravar mensagem de voz'}
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer ${
                isRecording
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200'
              }`}
            >
              {isRecording ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <Mic className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Sketch Pad Modal */}
      {showSketchPad && (
        <SketchPadModal
          onClose={() => setShowSketchPad(false)}
          onSendSketch={(dataUrl) => {
            onSendMessage({
              text: '',
              textStyle: 'normal',
              bubbleEffect: 'gentle',
              screenEffect: 'none',
              attachments: [
                {
                  id: `sketch-${Date.now()}`,
                  kind: 'image',
                  name: 'desenho.png',
                  mimeType: 'image/png',
                  size: dataUrl.length,
                  dataUrl,
                },
              ],
            });
          }}
        />
      )}

      {showStickerMaker && (
        <StickerMakerModal
          ownerId={currentUser.id}
          onClose={() => setShowStickerMaker(false)}
          onSaveSticker={(stk) => {
            onCreateSticker(stk);
            setShowStickerMaker(false);
            setShowStickerTray(true);
          }}
        />
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-label="Visualizar imagem"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Fechar visualização"
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage}
            alt="Imagem ampliada"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[85vh] rounded-2xl object-contain"
          />
        </div>
      )}

      {/* Poll Modal */}
      {showPollModal && (
        <div
          role="dialog"
          aria-label="Criar enquete no chat"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreatePoll}
            className="w-full max-w-md rounded-[28px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Nova enquete no grupo</h3>
              <button
                type="button"
                onClick={() => setShowPollModal(false)}
                aria-label="Fechar enquete"
                className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label htmlFor="poll-q" className="block text-xs font-medium text-zinc-500 mb-1">
                Pergunta
              </label>
              <input
                id="poll-q"
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Ex: Qual horário fica melhor?"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-500">Opções</label>
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const copy = [...pollOptions];
                    copy[idx] = e.target.value;
                    setPollOptions(copy);
                  }}
                  placeholder={`Opção ${idx + 1}`}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              ))}
              {pollOptions.length < 4 && (
                <button
                  type="button"
                  onClick={() => setPollOptions([...pollOptions, ''])}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Adicionar opção
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPollModal(false)}
                className="px-4 py-2 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full text-xs font-semibold bg-blue-600 text-white"
              >
                Publicar enquete
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
