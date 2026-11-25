import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Image as ImageIcon,
  Lock,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pencil,
  Plus,
  Repeat2,
  Search,
  Send,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import type {
  FollowRelation,
  HighlightCollection,
  ImageFilterId,
  SocialPost,
  StoryItem,
  UserProfile,
} from '../types/app';
import { Avatar } from './Avatar';
import { MentionText } from './MentionText';
import { IMAGE_FILTERS, applyFilterToImageDataUrl, getCssFilter } from '../utils/imageFilters';
import {
  canEditPost,
  canViewPrivateProfileContent,
  getFollowStatus,
  getPostEditRemainingMs,
  isPostActive,
  isThoughtActive,
  isUserBlocked,
} from '../utils/meshProtocol';

const TEXT_CARD_BACKGROUNDS = [
  { id: 'slate', label: 'Grafite', cls: 'from-zinc-900 via-slate-900 to-zinc-800' },
  { id: 'ocean', label: 'Oceano', cls: 'from-blue-950 via-indigo-950 to-slate-900' },
  { id: 'forest', label: 'Musgo', cls: 'from-emerald-950 via-teal-950 to-zinc-900' },
  { id: 'amber', label: 'Terracota', cls: 'from-stone-900 via-amber-950 to-zinc-900' },
  { id: 'plum', label: 'Vinho', cls: 'from-rose-950 via-zinc-900 to-slate-950' },
];

const POST_DURATIONS: { label: string; ms: number | null }[] = [
  { label: 'Permanente', ms: null },
  { label: '1h', ms: 1000 * 60 * 60 },
  { label: '6h', ms: 1000 * 60 * 60 * 6 },
  { label: '24h', ms: 1000 * 60 * 60 * 24 },
  { label: '7 dias', ms: 1000 * 60 * 60 * 24 * 7 },
  { label: '30 dias', ms: 1000 * 60 * 60 * 24 * 30 },
];

const STORY_DURATIONS: { label: string; ms: number }[] = [
  { label: '6h', ms: 1000 * 60 * 60 * 6 },
  { label: '12h', ms: 1000 * 60 * 60 * 12 },
  { label: '24h', ms: 1000 * 60 * 60 * 24 },
  { label: '48h', ms: 1000 * 60 * 60 * 48 },
];

