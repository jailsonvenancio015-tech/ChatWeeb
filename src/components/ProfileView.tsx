import React, { useMemo, useRef, useState } from 'react';
import {
  Ban,
  Bookmark,
  Camera,
  Check,
  Clock,
  Copy,
  Grid3X3,
  Heart,
  Lock,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pencil,
  Repeat2,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  FollowRelation,
  HighlightCollection,
  SocialPost,
  StoryItem,
  ThoughtBubble,
  UserProfile,
} from '../types/app';
import { Avatar } from './Avatar';
import { AvatarCropperModal } from './AvatarCropperModal';
import { MentionText } from './MentionText';
import {
  canEditPost,
  canViewPrivateProfileContent,
  getFollowStatus,
  getPostEditRemainingMs,
  isPostActive,
  isStoryActive,
  isThoughtActive,
} from '../utils/meshProtocol';

const THOUGHT_EMOJIS = ['✨', '☕️', '🎧', '📷', '💡', '🚀', '🌙', '💬'];
const THOUGHT_DURATIONS: { label: string; ms: number }[] = [
  { label: '1h', ms: 1000 * 60 * 60 },
  { label: '6h', ms: 1000 * 60 * 60 * 6 },
  { label: '12h', ms: 1000 * 60 * 60 * 12 },
  { label: '24h', ms: 1000 * 60 * 60 * 24 },
  { label: '48h', ms: 1000 * 60 * 60 * 48 },
];

function formatRemainingTime(expiresAt?: number): string | null {
  if (!expiresAt) return null;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expirado';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 24) return `${Math.ceil(hours / 24)}d restantes`;
  if (hours >= 1) return `${hours}h restantes`;
  const mins = Math.max(1, Math.floor(diff / (1000 * 60)));
  return `${mins}m restantes`;
}