interface SocialFeedViewProps {
  currentUser: UserProfile;
  profiles: Record<string, UserProfile>;
  posts: SocialPost[];
  stories: StoryItem[];
  highlights: HighlightCollection[];
  followRelations: FollowRelation[];
  blockedUserIds: string[];
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCreatePost: (post: Omit<SocialPost, 'id' | 'timestamp' | 'likedBy' | 'savedBy' | 'repostedBy' | 'comments'>) => void;
  onEditPost: (postId: string, patch: Partial<SocialPost>) => void;
  onDeletePost: (postId: string) => void;
  onCreateStory: (story: Omit<StoryItem, 'id' | 'timestamp' | 'expiresAt' | 'viewedBy'> & { durationMs?: number }) => void;
  onDeleteStory: (storyId: string) => void;
  onToggleLikePost: (postId: string) => void;
  onToggleRepost: (postId: string) => void;
  onToggleSavePost: (postId: string) => void;
  onAddComment: (postId: string, text: string) => void;
  onSharePostToChat: (post: SocialPost) => void;
  onMarkStoryViewed: (storyId: string) => void;
  onPinStoryToHighlight: (storyId: string, highlightTitle: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenSearch: () => void;
  onRequestFollow: (targetUserId: string) => void;
  onRespondFollow: (fromUserId: string, accept: boolean) => void;
}

export const SocialFeedView: React.FC<SocialFeedViewProps> = ({
  currentUser,
  profiles,
  posts,
  stories,
  followRelations,
  blockedUserIds,
  isFullscreen = false,
  onToggleFullscreen,
  onCreatePost,
  onEditPost,
  onDeletePost,
  onCreateStory,
  onDeleteStory,
  onToggleLikePost,
  onToggleRepost,
  onToggleSavePost,
  onAddComment,
  onSharePostToChat,
  onMarkStoryViewed,
  onPinStoryToHighlight,
  onOpenProfile,
  onOpenSearch,
  onRequestFollow,
  onRespondFollow,
}) => {
  const [showComposer, setShowComposer] = useState<'post' | 'story' | null>(null);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [confirmDeleteStoryId, setConfirmDeleteStoryId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [composerTab, setComposerTab] = useState<'media' | 'text'>('media');
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string>('');
  const [selectedMediaType, setSelectedMediaType] = useState<'image' | 'video'>('image');
  const [selectedFilter, setSelectedFilter] = useState<ImageFilterId>('original');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [caption, setCaption] = useState('');
  const [postDuration, setPostDuration] = useState(POST_DURATIONS[0]);
  const [storyDuration, setStoryDuration] = useState(STORY_DURATIONS[2]);
  const [textCardBg, setTextCardBg] = useState(TEXT_CARD_BACKGROUNDS[0].cls);
  const [textCardAlign, setTextCardAlign] = useState<'left' | 'center'>('center');

  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [activeStoryAuthorId, setActiveStoryAuthorId] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [highlightPromptTitle, setHighlightPromptTitle] = useState('');
  const [showHighlightInput, setShowHighlightInput] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const pendingIncoming = useMemo(
    () =>
      followRelations.filter(
        (r) => r.toUserId === currentUser.id && r.status === 'pending' && !isUserBlocked(r.fromUserId, blockedUserIds)
      ),
    [followRelations, currentUser.id, blockedUserIds]
  );

  const visiblePosts = useMemo(() => {
    return posts
      .filter((p) => {
        if (!isPostActive(p, nowTick)) return false;
        if (isUserBlocked(p.authorId, blockedUserIds)) return false;
        const author = profiles[p.authorId];
        if (!author) return false;
        return canViewPrivateProfileContent(currentUser.id, author, followRelations);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [posts, profiles, currentUser.id, followRelations, blockedUserIds, nowTick]);

  const discoverProfiles = useMemo(() => {
    return Object.values(profiles).filter((prof) => {
      if (prof.id === currentUser.id || isUserBlocked(prof.id, blockedUserIds)) return false;
      const status = getFollowStatus(currentUser.id, prof.id, followRelations);
      return status !== 'accepted';
    });
  }, [profiles, currentUser.id, followRelations, blockedUserIds]);

  // Active thought bubbles from accepted followers / self
  const activeThoughts = useMemo(() => {
    return Object.values(profiles).filter((prof) => {
      if (isUserBlocked(prof.id, blockedUserIds)) return false;
      if (!isThoughtActive(prof.thoughtBubble, nowTick)) return false;
      return canViewPrivateProfileContent(currentUser.id, prof, followRelations);
    });
  }, [profiles, currentUser.id, followRelations, blockedUserIds, nowTick]);

  const storiesByAuthor = useMemo(() => {
    const now = nowTick;
    const map = new Map<string, StoryItem[]>();
    for (const st of stories) {
      if (st.expiresAt < now) continue;
      if (isUserBlocked(st.authorId, blockedUserIds)) continue;
      const author = profiles[st.authorId];
      if (!author) continue;
      if (!canViewPrivateProfileContent(currentUser.id, author, followRelations)) continue;
      const arr = map.get(st.authorId) || [];
      arr.push(st);
      map.set(st.authorId, arr);
    }
    return map;
  }, [stories, profiles, currentUser.id, followRelations, blockedUserIds, nowTick]);

  const activeAuthorStories = useMemo(() => {
    if (!activeStoryAuthorId) return [];
    return storiesByAuthor.get(activeStoryAuthorId) || [];
  }, [activeStoryAuthorId, storiesByAuthor]);

  const currentStory = activeAuthorStories[activeStoryIndex];

  useEffect(() => {
    if (!currentStory) return;
    onMarkStoryViewed(currentStory.id);
    const timer = window.setTimeout(() => {
      if (activeStoryIndex + 1 < activeAuthorStories.length) {
        setActiveStoryIndex((i) => i + 1);
      } else {
        setActiveStoryAuthorId(null);
      }
    }, 5200);
    return () => window.clearTimeout(timer);
  }, [currentStory, activeStoryIndex, activeAuthorStories.length, onMarkStoryViewed]);

  // Mention autocomplete detection in caption
  const mentionQuery = useMemo(() => {
    const match = caption.match(/@([a-zA-Z0-9._]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [caption]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    return Object.values(profiles).filter(
      (p) =>
        p.handle.toLowerCase().includes(mentionQuery) ||
        p.name.toLowerCase().includes(mentionQuery)
    );
  }, [mentionQuery, profiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedMediaUrl(String(reader.result || ''));
      setSelectedMediaType(isVideo ? 'video' : 'image');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const resetComposer = () => {
    setShowComposer(null);
    setEditingPost(null);
    setSelectedMediaUrl('');
    setSelectedFilter('original');
    setBrightness(100);
    setContrast(100);
    setCaption('');
    setPostDuration(POST_DURATIONS[0]);
    setStoryDuration(STORY_DURATIONS[2]);
  };

  const openEditPost = (post: SocialPost) => {
    setEditingPost(post);
    setComposerTab(post.kind);
    setSelectedMediaUrl(post.mediaUrl || '');
    setSelectedMediaType(post.mediaType || 'image');
    setSelectedFilter(post.filterId || 'original');
    setCaption(post.caption);
    setTextCardBg(post.textCardBg || TEXT_CARD_BACKGROUNDS[0].cls);
    setTextCardAlign(post.textCardAlign || 'center');
    const foundDur = POST_DURATIONS.find((d) => d.label === post.durationLabel) || POST_DURATIONS[0];
    setPostDuration(foundDur);
    setShowComposer('post');
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (composerTab === 'media' && !selectedMediaUrl) return;
    if (composerTab === 'text' && !caption.trim()) return;

    let finalMediaUrl = selectedMediaUrl;
    if (
      composerTab === 'media' &&
      selectedMediaType === 'image' &&
      selectedMediaUrl &&
      (!editingPost || selectedMediaUrl !== editingPost.mediaUrl || selectedFilter !== editingPost.filterId || brightness !== 100 || contrast !== 100)
    ) {
      finalMediaUrl = await applyFilterToImageDataUrl(
        selectedMediaUrl,
        selectedFilter,
        brightness,
        contrast
      );
    }

    if (editingPost) {
      if (canEditPost(editingPost, currentUser.id)) {
        onEditPost(editingPost.id, {
          kind: composerTab,
          mediaUrl: composerTab === 'media' ? finalMediaUrl : undefined,
          mediaType: composerTab === 'media' ? selectedMediaType : undefined,
          filterId: selectedFilter,
          textCardBg: composerTab === 'text' ? textCardBg : undefined,
          textCardAlign: composerTab === 'text' ? textCardAlign : undefined,
          caption: caption.trim(),
          expiresAt: postDuration.ms ? editingPost.timestamp + postDuration.ms : undefined,
          durationLabel: postDuration.label,
        });
      }
    } else if (showComposer === 'post') {
      onCreatePost({
        authorId: currentUser.id,
        kind: composerTab,
        mediaUrl: composerTab === 'media' ? finalMediaUrl : undefined,
        mediaType: composerTab === 'media' ? selectedMediaType : undefined,
        filterId: selectedFilter,
        textCardBg: composerTab === 'text' ? textCardBg : undefined,
        textCardAlign: composerTab === 'text' ? textCardAlign : undefined,
        caption: caption.trim(),
        expiresAt: postDuration.ms ? Date.now() + postDuration.ms : undefined,
        durationLabel: postDuration.label,
      });
    } else if (showComposer === 'story') {
      onCreateStory({
        authorId: currentUser.id,
        kind: composerTab === 'media' ? 'image' : 'text',
        mediaUrl: composerTab === 'media' ? finalMediaUrl : undefined,
        filterId: selectedFilter,
        text: caption.trim() || undefined,
        bgGradient: composerTab === 'text' ? textCardBg : undefined,
        durationLabel: storyDuration.label,
        durationMs: storyDuration.ms,
      });
    }

    resetComposer();
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-950 scrollbar-thin">
      <div className="max-w-2xl mx-auto px-4 py-5 pb-28 sm:pb-12 space-y-6">
        {/* Floating iOS 27 Glass Header */}
        <header className="sticky top-3 z-20 px-4 py-3 rounded-full bg-white/80 dark:bg-zinc-900/75 backdrop-blur-2xl border border-zinc-200/80 dark:border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.08)] flex items-center justify-between gap-2">
          <div className="pl-1">
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight">Feed Privado</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Usar em tela cheia'}
                title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                className="w-9 h-9 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:scale-[1.03] active:scale-95 flex items-center justify-center text-zinc-700 dark:text-zinc-200 transition-all cursor-pointer"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Buscar pessoas"
              title="Buscar pessoas"
              className="w-9 h-9 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:scale-[1.03] active:scale-95 flex items-center justify-center text-zinc-700 dark:text-zinc-200 transition-all cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setComposerTab('media');
                setShowComposer('story');
              }}
              className="min-h-[36px] px-3 py-1.5 rounded-full bg-zinc-100/90 dark:bg-zinc-800/90 hover:scale-[1.02] active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Story</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingPost(null);
                setComposerTab('media');
                setShowComposer('post');
              }}
              className="min-h-[36px] px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md active:scale-95 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Publicar</span>
            </button>
          </div>
        </header>

        {/* Pending Follow Requests Banner */}
        {pendingIncoming.length > 0 && (
          <section className="rounded-[24px] bg-white/85 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 p-4 space-y-3">
            <h2 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Solicitações para seguir você ({pendingIncoming.length})
            </h2>
            <div className="space-y-2.5">
              {pendingIncoming.map((req) => {
                const requester = profiles[req.fromUserId];
                if (!requester) return null;
                return (
                  <div
                    key={req.fromUserId}
                    className="flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(requester.id)}
                      className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                    >
                      <Avatar src={requester.avatarUrl} name={requester.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{requester.name}</p>
                        <p className="text-xs text-zinc-500 truncate">@{requester.handle}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRespondFollow(requester.id, false)}
                        className="px-3.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium cursor-pointer"
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        onClick={() => onRespondFollow(requester.id, true)}
                        className="px-3.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold cursor-pointer"
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

        {/* Stories & Thought Balloons Strip */}
        <section aria-label="Stories e pensamentos do grupo" className="flex items-start gap-4 overflow-x-auto pt-2 pb-2 scrollbar-thin">
          <button
            type="button"
            onClick={() => {
              setComposerTab('media');
              setShowComposer('story');
            }}
            className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <div className="relative">
              <Avatar src={currentUser.avatarUrl} name={currentUser.name} size="lg" />
              <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-blue-600 text-white border-2 border-zinc-50 dark:border-zinc-950 flex items-center justify-center shadow">
                <Plus className="w-3.5 h-3.5" />
              </span>
            </div>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Seu Story</span>
          </button>

          {Array.from(storiesByAuthor.entries()).map(([authorId, authorStories]) => {
            const author = profiles[authorId];
            if (!author) return null;
            const allViewed = authorStories.every((s) => s.viewedBy.includes(currentUser.id));
            return (
              <button
                key={authorId}
                type="button"
                onClick={() => {
                  setActiveStoryAuthorId(authorId);
                  setActiveStoryIndex(0);
                  setShowHighlightInput(false);
                }}
                className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Avatar
                  src={author.avatarUrl}
                  name={author.name}
                  size="lg"
                  hasStory
                  storyViewed={allViewed}
                />
                <span className="text-xs font-medium max-w-[70px] truncate">
                  {authorId === currentUser.id ? 'Você' : author.name.split(' ')[0]}
                </span>
              </button>
            );
          })}

          {activeThoughts.map((prof) => (
            <button
              key={`thought-${prof.id}`}
              type="button"
              onClick={() => onOpenProfile(prof.id)}
              className="flex flex-col items-center gap-1.5 shrink-0 max-w-[110px] cursor-pointer"
            >
              <div className="px-3 py-2 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm text-left">
                <p className="text-[11px] font-medium line-clamp-2 leading-tight">
                  {prof.thoughtBubble?.emoji} {prof.thoughtBubble?.text}
                </p>
              </div>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[90px]">
                @{prof.handle}
              </span>
            </button>
          ))}
        </section>

        {/* Private Profiles Discovery */}
        {discoverProfiles.length > 0 && (
          <section className="rounded-[24px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Perfis privados no grupo
              </h2>
              <Lock className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {discoverProfiles.map((prof) => {
                const status = getFollowStatus(currentUser.id, prof.id, followRelations);
                return (
                  <div
                    key={prof.id}
                    className="flex items-center justify-between gap-2.5 p-2.5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-950/70 border border-zinc-200/70 dark:border-zinc-800"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(prof.id)}
                      className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                    >
                      <Avatar src={prof.avatarUrl} name={prof.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{prof.name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">@{prof.handle}</p>
                      </div>
                    </button>
                    {status === 'pending' ? (
                      <span className="px-3 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 shrink-0">
                        Solicitado
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequestFollow(prof.id)}
                        className="px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                      >
                        Pedir para seguir
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Posts Feed */}
        <div className="space-y-6">
          {visiblePosts.length === 0 ? (
            <div className="rounded-[28px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 mx-auto flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h2 className="font-display text-base font-bold">Seu feed privado está pronto</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
                Cada usuário conectado possui seu próprio perfil, stories e publicações individuais. Publique algo ou conecte-se com outras pessoas pelo @ ou código.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPost(null);
                    setComposerTab('media');
                    setShowComposer('post');
                  }}
                  className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Criar primeira publicação
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposerTab('text');
                    setShowComposer('story');
                  }}
                  className="px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold cursor-pointer"
                >
                  Publicar Story
                </button>
              </div>
            </div>
          ) : (
            visiblePosts.map((post) => {
            const author = profiles[post.authorId];
            if (!author) return null;
            const liked = post.likedBy.includes(currentUser.id);
            const saved = post.savedBy.includes(currentUser.id);
            const reposted = (post.repostedBy || []).includes(currentUser.id);
            const repostNames = (post.repostedBy || [])
              .map((uid) => profiles[uid]?.handle)
              .filter(Boolean);

            return (
              <article
                key={post.id}
                className="rounded-[28px] bg-white/85 dark:bg-zinc-900/75 backdrop-blur-xl border border-zinc-200/80 dark:border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.05)] overflow-hidden"
              >
                {repostNames.length > 0 && (
                  <div className="px-4 pt-3 pb-0 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Repeat2 className="w-3.5 h-3.5" />
                    <span>Republicado por @{repostNames[0]}{repostNames.length > 1 ? ` e +${repostNames.length - 1}` : ''}</span>
                  </div>
                )}

                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenProfile(author.id)}
                    className="flex items-center gap-3 text-left cursor-pointer min-w-0"
                  >
                    <Avatar src={author.avatarUrl} name={author.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate">{author.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        @{author.handle} ·{' '}
                        {new Date(post.timestamp).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}
                        {post.editedAt && ' · Editado'}
                        {post.expiresAt && post.durationLabel && ` · ${post.durationLabel}`}
                      </p>
                    </div>
                  </button>

                  {post.authorId === currentUser.id && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canEditPost(post, currentUser.id, nowTick) && (
                        <button
                          type="button"
                          onClick={() => openEditPost(post)}
                          title="Editar publicação (disponível por 5 minutos)"
                          className="px-2.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3 text-blue-500" />
                          <span>
                            {Math.max(1, Math.ceil(getPostEditRemainingMs(post, nowTick) / 60000))}m
                          </span>
                        </button>
                      )}
                      {confirmDeletePostId === post.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            onDeletePost(post.id);
                            setConfirmDeletePostId(null);
                          }}
                          className="px-2.5 py-1.5 rounded-full bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Confirmar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePostId(post.id)}
                          aria-label="Apagar publicação"
                          title="Apagar publicação"
                          className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-500/15 text-zinc-500 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {post.kind === 'media' && post.mediaUrl ? (
                  <div
                    onDoubleClick={() => {
                      if (!liked) onToggleLikePost(post.id);
                    }}
                    className="bg-black flex items-center justify-center max-h-[520px] overflow-hidden"
                  >
                    {post.mediaType === 'video' ? (
                      <video src={post.mediaUrl} controls className="w-full max-h-[520px]" />
                    ) : (
                      <img
                        src={post.mediaUrl}
                        alt={post.caption || `Post de ${author.name}`}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-[520px] object-cover"
                      />
                    )}
                  </div>
                ) : (
                  <div
                    onDoubleClick={() => {
                      if (!liked) onToggleLikePost(post.id);
                    }}
                    className={`px-8 py-14 bg-gradient-to-br ${
                      post.textCardBg || TEXT_CARD_BACKGROUNDS[0].cls
                    } text-white flex items-center ${
                      post.textCardAlign === 'left' ? 'justify-start text-left' : 'justify-center text-center'
                    }`}
                  >
                    <p className="font-display text-xl sm:text-2xl font-semibold leading-snug max-w-lg text-balance">
                      <MentionText
                        text={post.caption}
                        profiles={profiles}
                        onMentionClick={onOpenProfile}
                      />
                    </p>
                  </div>
                )}

                <div className="px-4 pt-3 pb-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleLikePost(post.id)}
                        aria-label={liked ? 'Descurtir publicação' : 'Curtir publicação'}
                        className="min-w-[40px] min-h-[40px] px-2.5 flex items-center justify-center gap-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        <Heart
                          className={`w-5 h-5 transition-colors ${
                            liked ? 'fill-rose-500 text-rose-500' : 'text-zinc-700 dark:text-zinc-300'
                          }`}
                        />
                        <span className="font-mono text-xs">{post.likedBy.length}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleRepost(post.id)}
                        aria-label={reposted ? 'Desfazer republicação' : 'Repostar publicação'}
                        className={`min-w-[40px] min-h-[40px] px-2.5 flex items-center justify-center gap-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
                          reposted ? 'text-emerald-500' : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <Repeat2 className="w-5 h-5" />
                        <span className="font-mono text-xs">{(post.repostedBy || []).length}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSharePostToChat(post)}
                        aria-label="Compartilhar publicação no chat"
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleSavePost(post.id)}
                      aria-label={saved ? 'Remover dos salvos' : 'Salvar publicação'}
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <Bookmark
                        className={`w-5 h-5 ${
                          saved ? 'fill-zinc-900 dark:fill-white text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      />
                    </button>
                  </div>

                  {post.kind === 'media' && post.caption && (
                    <p className="text-sm leading-relaxed">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(author.id)}
                        className="font-semibold mr-1.5 hover:underline cursor-pointer"
                      >
                        @{author.handle}
                      </button>
                      <MentionText
                        text={post.caption}
                        profiles={profiles}
                        onMentionClick={onOpenProfile}
                      />
                    </p>
                  )}

                  {post.comments.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {post.comments.map((cmt) => (
                        <p key={cmt.id} className="text-xs text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => onOpenProfile(cmt.authorId)}
                            className="font-semibold mr-1.5 hover:underline cursor-pointer"
                          >
                            @{cmt.authorHandle}
                          </button>
                          <MentionText
                            text={cmt.text}
                            profiles={profiles}
                            onMentionClick={onOpenProfile}
                          />
                        </p>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const val = (commentInputs[post.id] || '').trim();
                      if (!val) return;
                      onAddComment(post.id, val);
                      setCommentInputs((prev) => ({ ...prev, [post.id]: '' }));
                    }}
                    className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <MessageCircle className="w-4 h-4 text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      value={commentInputs[post.id] || ''}
                      onChange={(e) =>
                        setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                      }
                      placeholder="Comentar ou mencionar com @..."
                      className="flex-1 bg-transparent text-xs py-1.5 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline px-2 py-1 cursor-pointer"
                    >
                      Enviar
                    </button>
                  </form>
                </div>
              </article>
            );
          })
          )}
        </div>
      </div>

      {/* Story Fullscreen Viewer */}
      {currentStory && activeStoryAuthorId && (
        <div
          role="dialog"
          aria-label="Visualizador de Story"
          className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center p-0 sm:p-6"
        >
          <div className="relative w-full h-full sm:max-w-md sm:h-[85vh] sm:rounded-[32px] overflow-hidden bg-zinc-950 flex flex-col justify-between">
            <div className="relative z-20 p-4 bg-gradient-to-b from-black/70 to-transparent space-y-3">
              <div className="flex items-center gap-1.5">
                {activeAuthorStories.map((st, idx) => (
                  <div key={st.id} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
                    <div
                      className={`h-full bg-white transition-all ${
                        idx < activeStoryIndex
                          ? 'w-full'
                          : idx === activeStoryIndex
                          ? 'w-full duration-[5000ms] ease-linear'
                          : 'w-0'
                      }`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    src={profiles[activeStoryAuthorId]?.avatarUrl}
                    name={profiles[activeStoryAuthorId]?.name || 'Usuário'}
                    size="sm"
                  />
                  <div>
                    <p className="text-xs font-semibold">
                      {profiles[activeStoryAuthorId]?.name}
                    </p>
                    <p className="text-[11px] text-white/70">
                      {new Date(currentStory.timestamp).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentStory.authorId === currentUser.id && (
                    confirmDeleteStoryId === currentStory.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteStory(currentStory.id);
                          setConfirmDeleteStoryId(null);
                          if (activeAuthorStories.length <= 1) {
                            setActiveStoryAuthorId(null);
                          } else {
                            setActiveStoryIndex((i) => Math.max(0, i - 1));
                          }
                        }}
                        className="px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                      >
                        Confirmar exclusão
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteStoryId(currentStory.id)}
                        aria-label="Apagar story"
                        title="Apagar meu story"
                        className="w-10 h-10 rounded-full bg-rose-500/20 hover:bg-rose-600 text-white flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteStoryId(null);
                      setActiveStoryAuthorId(null);
                    }}
                    aria-label="Fechar story"
                    className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="absolute inset-0 flex items-center justify-center">
              {currentStory.kind === 'image' && currentStory.mediaUrl ? (
                <img
                  src={currentStory.mediaUrl}
                  alt={currentStory.text || 'Story'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className={`w-full h-full bg-gradient-to-br ${
                    currentStory.bgGradient || TEXT_CARD_BACKGROUNDS[0].cls
                  } flex items-center justify-center p-8 text-center`}
                >
                  <p className="font-display text-2xl font-semibold">{currentStory.text}</p>
                </div>
              )}
              {currentStory.kind === 'image' && currentStory.text && (
                <div className="absolute bottom-24 inset-x-6 text-center">
                  <span className="inline-block px-4 py-2 rounded-2xl bg-black/60 backdrop-blur-md text-sm font-medium">
                    {currentStory.text}
                  </span>
                </div>
              )}
            </div>

            <div className="relative z-10 flex-1 flex items-center justify-between px-2">
              <button
                type="button"
                aria-label="Story anterior"
                onClick={() => setActiveStoryIndex((i) => Math.max(0, i - 1))}
                className="w-12 h-32 flex items-center justify-start opacity-70 hover:opacity-100"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                aria-label="Próximo story"
                onClick={() => {
                  if (activeStoryIndex + 1 < activeAuthorStories.length) {
                    setActiveStoryIndex((i) => i + 1);
                  } else {
                    setActiveStoryAuthorId(null);
                  }
                }}
                className="w-12 h-32 flex items-center justify-end opacity-70 hover:opacity-100"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            <div className="relative z-20 p-4 bg-gradient-to-t from-black/80 to-transparent space-y-2">
              {currentStory.durationLabel && (
                <p className="text-center text-[11px] text-white/65 font-mono">
                  Story · Duração {currentStory.durationLabel}
                </p>
              )}
              {currentStory.authorId === currentUser.id ? (
                showHighlightInput ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!highlightPromptTitle.trim()) return;
                      onPinStoryToHighlight(currentStory.id, highlightPromptTitle.trim());
                      setHighlightPromptTitle('');
                      setShowHighlightInput(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={highlightPromptTitle}
                      onChange={(e) => setHighlightPromptTitle(e.target.value)}
                      placeholder="Nome do destaque (ex: Viagens)"
                      className="flex-1 px-3 py-2 rounded-full bg-white/15 border border-white/20 text-xs text-white placeholder:text-white/60 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-full bg-blue-600 text-xs font-semibold cursor-pointer"
                    >
                      Salvar
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowHighlightInput(true)}
                    className="w-full py-2.5 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-xs font-semibold cursor-pointer"
                  >
                    + Fixar nos Destaques do perfil
                  </button>
                )
              ) : (
                <p className="text-center text-xs text-white/70">
                  Toque nas laterais para avançar ou voltar
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Post / Story Creator Modal */}
      {showComposer && (
        <div
          role="dialog"
          aria-label={showComposer === 'post' ? 'Criar publicação' : 'Criar story'}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
        >
          <form
            onSubmit={handlePublish}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[28px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 p-5 sm:p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">
                {editingPost
                  ? 'Editar publicação (janela de 5 min)'
                  : showComposer === 'post'
                  ? 'Nova publicação no perfil'
                  : `Novo Story (${storyDuration.label})`}
              </h2>
              <button
                type="button"
                onClick={resetComposer}
                aria-label="Fechar criador"
                className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setComposerTab('media')}
                className={`py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  composerTab === 'media'
                    ? 'bg-white dark:bg-zinc-900 shadow-xs'
                    : 'text-zinc-500'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span>Foto / Vídeo + Filtros</span>
              </button>
              <button
                type="button"
                onClick={() => setComposerTab('text')}
                className={`py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  composerTab === 'text'
                    ? 'bg-white dark:bg-zinc-900 shadow-xs'
                    : 'text-zinc-500'
                }`}
              >
                <Type className="w-4 h-4" />
                <span>Post de Texto</span>
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {composerTab === 'media' ? (
              <div className="space-y-3">
                {selectedMediaUrl ? (
                  <div className="relative rounded-2xl overflow-hidden bg-black max-h-60 flex items-center justify-center">
                    {selectedMediaType === 'video' ? (
                      <video src={selectedMediaUrl} controls className="max-h-60 w-full" />
                    ) : (
                      <img
                        src={selectedMediaUrl}
                        alt="Prévia com filtro"
                        style={{
                          filter: `${
                            getCssFilter(selectedFilter) === 'none'
                              ? ''
                              : getCssFilter(selectedFilter)
                          } brightness(${brightness}%) contrast(${contrast}%)`.trim(),
                        }}
                        className="max-h-60 w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedMediaUrl('')}
                      className="absolute top-2 right-2 px-3 py-1 rounded-full bg-black/70 text-white text-xs"
                    >
                      Trocar mídia
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full h-36 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 flex flex-col items-center justify-center gap-2 text-zinc-500 dark:text-zinc-400 cursor-pointer"
                  >
                    <ImageIcon className="w-7 h-7" />
                    <span className="text-xs font-medium">Clique para escolher foto ou vídeo</span>
                  </button>
                )}

                {selectedMediaUrl && selectedMediaType === 'image' && (
                  <div className="space-y-3">
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                      {IMAGE_FILTERS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setSelectedFilter(preset.id)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium shrink-0 cursor-pointer ${
                            selectedFilter === preset.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <label className="space-y-1">
                        <span className="text-zinc-500">Brilho ({brightness}%)</span>
                        <input
                          type="range"
                          min={70}
                          max={130}
                          value={brightness}
                          onChange={(e) => setBrightness(Number(e.target.value))}
                          className="w-full accent-blue-600"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-zinc-500">Contraste ({contrast}%)</span>
                        <input
                          type="range"
                          min={75}
                          max={135}
                          value={contrast}
                          onChange={(e) => setContrast(Number(e.target.value))}
                          className="w-full accent-blue-600"
                        />
                      </label>
                    </div>
                  </div>
                )}

                <textarea
                  rows={2}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escreva uma legenda ou mencione com @..."
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  className={`rounded-2xl p-6 min-h-[140px] bg-gradient-to-br ${textCardBg} text-white flex items-center ${
                    textCardAlign === 'left' ? 'justify-start text-left' : 'justify-center text-center'
                  }`}
                >
                  <p className="font-display text-lg font-semibold">
                    {caption.trim() || 'Sua mensagem aparecerá aqui...'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1.5">
                    {TEXT_CARD_BACKGROUNDS.map((bg) => (
                      <button
                        key={bg.id}
                        type="button"
                        onClick={() => setTextCardBg(bg.cls)}
                        aria-label={`Fundo ${bg.label}`}
                        className={`w-7 h-7 rounded-full bg-gradient-to-br ${bg.cls} border-2 ${
                          textCardBg === bg.cls ? 'border-blue-500 scale-110' : 'border-transparent'
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setTextCardAlign((a) => (a === 'center' ? 'left' : 'center'))
                    }
                    className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium"
                  >
                    Alinhamento: {textCardAlign === 'center' ? 'Centro' : 'Esquerda'}
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Digite o texto ou mencione alguém com @..."
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none"
                />
              </div>
            )}

            {/* Mention Autocomplete inside Composer */}
            {mentionCandidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                {mentionCandidates.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setCaption((prev) => prev.replace(/@([a-zA-Z0-9._]*)$/, `@${p.handle} `))
                    }
                    className="px-2.5 py-1 rounded-full bg-white dark:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>@{p.handle}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Post or Story Duration Selector */}
            {showComposer === 'post' ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Tempo que a publicação ficará ativa</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {POST_DURATIONS.map((dur) => (
                    <button
                      key={dur.label}
                      type="button"
                      onClick={() => setPostDuration(dur)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                        postDuration.label === dur.label
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {dur.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Duração do Story</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STORY_DURATIONS.map((dur) => (
                    <button
                      key={dur.label}
                      type="button"
                      onClick={() => setStoryDuration(dur)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                        storyDuration.label === dur.label
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {dur.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={resetComposer}
                className="px-4 py-2 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                {editingPost ? 'Salvar alterações' : 'Publicar agora'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