interface ProfileViewProps {
  profile: UserProfile;
  currentUser: UserProfile;
  profiles: Record<string, UserProfile>;
  posts: SocialPost[];
  stories: StoryItem[];
  highlights: HighlightCollection[];
  followRelations: FollowRelation[];
  isBlocked?: boolean;
  isFullscreen?: boolean;
  likedPostIds?: string[];
  isLoadingProfilePosts?: boolean;
  onToggleFullscreen?: () => void;
  onRequestFollow: (targetUserId: string) => void;
  onRespondFollow: (fromUserId: string, accept: boolean) => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onUpdateAvatar: (croppedDataUrl: string) => void;
  onToggleLikePost: (postId: string) => void;
  onToggleRepost: (postId: string) => void;
  onEditPost: (postId: string, patch: Partial<SocialPost>) => void;
  onDeletePost: (postId: string) => void;
  onDeleteStory?: (storyId: string) => void;
  onUpdateThoughtBubble: (thought: ThoughtBubble | null) => void;
  onStartPrivateChat: (targetUserId: string) => void;
  onToggleBlockUser: (targetUserId: string) => void;
  onOpenProfile: (userId: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  currentUser,
  profiles,
  posts,
  stories,
  highlights,
  followRelations,
  isBlocked = false,
  isFullscreen = false,
  likedPostIds = [],
  isLoadingProfilePosts = false,
  onToggleFullscreen,
  onRequestFollow,
  onRespondFollow,
  onOpenSettings,
  onOpenSearch,
  onUpdateAvatar,
  onToggleLikePost,
  onToggleRepost,
  onEditPost,
  onDeletePost,
  onDeleteStory,
  onUpdateThoughtBubble,
  onStartPrivateChat,
  onToggleBlockUser,
  onOpenProfile,
}) => {
  const [tab, setTab] = useState<'posts' | 'reposts' | 'saved'>('posts');
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [confirmDeleteStoryId, setConfirmDeleteStoryId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Avatar cropper state
  const [cropSource, setCropSource] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Thought bubble editor
  const [showThoughtEditor, setShowThoughtEditor] = useState(false);
  const [thoughtText, setThoughtText] = useState(profile.thoughtBubble?.text || '');
  const [thoughtEmoji, setThoughtEmoji] = useState(profile.thoughtBubble?.emoji || '✨');
  const [thoughtDuration, setThoughtDuration] = useState(THOUGHT_DURATIONS[3]);

  const isSelf = profile.id === currentUser.id;
  const followStatus = getFollowStatus(currentUser.id, profile.id, followRelations);
  const canView = canViewPrivateProfileContent(currentUser.id, profile, followRelations);

  const activeThought = isThoughtActive(profile.thoughtBubble) ? profile.thoughtBubble : null;

  const activePosts = useMemo(
    () => posts.filter((p) => isPostActive(p)).sort((a, b) => b.timestamp - a.timestamp),
    [posts]
  );

  const userPosts = useMemo(
    () => activePosts.filter((p) => p.authorId === profile.id),
    [activePosts, profile.id]
  );

  const repostedPosts = useMemo(
    () => activePosts.filter((p) => (p.repostedBy || []).includes(profile.id)),
    [activePosts, profile.id]
  );

  const savedPosts = useMemo(
    () => activePosts.filter((p) => p.savedBy.includes(profile.id)),
    [activePosts, profile.id]
  );

  const userHighlights = useMemo(
    () => highlights.filter((h) => h.ownerId === profile.id),
    [highlights, profile.id]
  );

  const userActiveStories = useMemo(
    () =>
      stories
        .filter((s) => s.authorId === profile.id && isStoryActive(s))
        .sort((a, b) => b.timestamp - a.timestamp),
    [stories, profile.id]
  );

  const followersCount = useMemo(
    () =>
      followRelations.filter(
        (r) => r.toUserId === profile.id && r.status === 'accepted'
      ).length,
    [followRelations, profile.id]
  );

  const followingCount = useMemo(
    () =>
      followRelations.filter(
        (r) => r.fromUserId === profile.id && r.status === 'accepted'
      ).length,
    [followRelations, profile.id]
  );

  const pendingRequests = useMemo(
    () =>
      isSelf
        ? followRelations.filter(
            (r) => r.toUserId === currentUser.id && r.status === 'pending'
          )
        : [],
    [isSelf, followRelations, currentUser.id]
  );

  const displayedPosts =
    tab === 'reposts' ? repostedPosts : tab === 'saved' && isSelf ? savedPosts : userPosts;

  const handleCopyAppId = async () => {
    try {
      await navigator.clipboard.writeText(profile.appId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleSaveThought = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = thoughtText.trim();
    if (!clean) return;
    const now = Date.now();
    onUpdateThoughtBubble({
      text: clean.slice(0, 72),
      emoji: thoughtEmoji,
      createdAt: now,
      expiresAt: now + thoughtDuration.ms,
      durationLabel: thoughtDuration.label,
    });
    setShowThoughtEditor(false);
  };

  const liveSelectedPost = selectedPost
    ? activePosts.find((p) => p.id === selectedPost.id) || selectedPost
    : null;

  return (
    <div className="flex-1 h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-950 scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28 sm:pb-12 space-y-6">
        {/* Liquid Glass Profile Card */}
        <section className="relative rounded-[28px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-2xl border border-zinc-200/80 dark:border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)] p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Avatar + Floating Thought Bubble */}
            <div className="relative flex flex-col items-center sm:items-start shrink-0">
              {activeThought ? (
                <button
                  type="button"
                  onClick={() => {
                    if (isSelf) {
                      setThoughtText(activeThought.text);
                      setThoughtEmoji(activeThought.emoji || '✨');
                      setShowThoughtEditor(true);
                    }
                  }}
                  className={`mb-2 max-w-[210px] px-3.5 py-2 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg text-left transition-transform ${
                    isSelf ? 'hover:scale-[1.02] cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100 leading-snug">
                    {activeThought.emoji && <span className="mr-1">{activeThought.emoji}</span>}
                    {activeThought.text}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    {formatRemainingTime(activeThought.expiresAt)}
                  </p>
                </button>
              ) : (
                isSelf && (
                  <button
                    type="button"
                    onClick={() => {
                      setThoughtText('');
                      setShowThoughtEditor(true);
                    }}
                    className="mb-2 px-3 py-1.5 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-blue-500/15 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5 border border-zinc-200/80 dark:border-white/10 cursor-pointer transition-colors"
                  >
                    <Sparkles className="w-3 h-3 text-blue-500" />
                    <span>Deixar pensamento</span>
                  </button>
                )
              )}

              <div className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    if (canView && userActiveStories.length > 0) {
                      setStoryViewerIndex(0);
                    }
                  }}
                  aria-label={
                    canView && userActiveStories.length > 0
                      ? 'Ver stories ativos deste perfil'
                      : 'Foto de perfil'
                  }
                  className={canView && userActiveStories.length > 0 ? 'cursor-pointer' : 'cursor-default'}
                >
                  <Avatar
                    src={profile.avatarUrl}
                    name={profile.name}
                    size="xl"
                    hasStory={canView && userActiveStories.length > 0}
                    storyViewed={false}
                  />
                </button>
                {isSelf && (
                  <>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setCropSource(String(reader.result || ''));
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      aria-label="Personalizar e encaixar foto de perfil"
                      title="Trocar e encaixar foto na moldura"
                      className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-white dark:border-zinc-900 shadow-lg flex items-center justify-center transition-transform hover:scale-105 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Identity & Floating iOS 27 Action Buttons */}
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: profile.accentColor || '#3b82f6' }}
                    />
                    <span>{profile.name}</span>
                    {profile.isPrivate && (
                      <Lock className="w-4 h-4 text-zinc-400" aria-label="Perfil privado" />
                    )}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                    <span>@{profile.handle}</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={handleCopyAppId}
                      title="Copiar ID exclusivo do usuário"
                      className="inline-flex items-center gap-1 font-mono text-xs text-zinc-500 dark:text-zinc-400 hover:text-blue-500 transition-colors cursor-pointer"
                    >
                      <span>ID: {profile.appId}</span>
                      {copiedId ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Floating iOS 27 Glass Action Pills */}
                <div className="flex flex-wrap items-center gap-2">
                  {onToggleFullscreen && (
                    <button
                      type="button"
                      onClick={onToggleFullscreen}
                      aria-label={isFullscreen ? 'Sair da tela cheia' : 'Usar em tela cheia'}
                      title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                      className="w-10 h-10 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-sm hover:scale-[1.03] active:scale-95 flex items-center justify-center text-zinc-600 dark:text-zinc-300 transition-all cursor-pointer"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenSearch}
                    aria-label="Buscar usuários"
                    title="Buscar pessoas"
                    className="w-10 h-10 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-sm hover:scale-[1.03] active:scale-95 flex items-center justify-center text-zinc-600 dark:text-zinc-300 transition-all cursor-pointer"
                  >
                    <Search className="w-4 h-4" />
                  </button>

                  {isSelf ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setThoughtText(activeThought?.text || '');
                          setShowThoughtEditor(true);
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-sm hover:scale-[1.02] active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                        <span>Pensamento</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="min-h-[40px] px-4 py-2 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-md hover:opacity-90 active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Configurar conta</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {!isBlocked && (
                        <button
                          type="button"
                          onClick={() => onStartPrivateChat(profile.id)}
                          className="min-h-[40px] px-4 py-2 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-sm hover:scale-[1.02] active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5 text-blue-500" />
                          <span>Mensagem privada</span>
                        </button>
                      )}
                      {!isBlocked && (
                        followStatus === 'accepted' ? (
                          <span className="min-h-[40px] px-4 py-2 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 text-xs font-semibold flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Seguindo</span>
                          </span>
                        ) : followStatus === 'pending' ? (
                          <span className="min-h-[40px] px-4 py-2 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                            Solicitado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRequestFollow(profile.id)}
                            className="min-h-[40px] px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Pedir para seguir</span>
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleBlockUser(profile.id)}
                        className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                          isBlocked
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-rose-500'
                        }`}
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>{isBlocked ? 'Desbloquear' : 'Bloquear'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {profile.bio && (
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed max-w-xl select-text">
                  <MentionText
                    text={profile.bio}
                    profiles={profiles}
                    onMentionClick={onOpenProfile}
                  />
                </p>
              )}

              <div className="flex flex-wrap items-center gap-5 text-sm pt-1">
                <span>
                  <strong className="font-mono">{userPosts.length}</strong>{' '}
                  <span className="text-zinc-500 dark:text-zinc-400">posts</span>
                </span>
                <span>
                  <strong className="font-mono">{repostedPosts.length}</strong>{' '}
                  <span className="text-zinc-500 dark:text-zinc-400">republicados</span>
                </span>
                <span>
                  <strong className="font-mono">{followersCount}</strong>{' '}
                  <span className="text-zinc-500 dark:text-zinc-400">seguidores</span>
                </span>
                <span>
                  <strong className="font-mono">{followingCount}</strong>{' '}
                  <span className="text-zinc-500 dark:text-zinc-400">seguindo</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Incoming Follow Requests (Only on own profile) */}
        {isSelf && pendingRequests.length > 0 && (
          <section className="rounded-3xl bg-white/80 dark:bg-zinc-900/75 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 p-4 space-y-3">
            <h2 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Solicitações para seguir você ({pendingRequests.length})
            </h2>
            <div className="space-y-2.5">
              {pendingRequests.map((req) => {
                const requester = profiles[req.fromUserId];
                return (
                  <div
                    key={req.fromUserId}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => requester && onOpenProfile(requester.id)}
                      className="flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <Avatar
                        src={requester?.avatarUrl}
                        name={requester?.name || 'Usuário'}
                        size="sm"
                      />
                      <div>
                        <p className="font-semibold">{requester?.name || 'Usuário'}</p>
                        <p className="text-zinc-500">@{requester?.handle || 'usuario'}</p>
                      </div>
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onRespondFollow(req.fromUserId, false)}
                        className="px-3.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 font-medium cursor-pointer"
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        onClick={() => onRespondFollow(req.fromUserId, true)}
                        className="px-3.5 py-1.5 rounded-full bg-blue-600 text-white font-semibold cursor-pointer"
                      >
                        Aceitar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Highlights Strip */}
        {canView && userHighlights.length > 0 && (
          <section
            aria-label="Destaques do perfil"
            className="flex items-center gap-5 overflow-x-auto pb-1 scrollbar-thin"
          >
            {userHighlights.map((hl) => (
              <div key={hl.id} className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="w-16 h-16 rounded-full p-[2px] border border-zinc-300 dark:border-zinc-700 overflow-hidden shadow-sm">
                  {hl.coverUrl ? (
                    <img
                      src={hl.coverUrl}
                      alt={hl.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <div
                      style={{ backgroundColor: hl.coverColor }}
                      className="w-full h-full rounded-full flex items-center justify-center text-white text-xs font-semibold"
                    >
                      {hl.title.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {hl.title}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Private Lock Gate OR Posts / Reposts / Saved */}
        {!canView ? (
          <div className="rounded-[28px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 p-10 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-zinc-100 dark:bg-zinc-800 mx-auto flex items-center justify-center">
              <Lock className="w-6 h-6 text-zinc-500" />
            </div>
            <h2 className="font-display text-lg font-semibold">Esta conta é privada</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
              Peça permissão para seguir @{profile.handle}. Assim que a solicitação for aceita, todas as publicações, republicados, stories e destaques ficarão liberados.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Floating iOS Segmented Tab Bar */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-sm">
              <button
                type="button"
                onClick={() => setTab('posts')}
                className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  tab === 'posts'
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Publicações</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('reposts')}
                className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  tab === 'reposts'
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <Repeat2 className="w-3.5 h-3.5" />
                <span>Republicados</span>
              </button>
              {isSelf && (
                <button
                  type="button"
                  onClick={() => setTab('saved')}
                  className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    tab === 'saved'
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Salvos</span>
                </button>
              )}
            </div>

            {isLoadingProfilePosts && !isSelf && displayedPosts.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Carregando publicações deste perfil...
              </div>
            ) : displayedPosts.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {tab === 'reposts'
                  ? 'Nenhuma publicação republicada ainda.'
                  : 'Nenhuma publicação nesta aba ainda.'}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {displayedPosts.map((post) => {
                  const originalAuthor = profiles[post.authorId];
                  const remaining = formatRemainingTime(post.expiresAt);
                  return (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => setSelectedPost(post)}
                      className="relative aspect-square rounded-2xl overflow-hidden bg-zinc-200 dark:bg-zinc-900 group cursor-pointer border border-zinc-200/50 dark:border-white/5"
                    >
                      {post.kind === 'media' && post.mediaUrl ? (
                        post.mediaType === 'video' ? (
                          <video src={post.mediaUrl} className="w-full h-full object-cover" />
                        ) : (
                          <img
                            src={post.mediaUrl}
                            alt={post.caption || 'Post'}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        )
                      ) : (
                        <div
                          className={`w-full h-full bg-gradient-to-br ${
                            post.textCardBg || 'from-zinc-900 to-slate-800'
                          } text-white p-3 flex items-center justify-center text-center`}
                        >
                          <p className="text-xs font-medium line-clamp-4">{post.caption}</p>
                        </div>
                      )}

                      {tab === 'reposts' && originalAuthor && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-md text-[10px] text-white font-medium flex items-center gap-1">
                          <Repeat2 className="w-2.5 h-2.5" />
                          <span>@{originalAuthor.handle}</span>
                        </span>
                      )}

                      {remaining && (
                        <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-md text-[10px] text-white font-mono flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{remaining}</span>
                        </span>
                      )}

                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 text-white text-xs font-semibold">
                        <span className="flex items-center gap-1">
                          <Heart
                            className={`w-4 h-4 ${
                              post.likedBy.includes(currentUser.id) ||
                              likedPostIds.includes(post.id)
                                ? 'fill-rose-400 text-rose-400'
                                : 'fill-white'
                            }`}
                          />
                          {post.likedBy.includes(currentUser.id)
                            ? post.likedBy.length
                            : likedPostIds.includes(post.id)
                            ? post.likedBy.length + 1
                            : post.likedBy.length}
                        </span>
                        <span className="flex items-center gap-1">
                          <Repeat2 className="w-4 h-4" />
                          {(post.repostedBy || []).length}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Temporary Thought Bubble Modal */}
      {showThoughtEditor && (
        <div
          role="dialog"
          aria-label="Editar balão de pensamento"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveThought}
            className="w-full max-w-md rounded-[28px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Balão de pensamento</h3>
              <button
                type="button"
                onClick={() => setShowThoughtEditor(false)}
                aria-label="Fechar balão de pensamento"
                className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {THOUGHT_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setThoughtEmoji(em)}
                  className={`w-9 h-9 rounded-full text-base flex items-center justify-center transition-transform cursor-pointer ${
                    thoughtEmoji === em
                      ? 'bg-blue-600/20 ring-2 ring-blue-500 scale-110'
                      : 'bg-zinc-100 dark:bg-zinc-800'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="thought-input" className="block text-xs font-medium text-zinc-500 mb-1">
                O que você está pensando agora? (máx 72 caracteres)
              </label>
              <input
                id="thought-input"
                type="text"
                maxLength={72}
                value={thoughtText}
                onChange={(e) => setThoughtText(e.target.value)}
                placeholder="Ex: Ouvindo música e desenhando..."
                className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-zinc-500 mb-1.5">Duração no perfil</p>
              <div className="flex flex-wrap gap-1.5">
                {THOUGHT_DURATIONS.map((dur) => (
                  <button
                    key={dur.label}
                    type="button"
                    onClick={() => setThoughtDuration(dur)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                      thoughtDuration.label === dur.label
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {dur.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {activeThought ? (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateThoughtBubble(null);
                    setShowThoughtEditor(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-rose-500/15 text-rose-500 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remover</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowThoughtEditor(false)}
                  className="px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Publicar balão
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Selected Post Lightbox with 5-minute Edit & Delete */}
      {liveSelectedPost && (
        <div
          role="dialog"
          aria-label="Detalhes da publicação"
          onClick={() => {
            setSelectedPost(null);
            setEditingCaption(null);
            setConfirmDeleteId(null);
          }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-[28px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            {liveSelectedPost.kind === 'media' && liveSelectedPost.mediaUrl ? (
              <img
                src={liveSelectedPost.mediaUrl}
                alt={liveSelectedPost.caption}
                referrerPolicy="no-referrer"
                className="w-full max-h-[55vh] object-cover"
              />
            ) : (
              <div
                className={`p-10 bg-gradient-to-br ${
                  liveSelectedPost.textCardBg || 'from-zinc-900 to-slate-800'
                } text-white text-center`}
              >
                <p className="font-display text-xl font-semibold">{liveSelectedPost.caption}</p>
              </div>
            )}
            <div className="p-4 space-y-3">
              {editingCaption !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editingCaption.trim()) return;
                    onEditPost(liveSelectedPost.id, { caption: editingCaption.trim() });
                    setEditingCaption(null);
                  }}
                  className="space-y-2"
                >
                  <textarea
                    rows={2}
                    value={editingCaption}
                    onChange={(e) => setEditingCaption(e.target.value)}
                    className="w-full px-3 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCaption(null)}
                      className="px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Salvar legenda
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm select-text">
                      <MentionText
                        text={liveSelectedPost.caption}
                        profiles={profiles}
                        onMentionClick={(uid) => {
                          setSelectedPost(null);
                          onOpenProfile(uid);
                        }}
                      />
                    </p>
                    {liveSelectedPost.editedAt && (
                      <p className="text-[11px] text-zinc-400">Editado</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleRepost(liveSelectedPost.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                        (liveSelectedPost.repostedBy || []).includes(currentUser.id)
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-zinc-100 dark:bg-zinc-800'
                      }`}
                    >
                      <Repeat2 className="w-4 h-4" />
                      <span>{(liveSelectedPost.repostedBy || []).length}</span>
                    </button>
                    {(() => {
                      const isLiked =
                        liveSelectedPost.likedBy.includes(currentUser.id) ||
                        likedPostIds.includes(liveSelectedPost.id);
                      const likeCount = liveSelectedPost.likedBy.includes(currentUser.id)
                        ? liveSelectedPost.likedBy.length
                        : likedPostIds.includes(liveSelectedPost.id)
                        ? liveSelectedPost.likedBy.length + 1
                        : liveSelectedPost.likedBy.length;
                      return (
                        <button
                          type="button"
                          onClick={() => onToggleLikePost(liveSelectedPost.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold cursor-pointer"
                        >
                          <Heart
                            className={`w-4 h-4 ${
                              isLiked ? 'fill-rose-500 text-rose-500' : ''
                            }`}
                          />
                          <span>{likeCount}</span>
                        </button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {liveSelectedPost.authorId === currentUser.id && editingCaption === null && (
                <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  {canEditPost(liveSelectedPost, currentUser.id) ? (
                    <button
                      type="button"
                      onClick={() => setEditingCaption(liveSelectedPost.caption)}
                      className="px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5 text-blue-500" />
                      <span>
                        Editar ({Math.max(1, Math.ceil(getPostEditRemainingMs(liveSelectedPost) / 60000))}m restantes)
                      </span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-400">
                      Prazo de 5 min para edição encerrado
                    </span>
                  )}

                  {confirmDeleteId === liveSelectedPost.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDeletePost(liveSelectedPost.id);
                        setSelectedPost(null);
                        setConfirmDeleteId(null);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Confirmar exclusão
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(liveSelectedPost.id)}
                      className="px-3 py-1.5 rounded-full bg-rose-500/10 text-rose-500 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Apagar post</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Active Stories Viewer */}
      {storyViewerIndex !== null && userActiveStories[storyViewerIndex] && (
        <div
          role="dialog"
          aria-label="Visualizar story do perfil"
          className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center p-0 sm:p-6"
        >
          {(() => {
            const activeSt = userActiveStories[storyViewerIndex];
            return (
              <div className="relative w-full h-full sm:max-w-md sm:h-[85vh] sm:rounded-[32px] overflow-hidden bg-zinc-950 flex flex-col justify-between">
                <div className="relative z-20 p-4 bg-gradient-to-b from-black/75 to-transparent flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={profile.avatarUrl} name={profile.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{profile.name}</p>
                      <p className="text-[11px] text-white/70 font-mono">
                        {activeSt.durationLabel ? `Story ${activeSt.durationLabel}` : 'Story ativo'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isSelf && onDeleteStory && (
                      confirmDeleteStoryId === activeSt.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteStory(activeSt.id);
                            setConfirmDeleteStoryId(null);
                            if (userActiveStories.length <= 1) {
                              setStoryViewerIndex(null);
                            } else {
                              setStoryViewerIndex((idx) => Math.max(0, (idx ?? 0) - 1));
                            }
                          }}
                          className="px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          Confirmar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStoryId(activeSt.id)}
                          aria-label="Apagar story"
                          className="w-9 h-9 rounded-full bg-rose-500/20 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteStoryId(null);
                        setStoryViewerIndex(null);
                      }}
                      aria-label="Fechar story"
                      className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="absolute inset-0 flex items-center justify-center">
                  {activeSt.kind === 'image' && activeSt.mediaUrl ? (
                    <img
                      src={activeSt.mediaUrl}
                      alt={activeSt.text || 'Story'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className={`w-full h-full bg-gradient-to-br ${
                        activeSt.bgGradient || 'from-zinc-900 via-slate-900 to-zinc-800'
                      } flex items-center justify-center p-8 text-center`}
                    >
                      <p className="font-display text-2xl font-semibold">{activeSt.text}</p>
                    </div>
                  )}
                  {activeSt.kind === 'image' && activeSt.text && (
                    <div className="absolute bottom-16 inset-x-6 text-center">
                      <span className="inline-block px-4 py-2 rounded-2xl bg-black/60 backdrop-blur-md text-sm font-medium">
                        {activeSt.text}
                      </span>
                    </div>
                  )}
                </div>

                <div className="relative z-20 p-4 bg-gradient-to-t from-black/75 to-transparent flex items-center justify-between text-xs text-white/75">
                  <button
                    type="button"
                    disabled={storyViewerIndex === 0}
                    onClick={() => setStoryViewerIndex((i) => Math.max(0, (i ?? 0) - 1))}
                    className="px-3 py-1.5 rounded-full bg-white/10 disabled:opacity-30 cursor-pointer"
                  >
                    Anterior
                  </button>
                  <span className="font-mono">
                    {storyViewerIndex + 1}/{userActiveStories.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (storyViewerIndex + 1 < userActiveStories.length) {
                        setStoryViewerIndex(storyViewerIndex + 1);
                      } else {
                        setStoryViewerIndex(null);
                      }
                    }}
                    className="px-3 py-1.5 rounded-full bg-white/10 cursor-pointer"
                  >
                    {storyViewerIndex + 1 < userActiveStories.length ? 'Próximo' : 'Fechar'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {cropSource && (
        <AvatarCropperModal
          imageSrc={cropSource}
          onCancel={() => setCropSource(null)}
          onApply={(cropped) => {
            onUpdateAvatar(cropped);
            setCropSource(null);
          }}
        />
      )}
    </div>
  );
};
