import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Compass,
  KeyRound,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Moon,
  PhoneIncoming,
  Plus,
  Search,
  Server,
  Settings,
  Sun,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  ActiveCallState,
  BubbleEffect,
  ChatAttachment,
  ChatMessage,
  ContactPreference,
  FollowRelation,
  GroupConfig,
  HighlightCollection,
  PeerNode,
  ScreenEffect,
  SocialPost,
  StickerItem,
  StoryItem,
  TapbackEmoji,
  TextStyleType,
  ThoughtBubble,
  UnreadRoomInfo,
  UserProfile,
} from './types/app';
import { createInitialSnapshot, DEFAULT_ROOM_CODE } from './data/seedData';
import {
  clearLocalSnapshot,
  loadDeviceVault,
  saveDeviceVault,
  type LocalAppSnapshot,
} from './utils/localStore';
import {
  MAX_ACCOUNTS_PER_DEVICE,
  buildDmRoomCode,
  canCreateAccountOnDevice,
  canDeleteStory,
  canEditPost,
  clearRoomUnread,
  evictOtherProfileCache,
  filterVisibleContacts,
  generateAppUserId,
  generateRoomCode,
  isThoughtActive,
  isUserBlocked,
  leaveOrDeleteGroupFromState,
  mergeMessageHistory,
  normalizeRoomCode,
  recordUnreadMessage,
  removeSavedContact,
  restoreSavedContact,
} from './utils/meshProtocol';
import { RealtimeMeshClient, type MeshEventPayload } from './services/realtimeClient';
import { playUiChime } from './utils/voiceEffects';
import { AccessGate, type AuthRecoveredPayload } from './components/AccessGate';
import { Avatar } from './components/Avatar';
import { ChatView } from './components/ChatView';
import { SocialFeedView } from './components/SocialFeedView';
import { ProfileView } from './components/ProfileView';
import { CallOverlay } from './components/CallOverlay';
import { GroupAdminModal } from './components/GroupAdminModal';
import { SettingsModal, type SettingsTab } from './components/SettingsModal';
import { UserSearchModal } from './components/UserSearchModal';

type ActiveSection = 'profile' | 'chat' | 'feed';
type ConversationFilter = 'all' | 'group' | 'dm';
type SwitcherTab = 'contacts' | 'create' | 'join';

function getOrCreatePeerId(): string {
  try {
    const key = 'pulso_device_peer_id';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `peer-${Date.now().toString(36)}`;
  }
}

/**
 * Safely upgrades any previously saved IndexedDB snapshot with Turn 2 & Turn 3 fields.
 */
function normalizeLoadedSnapshot(raw: LocalAppSnapshot): LocalAppSnapshot {
  const defaults = createInitialSnapshot();

  const fixedCurrentUser: UserProfile = {
    ...defaults.currentUser,
    ...raw.currentUser,
    appId: raw.currentUser.appId || defaults.currentUser.appId || generateAppUserId(),
    accentColor: raw.currentUser.accentColor || '#3b82f6',
    handleEditedCount: raw.currentUser.handleEditedCount ?? 0,
  };

  const fixedProfiles: Record<string, UserProfile> = {};
  for (const [id, prof] of Object.entries(raw.profiles || {})) {
    if (!prof || id === 'user-draft') continue;
    fixedProfiles[id] = {
      ...prof,
      appId: prof.appId || generateAppUserId(),
      accentColor: prof.accentColor || '#3b82f6',
      handleEditedCount: prof.handleEditedCount ?? 0,
    };
  }
  if (fixedCurrentUser.id && fixedCurrentUser.id !== 'user-draft') {
    fixedProfiles[fixedCurrentUser.id] = fixedCurrentUser;
  }

  const fixedGroups: Record<string, GroupConfig> = {};
  for (const [code, grp] of Object.entries(raw.groups || {})) {
    fixedGroups[code] = {
      ...grp,
      kind: grp.kind || 'group',
    };
  }

  const fixedPosts: SocialPost[] = (raw.posts || []).map((p) => ({
    ...p,
    repostedBy: Array.isArray(p.repostedBy) ? p.repostedBy : [],
  }));

  const nextActiveRoomCode =
    raw.activeRoomCode && fixedGroups[raw.activeRoomCode]
      ? raw.activeRoomCode
      : Object.keys(fixedGroups)[0] ?? null;

  return {
    ...defaults,
    ...raw,
    currentUser: fixedCurrentUser,
    profiles: fixedProfiles,
    groups: fixedGroups,
    activeRoomCode: nextActiveRoomCode,
    posts: fixedPosts,
    stories: Array.isArray(raw.stories) ? raw.stories : [],
    stickers: Array.isArray(raw.stickers) ? raw.stickers : defaults.stickers,
    likedPostIds: Array.isArray(raw.likedPostIds) ? raw.likedPostIds : defaults.likedPostIds,
    unreadByRoom: raw.unreadByRoom || {},
    settings: {
      ...defaults.settings,
      ...(raw.settings || {}),
      blockedUserIds: Array.isArray(raw.settings?.blockedUserIds)
        ? raw.settings.blockedUserIds
        : [],
      removedContactIds: Array.isArray(raw.settings?.removedContactIds)
        ? raw.settings.removedContactIds
        : [],
      mutedRoomCodes: Array.isArray(raw.settings?.mutedRoomCodes)
        ? raw.settings.mutedRoomCodes
        : [],
      contactPrefs: raw.settings?.contactPrefs || {},
    },
  };
}

export default function App() {
  const [vaultAccounts, setVaultAccounts] = useState<Record<string, LocalAppSnapshot>>({});
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [hasEnteredApp, setHasEnteredApp] = useState(false);
  const [hasSavedDeviceAccount, setHasSavedDeviceAccount] = useState(false);

  // In-memory only session token for authenticated account recovery & sync (never stored in Web Storage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  // Every session starts in "Meu Perfil"
  const [activeSection, setActiveSection] = useState<ActiveSection>('profile');
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [viewedProfileCache, setViewedProfileCache] = useState<Record<string, SocialPost[]>>({});
  const [loadingProfilePosts, setLoadingProfilePosts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting'
  >('connecting');
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  const [showGroupAdmin, setShowGroupAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('profile');
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showRoomSwitcher, setShowRoomSwitcher] = useState(false);
  const [switcherTab, setSwitcherTab] = useState<SwitcherTab>('contacts');
  const [inviteRoomCode, setInviteRoomCode] = useState<string>(DEFAULT_ROOM_CODE);
  const [confirmRemoveContactId, setConfirmRemoveContactId] = useState<string | null>(null);
  const [confirmRemoveGroupCode, setConfirmRemoveGroupCode] = useState<string | null>(null);
  const [newRoomCodeInput, setNewRoomCodeInput] = useState('');
  const [newGroupNameInput, setNewGroupNameInput] = useState('');
  const [newGroupCodeInput, setNewGroupCodeInput] = useState(() => generateRoomCode('PLS'));

  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    mode: 'audio' | 'video';
    callerName: string;
    callerAvatar: string;
  } | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const peerId = useMemo(() => getOrCreatePeerId(), []);
  const meshRef = useRef<RealtimeMeshClient | null>(null);

  const snapshot = activeAccountId ? vaultAccounts[activeAccountId] || null : null;
  const snapshotRef = useRef<LocalAppSnapshot | null>(null);
  const activeSectionRef = useRef<ActiveSection>('profile');
  const activeRoomCodeRef = useRef<string | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
    activeRoomCodeRef.current = snapshot?.activeRoomCode ?? null;
  }, [snapshot]);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    const handleFsChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        setIsFullscreen(false);
      } else if (el.requestFullscreen) {
        try {
          await el.requestFullscreen({ navigationUI: 'hide' });
        } catch {
          await el.requestFullscreen();
        }
        setIsFullscreen(true);
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
        setIsFullscreen(true);
      } else {
        setIsFullscreen((prev) => !prev);
      }
    } catch {
      // Iframes may restrict native Fullscreen API; fallback CSS edge-to-edge fullscreen fills 100dvh cleanly
      setIsFullscreen((prev) => !prev);
    }
  }, []);

  const setSnapshot = useCallback(
    (
      updater:
        | LocalAppSnapshot
        | null
        | ((prev: LocalAppSnapshot | null) => LocalAppSnapshot | null)
    ) => {
      setVaultAccounts((prevVault) => {
        const currentId = activeAccountId || Object.keys(prevVault)[0];
        if (!currentId) return prevVault;
        const prevSnap = prevVault[currentId] || null;
        const nextSnap = typeof updater === 'function' ? updater(prevSnap) : updater;
        if (!nextSnap) return prevVault;
        return {
          ...prevVault,
          [currentId]: {
            ...nextSnap,
            updatedAt: Date.now(),
          },
        };
      });
    },
    [activeAccountId]
  );

  // Initial load from DeviceVault + URL query checks (?autostart=1 or ?code=...)
  useEffect(() => {
    let mounted = true;
    loadDeviceVault().then((vault) => {
      if (!mounted) return;
      const normalizedAccounts: Record<string, LocalAppSnapshot> = {};

      if (vault && Object.keys(vault.accounts).length > 0) {
        for (const [id, snap] of Object.entries(vault.accounts)) {
          if (id === 'user-draft' || snap.currentUser?.id === 'user-draft') continue;
          normalizedAccounts[id] = normalizeLoadedSnapshot(snap);
        }
      }

      const realIds = Object.keys(normalizedAccounts);
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code');
      const autostart = params.get('autostart') === '1';

      if (urlCode) {
        setInviteRoomCode(normalizeRoomCode(urlCode) || DEFAULT_ROOM_CODE);
      }

      if (realIds.length > 0) {
        setHasSavedDeviceAccount(true);
        const chosenId =
          vault?.activeAccountId && normalizedAccounts[vault.activeAccountId]
            ? vault.activeAccountId
            : realIds[0];
        const active = normalizedAccounts[chosenId];

        if (urlCode) {
          const cleanCode = normalizeRoomCode(urlCode);
          if (cleanCode && !active.groups[cleanCode]) {
            active.groups[cleanCode] = {
              roomCode: cleanCode,
              kind: 'group',
              name: `Grupo ${cleanCode}`,
              description: 'Grupo conectado por código de acesso.',
              avatarUrl: '',
              creatorId: active.currentUser.id,
              hostPeerId: peerId,
              accentColor: 'blue',
              wallpaper: 'minimal',
              allowMedia: true,
              allowCalls: true,
              requireApproval: false,
              createdAt: Date.now(),
            };
            active.messagesByRoom[cleanCode] = [];
          }
          if (cleanCode) active.activeRoomCode = cleanCode;
          setHasEnteredApp(true);
        } else if (autostart || Boolean(vault)) {
          setHasEnteredApp(true);
        }

        setVaultAccounts(normalizedAccounts);
        setActiveAccountId(chosenId);
        setViewedProfileId(active.currentUser.id);
        setActiveSection('profile');
      } else {
        // Fresh device with zero real accounts yet: keep user on AccessGate
        setHasSavedDeviceAccount(false);
        const fresh = normalizeLoadedSnapshot(createInitialSnapshot());
        setVaultAccounts({ [fresh.currentUser.id]: fresh });
        setActiveAccountId(fresh.currentUser.id);
        setViewedProfileId(fresh.currentUser.id);
        setActiveSection('profile');
        setHasEnteredApp(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, [peerId]);

  // Apply Dark / Light class to <html>
  useEffect(() => {
    const theme = snapshot?.settings.theme ?? 'dark';
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [snapshot?.settings.theme]);

  // Persist entire DeviceVault locally only for real authenticated/created accounts
  useEffect(() => {
    if (!hasEnteredApp || !activeAccountId || activeAccountId === 'user-draft') return;
    const realAccounts: Record<string, LocalAppSnapshot> = {};
    for (const [id, snap] of Object.entries(vaultAccounts)) {
      if (id === 'user-draft' || snap.currentUser.id === 'user-draft') continue;
      realAccounts[id] = snap;
    }
    if (Object.keys(realAccounts).length === 0) return;
    saveDeviceVault({
      activeAccountId,
      accounts: realAccounts,
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [vaultAccounts, activeAccountId, hasEnteredApp]);

  // Poll client RTT latency periodically
  useEffect(() => {
    const timer = window.setInterval(() => {
      const ms = meshRef.current?.getLatencyMs();
      if (typeof ms === 'number') setLatencyMs(ms);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const mergeDirectoryProfiles = useCallback(
    (incoming: UserProfile[]) => {
      if (!incoming || incoming.length === 0) return;
      setSnapshot((prev) => {
        if (!prev) return prev;
        const nextProfiles = { ...prev.profiles };
        let changed = false;
        for (const prof of incoming) {
          if (!prof || !prof.id || prof.id === prev.currentUser.id) continue;
          const existing = nextProfiles[prof.id];
          if (
            !existing ||
            existing.name !== prof.name ||
            existing.handle !== prof.handle ||
            existing.avatarUrl !== prof.avatarUrl ||
            existing.bio !== prof.bio ||
            existing.accentColor !== prof.accentColor
          ) {
            nextProfiles[prof.id] = {
              ...existing,
              ...prof,
              accentColor: prof.accentColor || existing?.accentColor || '#3b82f6',
            };
            changed = true;
          }
        }
        return changed ? { ...prev, profiles: nextProfiles } : prev;
      });
    },
    [setSnapshot]
  );

  const applyMeshEvent = useCallback(
    (event: MeshEventPayload) => {
      setSnapshot((prev) => {
        if (!prev) return prev;

        if (event.kind === 'chat:message') {
          const msg = event.message as ChatMessage;
          const existingList = prev.messagesByRoom[msg.roomCode] || [];
          const merged = mergeMessageHistory(existingList, [msg]);
          const mutedRooms = prev.settings.mutedRoomCodes || [];
          const isMutedRoom = mutedRooms.includes(msg.roomCode);
          const isBlockedSender = isUserBlocked(msg.senderId, prev.settings.blockedUserIds);
          if (
            prev.settings.soundEnabled &&
            !prev.settings.dndMode &&
            !isMutedRoom &&
            !isBlockedSender &&
            msg.senderId !== prev.currentUser.id
          ) {
            playUiChime('receive');
          }
          const nextUnread = !isBlockedSender
            ? recordUnreadMessage(
                prev.unreadByRoom || {},
                msg,
                prev.currentUser.id,
                activeRoomCodeRef.current,
                activeSectionRef.current === 'chat'
              )
            : prev.unreadByRoom || {};
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [msg.roomCode]: merged,
            },
            unreadByRoom: nextUnread,
          };
        }

        if (event.kind === 'chat:edit') {
          const list = prev.messagesByRoom[event.roomCode] || [];
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [event.roomCode]: list.map((m) =>
                m.id === event.messageId
                  ? { ...m, text: event.newText, editedAt: event.editedAt }
                  : m
              ),
            },
          };
        }

        if (event.kind === 'chat:delete') {
          const list = prev.messagesByRoom[event.roomCode] || [];
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [event.roomCode]: list.filter((m) => m.id !== event.messageId),
            },
          };
        }

        if (event.kind === 'chat:reaction') {
          const roomCode = prev.activeRoomCode || DEFAULT_ROOM_CODE;
          const list = prev.messagesByRoom[roomCode] || [];
          const updated = list.map((m) => {
            if (m.id !== event.messageId) return m;
            const currentUsers = m.reactions[event.emoji] || [];
            const exists = currentUsers.includes(event.userId);
            const nextUsers = exists
              ? currentUsers.filter((id) => id !== event.userId)
              : [...currentUsers, event.userId];
            return {
              ...m,
              reactions: {
                ...m.reactions,
                [event.emoji]: nextUsers,
              },
            };
          });
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [roomCode]: updated,
            },
          };
        }

        if (event.kind === 'chat:pin') {
          const roomCode = prev.activeRoomCode || DEFAULT_ROOM_CODE;
          const list = prev.messagesByRoom[roomCode] || [];
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [roomCode]: list.map((m) =>
                m.id === event.messageId ? { ...m, pinned: event.pinned } : m
              ),
            },
          };
        }

        if (event.kind === 'chat:poll-vote') {
          const roomCode = prev.activeRoomCode || DEFAULT_ROOM_CODE;
          const list = prev.messagesByRoom[roomCode] || [];
          return {
            ...prev,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [roomCode]: list.map((m) => {
                if (m.id !== event.messageId || !m.poll) return m;
                return {
                  ...m,
                  poll: {
                    ...m.poll,
                    options: m.poll.options.map((opt) => {
                      const cleaned = opt.voterIds.filter((id) => id !== event.userId);
                      if (opt.id === event.optionId) {
                        return { ...opt, voterIds: [...cleaned, event.userId] };
                      }
                      return { ...opt, voterIds: cleaned };
                    }),
                  },
                };
              }),
            },
          };
        }

        if (event.kind === 'group:config') {
          const cfg = event.config as GroupConfig;
          return {
            ...prev,
            groups: {
              ...prev.groups,
              [cfg.roomCode]: {
                ...cfg,
                kind: cfg.kind || 'group',
              },
            },
          };
        }

        if (event.kind === 'profile:update') {
          const incoming = {
            ...event.profile,
            appId:
              event.profile.appId ||
              prev.profiles[event.profile.id]?.appId ||
              generateAppUserId(),
            accentColor: event.profile.accentColor || '#3b82f6',
          };
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [incoming.id]: incoming,
            },
          };
        }

        if (event.kind === 'profile:thought') {
          const target = prev.profiles[event.userId];
          const nextProfiles = target
            ? {
                ...prev.profiles,
                [event.userId]: {
                  ...target,
                  thoughtBubble: event.thoughtBubble,
                },
              }
            : prev.profiles;
          return {
            ...prev,
            currentUser:
              event.userId === prev.currentUser.id
                ? { ...prev.currentUser, thoughtBubble: event.thoughtBubble }
                : prev.currentUser,
            profiles: nextProfiles,
          };
        }

        if (event.kind === 'social:post') {
          const post = {
            ...(event.post as SocialPost),
            repostedBy: Array.isArray((event.post as SocialPost).repostedBy)
              ? (event.post as SocialPost).repostedBy
              : [],
          };
          if (prev.posts.some((p) => p.id === post.id)) return prev;
          return {
            ...prev,
            posts: [post, ...prev.posts],
          };
        }

        if (event.kind === 'social:post-edit') {
          return {
            ...prev,
            posts: prev.posts.map((p) =>
              p.id === event.postId
                ? {
                    ...p,
                    ...(event.patch as Partial<SocialPost>),
                    editedAt: event.editedAt,
                  }
                : p
            ),
          };
        }

        if (event.kind === 'social:post-delete') {
          return {
            ...prev,
            posts: prev.posts.filter((p) => p.id !== event.postId),
          };
        }

        if (event.kind === 'social:post-like') {
          const isCurrentUserAction = event.userId === prev.currentUser.id;
          const currentLikes = new Set(prev.likedPostIds || []);
          if (isCurrentUserAction) {
            if (currentLikes.has(event.postId)) currentLikes.delete(event.postId);
            else currentLikes.add(event.postId);
          }
          return {
            ...prev,
            likedPostIds: isCurrentUserAction ? Array.from(currentLikes) : prev.likedPostIds,
            posts: prev.posts.map((p) => {
              if (p.id !== event.postId) return p;
              const liked = p.likedBy.includes(event.userId);
              return {
                ...p,
                likedBy: liked
                  ? p.likedBy.filter((id) => id !== event.userId)
                  : [...p.likedBy, event.userId],
              };
            }),
          };
        }

        if (event.kind === 'social:repost') {
          return {
            ...prev,
            posts: prev.posts.map((p) => {
              if (p.id !== event.postId) return p;
              const currentReposts = p.repostedBy || [];
              const already = currentReposts.includes(event.userId);
              return {
                ...p,
                repostedBy: already
                  ? currentReposts.filter((id) => id !== event.userId)
                  : [...currentReposts, event.userId],
              };
            }),
          };
        }

        if (event.kind === 'social:post-comment') {
          const cmt = event.comment as SocialPost['comments'][number];
          return {
            ...prev,
            posts: prev.posts.map((p) =>
              p.id === event.postId && !p.comments.some((c) => c.id === cmt.id)
                ? { ...p, comments: [...p.comments, cmt] }
                : p
            ),
          };
        }

        if (event.kind === 'social:story') {
          const st = event.story as StoryItem;
          if (prev.stories.some((s) => s.id === st.id)) return prev;
          return {
            ...prev,
            stories: [st, ...prev.stories],
          };
        }

        if (event.kind === 'social:story-delete') {
          return {
            ...prev,
            stories: prev.stories.filter((s) => s.id !== event.storyId),
          };
        }

        if (event.kind === 'social:follow-request') {
          const rel = event.relation as FollowRelation;
          const exists = prev.followRelations.some(
            (r) => r.fromUserId === rel.fromUserId && r.toUserId === rel.toUserId
          );
          if (exists) return prev;
          return {
            ...prev,
            followRelations: [...prev.followRelations, rel],
          };
        }

        if (event.kind === 'social:follow-respond') {
          return {
            ...prev,
            followRelations:
              event.status === 'accepted'
                ? prev.followRelations.map((r) =>
                    r.fromUserId === event.fromUserId && r.toUserId === event.toUserId
                      ? { ...r, status: 'accepted' }
                      : r
                  )
                : prev.followRelations.filter(
                    (r) => !(r.fromUserId === event.fromUserId && r.toUserId === event.toUserId)
                  ),
          };
        }

        return prev;
      });
    },
    [setSnapshot]
  );

  const activeRoomCode = snapshot?.activeRoomCode ?? null;
  const currentUserId = snapshot?.currentUser.id ?? null;

  const syncAccountToServer = useCallback(
    async (payload: {
      profile?: Partial<UserProfile>;
      stickers?: StickerItem[];
      likedPostIds?: string[];
      settings?: Partial<LocalAppSnapshot['settings']>;
    }) => {
      const token = authTokenRef.current;
      if (!token) return;
      try {
        await fetch('/api/auth/account', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        // Offline P2P fallback continues saving locally in DeviceVault
      }
    },
    []
  );

  // Clear unread counter when viewing the active conversation in Chat
  useEffect(() => {
    if (activeSection !== 'chat' || !activeRoomCode) return;
    setSnapshot((prev) => {
      if (!prev || !prev.unreadByRoom || !(activeRoomCode in prev.unreadByRoom)) return prev;
      return {
        ...prev,
        unreadByRoom: clearRoomUnread(prev.unreadByRoom, activeRoomCode),
      };
    });
  }, [activeSection, activeRoomCode, setSnapshot]);

  // On-demand profile post loader & automatic viewer cache eviction on profile exit
  useEffect(() => {
    if (!hasEnteredApp || !currentUserId) return;
    const isViewingOtherProfile =
      activeSection === 'profile' && Boolean(viewedProfileId) && viewedProfileId !== currentUserId;

    if (!isViewingOtherProfile || !viewedProfileId) {
      setViewedProfileCache((prev) =>
        evictOtherProfileCache(prev, null, currentUserId)
      );
      setLoadingProfilePosts(false);
      return;
    }

    let cancelled = false;
    setLoadingProfilePosts(true);
    setViewedProfileCache((prev) =>
      evictOtherProfileCache(prev, viewedProfileId, currentUserId)
    );

    fetch(`/api/posts?authorId=${encodeURIComponent(viewedProfileId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; posts?: SocialPost[] } | null) => {
        if (cancelled) return;
        const serverPosts = Array.isArray(data?.posts) ? data!.posts! : [];
        const peerPosts = (snapshotRef.current?.posts || []).filter(
          (p) => p.authorId === viewedProfileId
        );
        const byId = new Map<string, SocialPost>();
        for (const p of [...serverPosts, ...peerPosts]) {
          byId.set(p.id, { ...p, repostedBy: p.repostedBy || [] });
        }
        setViewedProfileCache({
          [viewedProfileId]: Array.from(byId.values()).sort(
            (a, b) => b.timestamp - a.timestamp
          ),
        });
      })
      .catch(() => {
        if (cancelled) return;
        const peerPosts = (snapshotRef.current?.posts || []).filter(
          (p) => p.authorId === viewedProfileId
        );
        setViewedProfileCache({ [viewedProfileId]: peerPosts });
      })
      .finally(() => {
        if (!cancelled) setLoadingProfilePosts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasEnteredApp, activeSection, viewedProfileId, currentUserId]);

  useEffect(() => {
    if (!hasEnteredApp || !activeRoomCode || !snapshotRef.current) return;

    const client = new RealtimeMeshClient(peerId, {
      onPeersChange: (nextPeers, hostPeerId) => {
        setPeers(nextPeers);
        setSnapshot((prev) => {
          if (!prev || !prev.activeRoomCode) return prev;
          const grp = prev.groups[prev.activeRoomCode];
          if (!grp) return prev;
          const updatedProfiles = { ...prev.profiles };
          for (const p of nextPeers) {
            if (!updatedProfiles[p.userId]) {
              updatedProfiles[p.userId] = {
                id: p.userId,
                appId: p.appId || generateAppUserId(),
                name: p.name,
                handle: p.handle,
                bio: 'Membro conectado via servidor compartilhado.',
                avatarUrl: p.avatarUrl,
                accentColor: p.accentColor || '#3b82f6',
                isPrivate: true,
                joinedAt: p.joinedAt,
              };
            }
          }
          return {
            ...prev,
            profiles: updatedProfiles,
            groups: {
              ...prev.groups,
              [grp.roomCode]: {
                ...grp,
                hostPeerId: hostPeerId || grp.hostPeerId,
              },
            },
          };
        });
      },
      onDirectoryProfiles: (incoming) => {
        mergeDirectoryProfiles(incoming);
      },
      onHostMigrated: ({ newHostPeerId, newHostName, peers: nextPeers }) => {
        setPeers(nextPeers);
        setSnapshot((prev) => {
          if (!prev || !prev.activeRoomCode) return prev;
          const code = prev.activeRoomCode;
          const grp = prev.groups[code];
          const sysMsg: ChatMessage = {
            id: `sys-host-${Date.now()}`,
            roomCode: code,
            senderId: 'system',
            senderName: 'Sistema',
            senderHandle: 'sistema',
            senderAvatar: '',
            text: `Servidor da sala migrado automaticamente para ${
              newHostPeerId === peerId ? 'este dispositivo (Você)' : newHostName
            }.`,
            timestamp: Date.now(),
            textStyle: 'normal',
            bubbleEffect: 'none',
            screenEffect: 'none',
            attachments: [],
            reactions: {},
            systemEvent: true,
            deliveredTo: [],
            readBy: [],
          };
          return {
            ...prev,
            groups: grp
              ? {
                  ...prev.groups,
                  [code]: { ...grp, hostPeerId: newHostPeerId || grp.hostPeerId },
                }
              : prev.groups,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [code]: mergeMessageHistory(prev.messagesByRoom[code] || [], [sysMsg]),
            },
          };
        });
      },
      onMeshEvent: (ev) => {
        applyMeshEvent(ev);
      },
      onSyncRequested: (requesterPeerId) => {
        const snap = snapshotRef.current;
        if (!snap || !snap.activeRoomCode) return;
        const code = snap.activeRoomCode;
        client.sendSyncSnapshot(requesterPeerId, {
          roomCode: code,
          group: snap.groups[code],
          messages: snap.messagesByRoom[code] || [],
          profiles: snap.profiles,
          posts: snap.posts,
          stories: snap.stories,
          highlights: snap.highlights,
          followRelations: snap.followRelations,
        });
      },
      onSyncSnapshot: (rawPayload) => {
        const payload = rawPayload as {
          roomCode?: string;
          group?: GroupConfig;
          messages?: ChatMessage[];
          profiles?: Record<string, UserProfile>;
          posts?: SocialPost[];
          stories?: StoryItem[];
          highlights?: HighlightCollection[];
          followRelations?: FollowRelation[];
        };
        if (!payload || !payload.roomCode) return;
        setSnapshot((prev) => {
          if (!prev) return prev;
          const code = payload.roomCode!;
          const localMsgs = prev.messagesByRoom[code] || [];
          const mergedMsgs = mergeMessageHistory(localMsgs, payload.messages || []);

          const postIds = new Set(prev.posts.map((p) => p.id));
          const mergedPosts = [
            ...prev.posts,
            ...(payload.posts || [])
              .filter((p) => !postIds.has(p.id))
              .map((p) => ({ ...p, repostedBy: p.repostedBy || [] })),
          ];

          const storyIds = new Set(prev.stories.map((s) => s.id));
          const mergedStories = [
            ...prev.stories,
            ...(payload.stories || []).filter((s) => !storyIds.has(s.id)),
          ];

          return {
            ...prev,
            groups: payload.group
              ? {
                  ...prev.groups,
                  [code]: { ...payload.group, kind: payload.group.kind || 'group' },
                }
              : prev.groups,
            messagesByRoom: {
              ...prev.messagesByRoom,
              [code]: mergedMsgs,
            },
            profiles: {
              ...(payload.profiles || {}),
              ...prev.profiles,
              [prev.currentUser.id]: prev.currentUser,
            },
            posts: mergedPosts,
            stories: mergedStories,
          };
        });
      },
      onTyping: (userId, userName, isTyping) => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          if (isTyping) next[userId] = userName;
          else delete next[userId];
          return next;
        });
      },
      onCallInvite: (data) => {
        if (!snapshotRef.current?.settings.dndMode) {
          playUiChime('call');
          setIncomingCall(data);
        }
      },
      onCallAccept: () => {
        setActiveCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
      },
      onCallEnd: () => {
        setIncomingCall(null);
        setActiveCall(null);
        setRemoteStreams({});
      },
      onRemoteStream: (remotePeerId, stream) => {
        setRemoteStreams((prev) => ({ ...prev, [remotePeerId]: stream }));
      },
      onPeerStreamRemoved: (remotePeerId) => {
        setRemoteStreams((prev) => {
          const copy = { ...prev };
          delete copy[remotePeerId];
          return copy;
        });
      },
      onConnectionStatus: (status) => {
        setConnectionStatus(status);
      },
    });

    meshRef.current = client;
    client.connect(activeRoomCode, snapshotRef.current.currentUser);

    return () => {
      client.disconnect();
      meshRef.current = null;
    };
  }, [
    hasEnteredApp,
    activeRoomCode,
    currentUserId,
    peerId,
    applyMeshEvent,
    mergeDirectoryProfiles,
    setSnapshot,
  ]);

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center text-sm">
        Carregando armazenamento local...
      </div>
    );
  }

  const currentGroup: GroupConfig | null =
    (snapshot.activeRoomCode && snapshot.groups[snapshot.activeRoomCode]) ||
    Object.values(snapshot.groups)[0] ||
    null;

  const handleAuthSuccess = (payload: AuthRecoveredPayload) => {
    setAuthToken(payload.token);
    const base = normalizeLoadedSnapshot(createInitialSnapshot());
    const cleanCode = normalizeRoomCode(payload.roomCode) || DEFAULT_ROOM_CODE;

    const existingAcc = vaultAccounts[payload.profile.id];
    const sharedProfiles: Record<string, UserProfile> = {};
    for (const [pid, prof] of Object.entries({
      ...(snapshot?.profiles || {}),
      ...(existingAcc?.profiles || {}),
    })) {
      if (pid === 'user-draft' || prof.id === 'user-draft') continue;
      sharedProfiles[pid] = prof;
    }
    sharedProfiles[payload.profile.id] = payload.profile;

    const existingGroups: Record<string, GroupConfig> = {
      ...(existingAcc?.groups || {}),
    };
    if (!existingGroups[cleanCode]) {
      existingGroups[cleanCode] = {
        roomCode: cleanCode,
        kind: 'group',
        name: payload.createGroupName || `Grupo ${cleanCode}`,
        description: payload.createGroupName
          ? 'Grupo criado e hospedado por este dispositivo.'
          : 'Sala conectada via código de acesso.',
        avatarUrl: '',
        creatorId: payload.profile.id,
        hostPeerId: peerId,
        accentColor: 'blue',
        wallpaper: 'minimal',
        allowMedia: true,
        allowCalls: true,
        requireApproval: false,
        createdAt: Date.now(),
      };
    }

    const existingMessagesByRoom = {
      ...(existingAcc?.messagesByRoom || {}),
    };
    if (!existingMessagesByRoom[cleanCode]) {
      existingMessagesByRoom[cleanCode] = payload.createGroupName
        ? [
            {
              id: `sys-create-${Date.now()}`,
              roomCode: cleanCode,
              senderId: 'system',
              senderName: 'Sistema',
              senderHandle: 'sistema',
              senderAvatar: '',
              text: `Grupo "${payload.createGroupName}" iniciado. Código de acesso: ${cleanCode}.`,
              timestamp: Date.now(),
              textStyle: 'normal',
              bubbleEffect: 'none',
              screenEffect: 'none',
              attachments: [],
              reactions: {},
              systemEvent: true,
              deliveredTo: [],
              readBy: [],
            },
          ]
        : [];
    }

    const ownServerPosts = Array.isArray(payload.posts) ? payload.posts : [];
    const mergedPostsById = new Map<string, SocialPost>();
    for (const p of [...ownServerPosts, ...(existingAcc?.posts || [])]) {
      mergedPostsById.set(p.id, { ...p, repostedBy: p.repostedBy || [] });
    }

    const ownServerStories = Array.isArray(payload.stories) ? payload.stories : [];
    const mergedStoriesById = new Map<string, StoryItem>();
    for (const s of [...ownServerStories, ...(existingAcc?.stories || [])]) {
      mergedStoriesById.set(s.id, s);
    }

    const nextSnap: LocalAppSnapshot = {
      ...base,
      ...(existingAcc || {}),
      currentUser: payload.profile,
      profiles: sharedProfiles,
      groups: existingGroups,
      messagesByRoom: existingMessagesByRoom,
      activeRoomCode: cleanCode,
      stickers:
        payload.stickers.length > 0
          ? payload.stickers
          : existingAcc?.stickers || [],
      likedPostIds: Array.from(
        new Set([...(payload.likedPostIds || []), ...(existingAcc?.likedPostIds || [])])
      ),
      posts: Array.from(mergedPostsById.values()),
      stories: Array.from(mergedStoriesById.values()),
      settings: {
        ...base.settings,
        ...(existingAcc?.settings || {}),
        ...(payload.settings || {}),
      },
      unreadByRoom: existingAcc?.unreadByRoom || {},
      updatedAt: Date.now(),
    };

    setVaultAccounts((prev) => {
      const cleaned = { ...prev };
      delete cleaned['user-draft'];
      cleaned[payload.profile.id] = nextSnap;
      return cleaned;
    });
    setHasSavedDeviceAccount(true);
    setActiveAccountId(payload.profile.id);
    setViewedProfileId(payload.profile.id);
    setActiveSection('profile');
    setHasEnteredApp(true);

    // Sync real directory profiles & active stories from server immediately
    fetch('/api/directory')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { profiles?: UserProfile[] } | null) => {
        if (Array.isArray(data?.profiles)) {
          mergeDirectoryProfiles(data!.profiles);
        }
      })
      .catch(() => {});

    fetch('/api/stories')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stories?: StoryItem[] } | null) => {
        if (!Array.isArray(data?.stories)) return;
        setSnapshot((prev) => {
          if (!prev) return prev;
          const byId = new Map<string, StoryItem>();
          for (const st of [...data!.stories!, ...prev.stories]) {
            byId.set(st.id, st);
          }
          return { ...prev, stories: Array.from(byId.values()) };
        });
      })
      .catch(() => {});
  };

  if (!hasEnteredApp) {
    return (
      <AccessGate
        defaultCode={inviteRoomCode}
        userName={snapshot.currentUser.name}
        userHandle={snapshot.currentUser.handle}
        userAppId={snapshot.currentUser.appId}
        currentUserId={snapshot.currentUser.id}
        profiles={snapshot.profiles}
        hasSavedDeviceAccount={hasSavedDeviceAccount}
        onAuthSuccess={handleAuthSuccess}
      />
    );
  }

  const roomMessages = currentGroup ? snapshot.messagesByRoom[currentGroup.roomCode] || [] : [];
  const isCurrentUserAdmin = currentGroup
    ? currentGroup.creatorId === snapshot.currentUser.id
    : false;
  const activeProfile =
    snapshot.profiles[viewedProfileId || snapshot.currentUser.id] || snapshot.currentUser;
  const blockedUserIds = snapshot.settings.blockedUserIds || [];
  const removedContactIds = snapshot.settings.removedContactIds || [];
  const mutedRoomCodes = snapshot.settings.mutedRoomCodes || [];
  const contactPrefs = snapshot.settings.contactPrefs || {};
  const unreadByRoom: Record<string, UnreadRoomInfo> = snapshot.unreadByRoom || {};
  const totalUnreadCount = Object.values(unreadByRoom).reduce(
    (sum, item) => sum + item.count,
    0
  );
  const canDeleteRoom = Boolean(currentGroup);

  const vaultProfilesList: UserProfile[] = Object.values(vaultAccounts)
    .filter((v) => v.currentUser.id !== 'user-draft')
    .map((v) => v.currentUser);
  const blockedUsersList: UserProfile[] = blockedUserIds
    .map((id) => snapshot.profiles[id])
    .filter((p): p is UserProfile => Boolean(p));

  const profileViewPosts =
    activeProfile.id === snapshot.currentUser.id
      ? snapshot.posts
      : viewedProfileCache[activeProfile.id] || [];

  const openOrCreatePrivateChat = (targetUserId: string) => {
    if (targetUserId === snapshot.currentUser.id) return;
    const targetUser = snapshot.profiles[targetUserId];
    if (!targetUser) return;
    const dmCode = buildDmRoomCode(snapshot.currentUser.id, targetUserId);
    const existing = snapshot.groups[dmCode];
    const dmGroup: GroupConfig = existing || {
      roomCode: dmCode,
      kind: 'dm',
      dmParticipantIds: [snapshot.currentUser.id, targetUserId],
      name: targetUser.name,
      description: `Conversa privada 1-a-1 com @${targetUser.handle}`,
      avatarUrl: targetUser.avatarUrl,
      creatorId: snapshot.currentUser.id,
      hostPeerId: peerId,
      accentColor: 'indigo',
      wallpaper: 'gradient',
      allowMedia: true,
      allowCalls: true,
      requireApproval: false,
      createdAt: Date.now(),
    };

    const nextRemoved = restoreSavedContact(removedContactIds, targetUserId);
    const nextSettings =
      nextRemoved !== removedContactIds
        ? { ...snapshot.settings, removedContactIds: nextRemoved }
        : snapshot.settings;

    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            activeRoomCode: dmCode,
            settings: nextSettings,
            groups: { ...prev.groups, [dmCode]: dmGroup },
            messagesByRoom: {
              ...prev.messagesByRoom,
              [dmCode]: prev.messagesByRoom[dmCode] || [
                {
                  id: `sys-dm-${Date.now()}`,
                  roomCode: dmCode,
                  senderId: 'system',
                  senderName: 'Sistema',
                  senderHandle: 'sistema',
                  senderAvatar: '',
                  text: `Conversa privada iniciada entre @${prev.currentUser.handle} e @${targetUser.handle}.`,
                  timestamp: Date.now(),
                  textStyle: 'normal',
                  bubbleEffect: 'none',
                  screenEffect: 'none',
                  attachments: [],
                  reactions: {},
                  systemEvent: true,
                  deliveredTo: [],
                  readBy: [],
                },
              ],
            },
          }
        : prev
    );
    if (nextRemoved !== removedContactIds) {
      void syncAccountToServer({ settings: nextSettings });
    }
    setShowRoomSwitcher(false);
    setActiveSection('chat');
  };

  const handleSendMessage = (payload: {
    text: string;
    textStyle: TextStyleType;
    bubbleEffect: BubbleEffect;
    screenEffect: ScreenEffect;
    attachments: ChatAttachment[];
    replyTo?: ChatMessage['replyTo'];
    poll?: ChatMessage['poll'];
    selfDestructSec?: number;
  }) => {
    if (!currentGroup) return;
    const now = Date.now();
    const selfDestructSec =
      payload.selfDestructSec && payload.selfDestructSec > 0
        ? payload.selfDestructSec
        : undefined;

    const msg: ChatMessage = {
      id: `msg-${now}-${Math.random().toString(36).slice(2, 6)}`,
      roomCode: currentGroup.roomCode,
      senderId: snapshot.currentUser.id,
      senderName: snapshot.currentUser.name,
      senderHandle: snapshot.currentUser.handle,
      senderAvatar: snapshot.currentUser.avatarUrl,
      senderColor: snapshot.currentUser.accentColor || '#3b82f6',
      text: payload.text,
      timestamp: now,
      selfDestructSec,
      expiresAt: selfDestructSec ? now + selfDestructSec * 1000 : undefined,
      textStyle: payload.textStyle,
      bubbleEffect: payload.bubbleEffect,
      screenEffect: payload.screenEffect,
      attachments: payload.attachments,
      replyTo: payload.replyTo,
      poll: payload.poll,
      reactions: {},
      deliveredTo: [snapshot.currentUser.id],
      readBy: snapshot.settings.showReadReceipts ? [snapshot.currentUser.id] : [],
    };

    if (snapshot.settings.soundEnabled && !snapshot.settings.dndMode) {
      playUiChime('send');
    }

    applyMeshEvent({ kind: 'chat:message', message: msg });
    meshRef.current?.sendMeshEvent({ kind: 'chat:message', message: msg });
  };

  const handleEditMessage = (messageId: string, newText: string) => {
    if (!currentGroup) return;
    const ev: MeshEventPayload = {
      kind: 'chat:edit',
      roomCode: currentGroup.roomCode,
      messageId,
      newText,
      editedAt: Date.now(),
    };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!currentGroup) return;
    const ev: MeshEventPayload = {
      kind: 'chat:delete',
      roomCode: currentGroup.roomCode,
      messageId,
    };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
  };

  const handleClearConversation = (roomCode: string) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messagesByRoom: {
          ...prev.messagesByRoom,
          [roomCode]: [
            {
              id: `sys-clear-${Date.now()}`,
              roomCode,
              senderId: 'system',
              senderName: 'Sistema',
              senderHandle: 'sistema',
              senderAvatar: '',
              text: 'Histórico da conversa limpo neste dispositivo.',
              timestamp: Date.now(),
              textStyle: 'normal',
              bubbleEffect: 'none',
              screenEffect: 'none',
              attachments: [],
              reactions: {},
              systemEvent: true,
              deliveredTo: [],
              readBy: [],
            },
          ],
        },
      };
    });
  };

  const handleDeleteConversation = (roomCode: string) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const nextState = leaveOrDeleteGroupFromState(
        prev.groups,
        prev.messagesByRoom,
        prev.unreadByRoom || {},
        prev.activeRoomCode,
        roomCode
      );
      return {
        ...prev,
        ...nextState,
      };
    });
    if (currentGroup?.roomCode === roomCode) {
      setShowGroupAdmin(false);
    }
    setConfirmRemoveGroupCode(null);
  };

  const handleLeaveGroup = (roomCode: string) => {
    handleDeleteConversation(roomCode);
  };

  const handleRemoveContact = (targetUserId: string) => {
    if (!targetUserId || targetUserId === snapshot.currentUser.id) return;
    const dmCode = buildDmRoomCode(snapshot.currentUser.id, targetUserId);
    const nextRemoved = removeSavedContact(
      snapshot.settings.removedContactIds,
      targetUserId,
      snapshot.currentUser.id
    );
    const nextSettings = {
      ...snapshot.settings,
      removedContactIds: nextRemoved,
    };

    setSnapshot((prev) => {
      if (!prev) return prev;
      const nextState = leaveOrDeleteGroupFromState(
        prev.groups,
        prev.messagesByRoom,
        prev.unreadByRoom || {},
        prev.activeRoomCode,
        dmCode
      );
      return {
        ...prev,
        ...nextState,
        settings: nextSettings,
      };
    });
    setConfirmRemoveContactId(null);
    void syncAccountToServer({ settings: nextSettings });
  };

  const handleToggleMuteRoom = (roomCode: string) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const list = prev.settings.mutedRoomCodes || [];
      const exists = list.includes(roomCode);
      return {
        ...prev,
        settings: {
          ...prev.settings,
          mutedRoomCodes: exists ? list.filter((c) => c !== roomCode) : [...list, roomCode],
        },
      };
    });
  };

  const handleToggleBlockUser = (targetUserId: string) => {
    if (targetUserId === snapshot.currentUser.id) return;
    setSnapshot((prev) => {
      if (!prev) return prev;
      const list = prev.settings.blockedUserIds || [];
      const exists = list.includes(targetUserId);
      return {
        ...prev,
        settings: {
          ...prev.settings,
          blockedUserIds: exists
            ? list.filter((id) => id !== targetUserId)
            : [...list, targetUserId],
        },
      };
    });
  };

  const handleUpdateContactPref = (targetUserId: string, pref: ContactPreference) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          contactPrefs: {
            ...(prev.settings.contactPrefs || {}),
            [targetUserId]: pref,
          },
        },
      };
    });
  };

  const handleUpdateAvatar = (croppedDataUrl: string) => {
    const updatedProfile: UserProfile = {
      ...snapshot.currentUser,
      avatarUrl: croppedDataUrl,
    };
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            currentUser: updatedProfile,
            profiles: { ...prev.profiles, [updatedProfile.id]: updatedProfile },
          }
        : prev
    );
    meshRef.current?.updateUserProfile(updatedProfile);
    meshRef.current?.sendMeshEvent({ kind: 'profile:update', profile: updatedProfile });
    void syncAccountToServer({ profile: updatedProfile });
  };

  const handleCreateSticker = (sticker: StickerItem) => {
    const nextStickers = [sticker, ...(snapshot.stickers || [])];
    setSnapshot((prev) => (prev ? { ...prev, stickers: nextStickers } : prev));
    void syncAccountToServer({ stickers: nextStickers });
  };

  const handleDeleteSticker = (stickerId: string) => {
    const nextStickers = (snapshot.stickers || []).filter((s) => s.id !== stickerId);
    setSnapshot((prev) => (prev ? { ...prev, stickers: nextStickers } : prev));
    void syncAccountToServer({ stickers: nextStickers });
  };

  const handleToggleLikePost = (postId: string) => {
    const ev: MeshEventPayload = {
      kind: 'social:post-like',
      postId,
      userId: snapshot.currentUser.id,
    };
    applyMeshEvent(ev);
    setViewedProfileCache((prev) => {
      const next: Record<string, SocialPost[]> = {};
      for (const [uid, list] of Object.entries(prev)) {
        next[uid] = list.map((p) => {
          if (p.id !== postId) return p;
          const liked = p.likedBy.includes(snapshot.currentUser.id);
          return {
            ...p,
            likedBy: liked
              ? p.likedBy.filter((id) => id !== snapshot.currentUser.id)
              : [...p.likedBy, snapshot.currentUser.id],
          };
        });
      }
      return next;
    });
    meshRef.current?.sendMeshEvent(ev);
    fetch(`/api/posts/${encodeURIComponent(postId)}/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
      },
      body: JSON.stringify({ userId: snapshot.currentUser.id }),
    }).catch(() => {});
  };

  const handleEditPost = (postId: string, patch: Partial<SocialPost>) => {
    const target = snapshot.posts.find((p) => p.id === postId);
    if (!target || !canEditPost(target, snapshot.currentUser.id)) return;
    const ev: MeshEventPayload = {
      kind: 'social:post-edit',
      postId,
      patch: patch as Record<string, unknown>,
      editedAt: Date.now(),
    };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
    fetch(`/api/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
      },
      body: JSON.stringify({ authorId: snapshot.currentUser.id, patch }),
    }).catch(() => {});
  };

  const handleDeletePost = (postId: string) => {
    const target = snapshot.posts.find((p) => p.id === postId);
    if (!target || target.authorId !== snapshot.currentUser.id) return;
    const ev: MeshEventPayload = { kind: 'social:post-delete', postId };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
    fetch(
      `/api/posts/${encodeURIComponent(postId)}?authorId=${encodeURIComponent(
        snapshot.currentUser.id
      )}`,
      {
        method: 'DELETE',
        headers: authTokenRef.current
          ? { Authorization: `Bearer ${authTokenRef.current}` }
          : undefined,
      }
    ).catch(() => {});
  };

  const handleDeleteStory = (storyId: string) => {
    const target = snapshot.stories.find((s) => s.id === storyId);
    if (!target || !canDeleteStory(target, snapshot.currentUser.id)) return;
    const ev: MeshEventPayload = { kind: 'social:story-delete', storyId };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
    fetch(
      `/api/stories/${encodeURIComponent(storyId)}?authorId=${encodeURIComponent(
        snapshot.currentUser.id
      )}`,
      {
        method: 'DELETE',
        headers: authTokenRef.current
          ? { Authorization: `Bearer ${authTokenRef.current}` }
          : undefined,
      }
    ).catch(() => {});
  };

  const handleToggleReaction = (messageId: string, emoji: TapbackEmoji) => {
    const event: MeshEventPayload = {
      kind: 'chat:reaction',
      messageId,
      emoji,
      userId: snapshot.currentUser.id,
    };
    applyMeshEvent(event);
    meshRef.current?.sendMeshEvent(event);
  };

  const handleTogglePin = (messageId: string) => {
    const target = roomMessages.find((m) => m.id === messageId);
    const event: MeshEventPayload = {
      kind: 'chat:pin',
      messageId,
      pinned: !target?.pinned,
    };
    applyMeshEvent(event);
    meshRef.current?.sendMeshEvent(event);
  };

  const handleVotePoll = (messageId: string, optionId: string) => {
    const event: MeshEventPayload = {
      kind: 'chat:poll-vote',
      messageId,
      optionId,
      userId: snapshot.currentUser.id,
    };
    applyMeshEvent(event);
    meshRef.current?.sendMeshEvent(event);
  };

  const handleStartCall = (mode: 'audio' | 'video') => {
    if (!currentGroup) return;
    const callId = `call-${Date.now()}`;
    setActiveCall({
      callId,
      roomCode: currentGroup.roomCode,
      mode,
      initiatorId: snapshot.currentUser.id,
      startedAt: Date.now(),
      participants: [snapshot.currentUser.id],
      status: 'active',
    });
    meshRef.current?.sendCallInvite(callId, mode);
  };

  const handleSharePostToChat = (post: SocialPost) => {
    if (!currentGroup) {
      setSwitcherTab('create');
      setShowRoomSwitcher(true);
      return;
    }
    const author = snapshot.profiles[post.authorId];
    const msg: ChatMessage = {
      id: `msg-post-${Date.now()}`,
      roomCode: currentGroup.roomCode,
      senderId: snapshot.currentUser.id,
      senderName: snapshot.currentUser.name,
      senderHandle: snapshot.currentUser.handle,
      senderAvatar: snapshot.currentUser.avatarUrl,
      senderColor: snapshot.currentUser.accentColor || '#3b82f6',
      text: `Compartilhou uma publicação de @${author?.handle ?? 'usuario'}`,
      timestamp: Date.now(),
      textStyle: 'normal',
      bubbleEffect: 'gentle',
      screenEffect: 'none',
      attachments: [],
      reactions: {},
      sharedPost: {
        postId: post.id,
        authorName: author?.name ?? 'Membro',
        authorHandle: author?.handle ?? 'usuario',
        caption: post.caption,
        imageUrl: post.mediaUrl,
        textCardBg: post.textCardBg,
      },
      deliveredTo: [snapshot.currentUser.id],
      readBy: [snapshot.currentUser.id],
    };
    applyMeshEvent({ kind: 'chat:message', message: msg });
    meshRef.current?.sendMeshEvent({ kind: 'chat:message', message: msg });
    setActiveSection('chat');
  };

  const handleToggleRepost = (postId: string) => {
    const ev: MeshEventPayload = {
      kind: 'social:repost',
      postId,
      userId: snapshot.currentUser.id,
    };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
  };

  const handleUpdateThoughtBubble = (thoughtBubble: ThoughtBubble | null) => {
    const ev: MeshEventPayload = {
      kind: 'profile:thought',
      userId: snapshot.currentUser.id,
      thoughtBubble,
    };
    applyMeshEvent(ev);
    meshRef.current?.sendMeshEvent(ev);
    void syncAccountToServer({ profile: { thoughtBubble } });
  };

  const handleSwitchAccount = (targetAccountId: string) => {
    const targetSnap = vaultAccounts[targetAccountId];
    if (!targetSnap) return;
    setActiveAccountId(targetAccountId);
    setViewedProfileId(targetSnap.currentUser.id);
    setActiveSection('profile');
  };

  const handleCreateAccount = (cleanName: string, cleanHandle: string) => {
    if (!canCreateAccountOnDevice(Object.keys(vaultAccounts).length)) return;
    const base = normalizeLoadedSnapshot(createInitialSnapshot());
    const newId = `user-${Date.now().toString(36)}`;
    const newProfile: UserProfile = {
      id: newId,
      appId: generateAppUserId(),
      name: cleanName,
      handle: cleanHandle,
      handleEditedCount: 0,
      bio: 'Perfil individual conectado em tempo real no Pulso.',
      avatarUrl: '',
      accentColor: '#6366f1',
      isPrivate: true,
      joinedAt: Date.now(),
    };

    const sharedProfiles: Record<string, UserProfile> = {
      ...base.profiles,
      ...snapshot.profiles,
    };
    for (const acc of Object.values(vaultAccounts)) {
      sharedProfiles[acc.currentUser.id] = acc.currentUser;
    }
    sharedProfiles[newId] = newProfile;

    const newSnapshot: LocalAppSnapshot = {
      ...base,
      currentUser: newProfile,
      profiles: sharedProfiles,
      updatedAt: Date.now(),
    };

    setVaultAccounts((prev) => ({
      ...prev,
      [newId]: newSnapshot,
    }));
    setActiveAccountId(newId);
    setViewedProfileId(newId);
    setActiveSection('profile');
  };

  const handleDeleteAccount = async (targetUserId: string) => {
    const remainingIds = Object.keys(vaultAccounts).filter(
      (id) => id !== targetUserId && id !== 'user-draft'
    );
    if (remainingIds.length === 0) {
      await clearLocalSnapshot();
      const fresh = normalizeLoadedSnapshot(createInitialSnapshot());
      setAuthToken(null);
      setHasSavedDeviceAccount(false);
      setVaultAccounts({ [fresh.currentUser.id]: fresh });
      setActiveAccountId(fresh.currentUser.id);
      setViewedProfileId(fresh.currentUser.id);
      setActiveSection('profile');
      setShowSettings(false);
      setHasEnteredApp(false);
      return;
    }

    const nextVault = { ...vaultAccounts };
    delete nextVault[targetUserId];
    const nextActiveId =
      activeAccountId === targetUserId ? remainingIds[0] : activeAccountId || remainingIds[0];

    setVaultAccounts(nextVault);
    setActiveAccountId(nextActiveId);
    setViewedProfileId(nextVault[nextActiveId].currentUser.id);
    setActiveSection('profile');
  };

  const pendingFollowCount = snapshot.followRelations.filter(
    (r) => r.toUserId === snapshot.currentUser.id && r.status === 'pending'
  ).length;

  const filteredConversations = Object.values(snapshot.groups).filter((grp) => {
    if (conversationFilter === 'all') return true;
    return grp.kind === conversationFilter;
  });

  const fontScaleClass =
    snapshot.settings.fontScale === 'compact'
      ? 'text-[13px]'
      : snapshot.settings.fontScale === 'comfortable'
      ? 'text-[15px]'
      : 'text-sm';

  const glassSurfaceClass =
    snapshot.settings.glassIntensity === 'liquid'
      ? 'bg-white/75 dark:bg-zinc-900/65 backdrop-blur-2xl'
      : 'bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md';

  const otherUsers = filterVisibleContacts(
    snapshot.profiles,
    snapshot.currentUser.id,
    removedContactIds,
    blockedUserIds
  );

  const handleSignOutToAuthGate = () => {
    setAuthToken(null);
    setViewedProfileCache({});
    setShowSettings(false);
    setHasEnteredApp(false);
  };

  return (
    <div
      className={`h-[100dvh] w-screen overflow-hidden flex flex-col md:flex-row bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 relative ${fontScaleClass} ${
        isFullscreen ? 'pulso-fullscreen-fallback' : ''
      }`}
    >
      {/* Subtle iOS 27 Ambient Backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 left-1/4 w-96 h-96 rounded-full bg-blue-500/[0.06] dark:bg-blue-500/[0.08] blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-indigo-500/[0.06] dark:bg-indigo-500/[0.08] blur-3xl" />
      </div>

      {/* Desktop iOS 27 Floating Glass Navigation Rail */}
      <nav
        aria-label="Navegação principal"
        className={`hidden md:flex relative z-20 flex-col items-center justify-between w-[72px] shrink-0 py-4 border border-black/[0.07] dark:border-white/[0.1] shadow-xl transition-all ${
          isFullscreen ? 'my-0 ml-0 rounded-none border-y-0 border-l-0' : 'my-3 ml-3 rounded-[30px]'
        } ${glassSurfaceClass}`}
      >
        <div className="flex flex-col items-center gap-2.5">
          <div
            title={`Pulso · ID ${snapshot.currentUser.appId}`}
            className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-display font-bold text-lg mb-1 shadow-md shadow-blue-500/25"
          >
            P
          </div>

          {/* 1. Meu Perfil (Default landing screen) */}
          <button
            type="button"
            onClick={() => {
              setViewedProfileId(snapshot.currentUser.id);
              setActiveSection('profile');
            }}
            aria-label="Meu Perfil"
            title="Meu Perfil"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              activeSection === 'profile' && viewedProfileId === snapshot.currentUser.id
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            <User className="w-5 h-5" strokeWidth={1.75} />
          </button>

          {/* 2. Mensagens (Grupos & Privadas) */}
          <button
            type="button"
            onClick={() => setActiveSection('chat')}
            aria-label="Mensagens"
            title="Mensagens"
            className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              activeSection === 'chat'
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            <MessageSquare className="w-5 h-5" strokeWidth={1.75} />
            {totalUnreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </span>
            )}
          </button>

          {/* 3. Feed Social & Stories */}
          <button
            type="button"
            onClick={() => setActiveSection('feed')}
            aria-label="Feed Social e Stories"
            title="Feed Social & Stories"
            className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              activeSection === 'feed'
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            <Compass className="w-5 h-5" strokeWidth={1.75} />
            {pendingFollowCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-zinc-900" />
            )}
          </button>

          {/* 4. Buscar Pessoas */}
          <button
            type="button"
            onClick={() => setShowUserSearch(true)}
            aria-label="Buscar pessoas"
            title="Buscar pessoas e perfis"
            className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <Search className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Usar em tela cheia'}
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isFullscreen
                ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5" strokeWidth={1.75} />
            ) : (
              <Maximize2 className="w-5 h-5" strokeWidth={1.75} />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setSnapshot({
                ...snapshot,
                settings: {
                  ...snapshot.settings,
                  theme: snapshot.settings.theme === 'dark' ? 'light' : 'dark',
                },
              })
            }
            aria-label="Alternar tema escuro ou claro"
            title="Alternar Tema"
            className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            {snapshot.settings.theme === 'dark' ? (
              <Sun className="w-5 h-5" strokeWidth={1.75} />
            ) : (
              <Moon className="w-5 h-5" strokeWidth={1.75} />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (currentGroup) {
                setShowGroupAdmin(true);
              } else {
                setSwitcherTab('create');
                setShowRoomSwitcher(true);
              }
            }}
            aria-label="Servidor e Grupo"
            title="Servidor do Dispositivo e Grupo"
            className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <Server className="w-5 h-5" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => {
              setSettingsInitialTab('profile');
              setShowSettings(true);
            }}
            aria-label="Configurações do Sistema"
            title="Configurações e Contas"
            className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <Settings className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>
      </nav>

      {/* Desktop Floating Glass Conversations & Contacts Sidebar */}
      <aside
        className={`hidden lg:flex relative z-10 flex-col w-72 shrink-0 border border-black/[0.07] dark:border-white/[0.1] shadow-xl overflow-hidden transition-all ${
          isFullscreen
            ? 'my-0 ml-0 rounded-none border-y-0 border-l-0'
            : 'my-3 ml-2.5 rounded-[30px]'
        } ${glassSurfaceClass}`}
      >
        <div className="p-4 pb-3 border-b border-black/[0.05] dark:border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold leading-tight">Conversas</h2>
              <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                {snapshot.currentUser.appId} · {vaultProfilesList.length}/{MAX_ACCOUNTS_PER_DEVICE} contas
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowUserSearch(true)}
                aria-label="Buscar pessoas"
                title="Buscar pessoas"
                className="w-9 h-9 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.14] flex items-center justify-center cursor-pointer transition-colors"
              >
                <Search className="w-4 h-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSwitcherTab('contacts');
                  setShowRoomSwitcher(true);
                }}
                aria-label="Nova conversa privada ou grupo"
                title="Nova conversa ou grupo"
                className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/25 flex items-center justify-center cursor-pointer transition-transform active:scale-95"
              >
                <Plus className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Segmented iOS 27 Filter */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
            {([
              { id: 'all', label: 'Todas' },
              { id: 'group', label: 'Grupos' },
              { id: 'dm', label: 'Privadas' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setConversationFilter(tab.id)}
                className={`py-1.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                  conversationFilter === tab.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 space-y-1.5 overflow-y-auto flex-1 scrollbar-thin">
          {filteredConversations.length === 0 ? (
            <div className="px-3 py-5 text-center rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-dashed border-black/[0.08] dark:border-white/[0.08] space-y-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Nenhuma conversa nesta lista.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSwitcherTab('create');
                  setShowRoomSwitcher(true);
                }}
                className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
              >
                Criar grupo
              </button>
            </div>
          ) : (
            filteredConversations.map((grp) => {
              const isSelected =
                Boolean(currentGroup && grp.roomCode === currentGroup.roomCode) &&
                activeSection === 'chat';
              const roomMsgs = snapshot.messagesByRoom[grp.roomCode] || [];
              const lastMsg = roomMsgs[roomMsgs.length - 1];
              const unread = unreadByRoom[grp.roomCode];
              const isDm = grp.kind === 'dm';
              const dmPartnerId = isDm
                ? grp.dmParticipantIds?.find((id) => id !== snapshot.currentUser.id)
                : undefined;
              const dmPartner = dmPartnerId ? snapshot.profiles[dmPartnerId] : undefined;
              const dmPref = dmPartnerId ? contactPrefs[dmPartnerId] : undefined;
              const displayName = dmPref?.alias || dmPartner?.name || grp.name;

              return (
                <button
                  key={grp.roomCode}
                  type="button"
                  onClick={() => {
                    setSnapshot((prev) =>
                      prev
                        ? {
                            ...prev,
                            activeRoomCode: grp.roomCode,
                            unreadByRoom: clearRoomUnread(prev.unreadByRoom || {}, grp.roomCode),
                          }
                        : prev
                    );
                    setActiveSection('chat');
                  }}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/20'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <Avatar src={dmPartner?.avatarUrl || grp.avatarUrl} name={displayName} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        {isDm && (
                          <Lock
                            className={`w-3 h-3 shrink-0 ${
                              isSelected ? 'text-white/90' : 'text-indigo-500'
                            }`}
                          />
                        )}
                        <p className="text-sm font-semibold truncate">{displayName}</p>
                      </div>
                      {unread && unread.count > 0 ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold shrink-0">
                          {unread.count}
                        </span>
                      ) : (
                        <span
                          className={`font-mono text-[10px] shrink-0 ${
                            isSelected ? 'text-white/80' : 'text-zinc-400'
                          }`}
                        >
                          {isDm ? '1-a-1' : grp.roomCode.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    {unread && unread.count > 0 ? (
                      <p
                        className={`text-xs truncate flex items-center gap-1 font-medium ${
                          isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: unread.lastSenderColor || '#3b82f6' }}
                        />
                        <span className="truncate">
                          {unread.lastSenderName}: {unread.count} nova{unread.count > 1 ? 's' : ''}
                        </span>
                      </p>
                    ) : (
                      <p
                        className={`text-xs truncate ${
                          isSelected ? 'text-white/85' : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {lastMsg ? lastMsg.text || 'Anexo enviado' : 'Sem mensagens ainda'}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}

          {/* Saved Contacts Quick-Chat Section */}
          <div className="pt-4 mt-4 border-t border-black/[0.05] dark:border-white/[0.08]">
            <p className="px-2 pb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Contatos ({otherUsers.length})</span>
              </span>
              <span className="text-[10px] font-normal">Toque p/ conversar</span>
            </p>
            {otherUsers.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Nenhuma outra pessoa salva ainda. Use Buscar ou compartilhe o código do grupo.
              </p>
            ) : (
              <div className="space-y-1">
                {otherUsers.map((prof) => {
                  const onlinePeer = peers.find((p) => p.userId === prof.id);
                  const activeThought = isThoughtActive(prof.thoughtBubble)
                    ? prof.thoughtBubble
                    : null;
                  const pref = contactPrefs[prof.id];
                  const displayName = pref?.alias || prof.name;
                  const dotColor = pref?.customColor || prof.accentColor || '#3b82f6';
                  const blocked = isUserBlocked(prof.id, blockedUserIds);
                  const confirmingRemove = confirmRemoveContactId === prof.id;

                  return (
                    <div
                      key={prof.id}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => openOrCreatePrivateChat(prof.id)}
                        className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                      >
                        <Avatar
                          src={prof.avatarUrl}
                          name={displayName}
                          size="sm"
                          isHost={Boolean(onlinePeer?.isHost)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: dotColor }}
                            />
                            <span className={blocked ? 'line-through opacity-50' : ''}>
                              {displayName}
                            </span>
                          </p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {activeThought
                              ? `${activeThought.emoji || '💭'} ${activeThought.text}`
                              : `@${prof.handle} · ${prof.appId}`}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setViewedProfileId(prof.id);
                          setActiveSection('profile');
                        }}
                        aria-label={`Ver perfil de ${displayName}`}
                        title="Ver perfil"
                        className="w-7 h-7 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.1] flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 shrink-0 cursor-pointer"
                      >
                        <User className="w-3.5 h-3.5" />
                      </button>
                      {confirmingRemove ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveContact(prof.id)}
                          aria-label={`Confirmar remoção de ${displayName}`}
                          title="Confirmar exclusão"
                          className="w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveContactId(prof.id)}
                          aria-label={`Excluir contato ${displayName}`}
                          title="Excluir contato"
                          className="w-7 h-7 rounded-full hover:bg-rose-500/15 flex items-center justify-center text-zinc-400 hover:text-rose-500 shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 min-w-0 min-h-0 flex flex-col pb-[76px] md:pb-0">
        {activeSection === 'profile' && (
          <ProfileView
            profile={activeProfile}
            currentUser={snapshot.currentUser}
            profiles={snapshot.profiles}
            posts={profileViewPosts}
            stories={snapshot.stories}
            highlights={snapshot.highlights}
            followRelations={snapshot.followRelations}
            isBlocked={isUserBlocked(activeProfile.id, blockedUserIds)}
            isFullscreen={isFullscreen}
            likedPostIds={snapshot.likedPostIds || []}
            isLoadingProfilePosts={loadingProfilePosts}
            onToggleFullscreen={handleToggleFullscreen}
            onRequestFollow={(targetUserId) => {
              const rel: FollowRelation = {
                fromUserId: snapshot.currentUser.id,
                toUserId: targetUserId,
                status: 'pending',
                timestamp: Date.now(),
              };
              const ev: MeshEventPayload = { kind: 'social:follow-request', relation: rel };
              applyMeshEvent(ev);
              meshRef.current?.sendMeshEvent(ev);
            }}
            onRespondFollow={(fromUserId, accept) => {
              const ev: MeshEventPayload = {
                kind: 'social:follow-respond',
                fromUserId,
                toUserId: snapshot.currentUser.id,
                status: accept ? 'accepted' : 'rejected',
              };
              applyMeshEvent(ev);
              meshRef.current?.sendMeshEvent(ev);
            }}
            onOpenSettings={() => {
              setSettingsInitialTab('profile');
              setShowSettings(true);
            }}
            onOpenSearch={() => setShowUserSearch(true)}
            onUpdateAvatar={handleUpdateAvatar}
            onToggleLikePost={handleToggleLikePost}
            onToggleRepost={handleToggleRepost}
            onEditPost={handleEditPost}
            onDeletePost={handleDeletePost}
            onDeleteStory={handleDeleteStory}
            onUpdateThoughtBubble={handleUpdateThoughtBubble}
            onStartPrivateChat={openOrCreatePrivateChat}
            onToggleBlockUser={handleToggleBlockUser}
            onOpenProfile={(userId) => {
              setViewedProfileId(userId);
              setActiveSection('profile');
            }}
          />
        )}

        {activeSection === 'chat' && currentGroup && (
          <ChatView
            group={currentGroup}
            currentUser={snapshot.currentUser}
            profiles={snapshot.profiles}
            messages={roomMessages}
            peers={peers}
            typingUsers={typingUsers}
            quickReplies={snapshot.settings.quickReplies}
            stickers={snapshot.stickers || []}
            unreadTotalCount={totalUnreadCount}
            unreadByRoom={unreadByRoom}
            isFullscreen={isFullscreen}
            compactMessages={snapshot.settings.compactMessages}
            autoRevealInvisibleInk={snapshot.settings.autoRevealInvisibleInk}
            isCurrentUserAdmin={isCurrentUserAdmin}
            blockedUserIds={blockedUserIds}
            removedContactIds={removedContactIds}
            mutedRoomCodes={mutedRoomCodes}
            contactPrefs={contactPrefs}
            canDeleteRoom={canDeleteRoom}
            onSendMessage={handleSendMessage}
            onCreateSticker={handleCreateSticker}
            onOpenStickerSettings={() => {
              setSettingsInitialTab('stickers');
              setShowSettings(true);
            }}
            onToggleFullscreen={handleToggleFullscreen}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onToggleReaction={handleToggleReaction}
            onTogglePin={handleTogglePin}
            onVotePoll={handleVotePoll}
            onTypingChange={(typing) => {
              if (snapshot.settings.showTypingStatus) {
                meshRef.current?.sendTyping(typing);
              }
            }}
            onStartCall={handleStartCall}
            onOpenGroupAdmin={() => setShowGroupAdmin(true)}
            onOpenConversationsModal={() => {
              setSwitcherTab('contacts');
              setShowRoomSwitcher(true);
            }}
            onStartPrivateChat={openOrCreatePrivateChat}
            onClearConversation={handleClearConversation}
            onDeleteConversation={handleDeleteConversation}
            onLeaveGroup={handleLeaveGroup}
            onRemoveContact={handleRemoveContact}
            onToggleMuteRoom={handleToggleMuteRoom}
            onToggleBlockUser={handleToggleBlockUser}
            onUpdateContactPref={handleUpdateContactPref}
            onOpenProfile={(userId) => {
              setViewedProfileId(userId);
              setActiveSection('profile');
            }}
          />
        )}

        {activeSection === 'chat' && !currentGroup && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-[32px] bg-white/85 dark:bg-zinc-900/75 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.1] shadow-xl p-7 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <MessageSquare className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-lg font-bold">Nenhuma conversa ativa</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Crie um novo grupo para hospedar em seu dispositivo, entre com um código ou inicie uma conversa privada com alguém.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSwitcherTab('create');
                    setShowRoomSwitcher(true);
                  }}
                  className="px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Criar grupo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSwitcherTab('join');
                    setShowRoomSwitcher(true);
                  }}
                  className="px-4 py-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Entrar por código
                </button>
                <button
                  type="button"
                  onClick={() => setShowUserSearch(true)}
                  className="px-4 py-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Buscar pessoas
                </button>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'feed' && (
          <SocialFeedView
            currentUser={snapshot.currentUser}
            profiles={snapshot.profiles}
            posts={snapshot.posts}
            stories={snapshot.stories}
            highlights={snapshot.highlights}
            followRelations={snapshot.followRelations}
            blockedUserIds={blockedUserIds}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
            onCreatePost={(draft) => {
              const post: SocialPost = {
                ...draft,
                id: `post-${Date.now()}`,
                timestamp: Date.now(),
                likedBy: [],
                savedBy: [],
                repostedBy: [],
                comments: [],
              };
              applyMeshEvent({ kind: 'social:post', post });
              meshRef.current?.sendMeshEvent({ kind: 'social:post', post });
              fetch('/api/posts', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
                },
                body: JSON.stringify({ post }),
              }).catch(() => {});
            }}
            onEditPost={handleEditPost}
            onDeletePost={handleDeletePost}
            onCreateStory={(draft) => {
              const now = Date.now();
              const durationMs = draft.durationMs || 1000 * 60 * 60 * 24;
              const { durationMs: _ignored, ...rest } = draft;
              const story: StoryItem = {
                ...rest,
                id: `story-${now}`,
                timestamp: now,
                expiresAt: now + durationMs,
                viewedBy: [],
              };
              applyMeshEvent({ kind: 'social:story', story });
              meshRef.current?.sendMeshEvent({ kind: 'social:story', story });
              fetch('/api/stories', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
                },
                body: JSON.stringify({ story }),
              }).catch(() => {});
            }}
            onDeleteStory={handleDeleteStory}
            onToggleLikePost={handleToggleLikePost}
            onToggleRepost={handleToggleRepost}
            onToggleSavePost={(postId) => {
              setSnapshot((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  posts: prev.posts.map((p) => {
                    if (p.id !== postId) return p;
                    const saved = p.savedBy.includes(prev.currentUser.id);
                    return {
                      ...p,
                      savedBy: saved
                        ? p.savedBy.filter((id) => id !== prev.currentUser.id)
                        : [...p.savedBy, prev.currentUser.id],
                    };
                  }),
                };
              });
            }}
            onAddComment={(postId, text) => {
              const comment: SocialPost['comments'][number] = {
                id: `cmt-${Date.now()}`,
                authorId: snapshot.currentUser.id,
                authorName: snapshot.currentUser.name,
                authorHandle: snapshot.currentUser.handle,
                authorAvatar: snapshot.currentUser.avatarUrl,
                text,
                timestamp: Date.now(),
              };
              const ev: MeshEventPayload = { kind: 'social:post-comment', postId, comment };
              applyMeshEvent(ev);
              meshRef.current?.sendMeshEvent(ev);
            }}
            onSharePostToChat={handleSharePostToChat}
            onMarkStoryViewed={(storyId) => {
              setSnapshot((prev) => {
                if (!prev) return prev;
                const already = prev.stories
                  .find((s) => s.id === storyId)
                  ?.viewedBy.includes(prev.currentUser.id);
                if (already) return prev;
                return {
                  ...prev,
                  stories: prev.stories.map((s) =>
                    s.id === storyId
                      ? { ...s, viewedBy: [...s.viewedBy, prev.currentUser.id] }
                      : s
                  ),
                };
              });
            }}
            onPinStoryToHighlight={(storyId, highlightTitle) => {
              const story = snapshot.stories.find((s) => s.id === storyId);
              if (!story) return;
              setSnapshot((prev) => {
                if (!prev) return prev;
                const existing = prev.highlights.find(
                  (h) =>
                    h.ownerId === prev.currentUser.id &&
                    h.title.toLowerCase() === highlightTitle.toLowerCase()
                );
                if (existing) {
                  return {
                    ...prev,
                    highlights: prev.highlights.map((h) =>
                      h.id === existing.id
                        ? { ...h, storyIds: Array.from(new Set([...h.storyIds, storyId])) }
                        : h
                    ),
                  };
                }
                const created: HighlightCollection = {
                  id: `hl-${Date.now()}`,
                  ownerId: prev.currentUser.id,
                  title: highlightTitle,
                  coverUrl: story.mediaUrl,
                  coverColor: '#18181b',
                  storyIds: [storyId],
                };
                return {
                  ...prev,
                  highlights: [...prev.highlights, created],
                };
              });
            }}
            onOpenProfile={(userId) => {
              setViewedProfileId(userId);
              setActiveSection('profile');
            }}
            onOpenSearch={() => setShowUserSearch(true)}
            onRequestFollow={(targetUserId) => {
              const rel: FollowRelation = {
                fromUserId: snapshot.currentUser.id,
                toUserId: targetUserId,
                status: 'pending',
                timestamp: Date.now(),
              };
              const ev: MeshEventPayload = { kind: 'social:follow-request', relation: rel };
              applyMeshEvent(ev);
              meshRef.current?.sendMeshEvent(ev);
            }}
            onRespondFollow={(fromUserId, accept) => {
              const ev: MeshEventPayload = {
                kind: 'social:follow-respond',
                fromUserId,
                toUserId: snapshot.currentUser.id,
                status: accept ? 'accepted' : 'rejected',
              };
              applyMeshEvent(ev);
              meshRef.current?.sendMeshEvent(ev);
            }}
          />
        )}
      </main>

      {/* Mobile iOS 27 Floating Glass Pill Bottom Dock */}
      <nav
        aria-label="Navegação mobile"
        className={`md:hidden fixed bottom-2.5 left-3 right-3 z-30 h-14 px-1.5 rounded-full border border-black/[0.08] dark:border-white/[0.12] shadow-2xl grid grid-cols-5 items-center gap-1 ${glassSurfaceClass}`}
      >
        <button
          type="button"
          onClick={() => {
            setViewedProfileId(snapshot.currentUser.id);
            setActiveSection('profile');
          }}
          className={`h-11 rounded-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
            activeSection === 'profile'
              ? 'bg-blue-600/12 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <User className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span>Perfil</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('chat')}
          className={`relative h-11 rounded-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
            activeSection === 'chat'
              ? 'bg-blue-600/12 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span>Chat</span>
          {totalUnreadCount > 0 && (
            <span className="absolute top-1 right-3 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('feed')}
          className={`relative h-11 rounded-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
            activeSection === 'feed'
              ? 'bg-blue-600/12 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Compass className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span>Feed</span>
          {pendingFollowCount > 0 && (
            <span className="absolute top-1.5 right-4 w-2 h-2 rounded-full bg-rose-500" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowUserSearch(true)}
          className="h-11 rounded-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer"
        >
          <Search className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span>Buscar</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSettingsInitialTab('profile');
            setShowSettings(true);
          }}
          className="h-11 rounded-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer"
        >
          <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span>Ajustes</span>
        </button>
      </nav>

      {/* Incoming Call Toast */}
      {incomingCall && !activeCall && (
        <div
          role="dialog"
          aria-label="Chamada recebida"
          className="fixed top-4 right-4 z-50 w-80 rounded-[28px] bg-zinc-900/90 backdrop-blur-2xl text-white border border-white/15 shadow-2xl p-4 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Avatar src={incomingCall.callerAvatar} name={incomingCall.callerName} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{incomingCall.callerName}</p>
              <p className="text-xs text-zinc-400">
                Chamada de {incomingCall.mode === 'video' ? 'vídeo' : 'áudio'}...
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIncomingCall(null)}
              className="px-3 py-1.5 rounded-full bg-zinc-800 text-xs font-medium cursor-pointer"
            >
              Recusar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!currentGroup) return;
                meshRef.current?.sendCallAccept(incomingCall.callId);
                setActiveCall({
                  callId: incomingCall.callId,
                  roomCode: currentGroup.roomCode,
                  mode: incomingCall.mode,
                  initiatorId: incomingCall.callerName,
                  startedAt: Date.now(),
                  participants: [snapshot.currentUser.id],
                  status: 'active',
                });
                setIncomingCall(null);
              }}
              className="px-3.5 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <PhoneIncoming className="w-3.5 h-3.5" />
              <span>Atender</span>
            </button>
          </div>
        </div>
      )}

      {/* Active Audio / Video Call Overlay */}
      {activeCall && currentGroup && (
        <CallOverlay
          mode={activeCall.mode}
          groupName={currentGroup.name}
          currentUser={snapshot.currentUser}
          peers={peers}
          remoteStreams={remoteStreams}
          onClose={() => {
            meshRef.current?.sendCallEnd(activeCall.callId);
            meshRef.current?.clearCallTracks();
            setActiveCall(null);
            setRemoteStreams({});
          }}
          onAttachStream={async (stream) => {
            if (!meshRef.current) return;
            await meshRef.current.attachLocalCallStream(
              stream,
              peers.map((p) => p.peerId)
            );
          }}
        />
      )}

      {/* Global User Directory Search Modal */}
      {showUserSearch && (
        <UserSearchModal
          currentUser={snapshot.currentUser}
          profiles={snapshot.profiles}
          peers={peers}
          followRelations={snapshot.followRelations}
          blockedUserIds={blockedUserIds}
          onClose={() => setShowUserSearch(false)}
          onMergeDirectoryProfiles={mergeDirectoryProfiles}
          onOpenProfile={(userId) => {
            setViewedProfileId(userId);
            setActiveSection('profile');
          }}
          onStartPrivateChat={openOrCreatePrivateChat}
          onRequestFollow={(targetUserId) => {
            const rel: FollowRelation = {
              fromUserId: snapshot.currentUser.id,
              toUserId: targetUserId,
              status: 'pending',
              timestamp: Date.now(),
            };
            const ev: MeshEventPayload = { kind: 'social:follow-request', relation: rel };
            applyMeshEvent(ev);
            meshRef.current?.sendMeshEvent(ev);
          }}
          onToggleBlockUser={handleToggleBlockUser}
        />
      )}

      {/* Group Admin & Server Modal */}
      {showGroupAdmin && currentGroup && (
        <GroupAdminModal
          group={currentGroup}
          peers={peers}
          profiles={snapshot.profiles}
          currentUserId={snapshot.currentUser.id}
          currentPeerId={peerId}
          isCurrentUserAdmin={isCurrentUserAdmin}
          connectionStatus={connectionStatus}
          onClose={() => setShowGroupAdmin(false)}
          onOpenRoomSwitcher={() => {
            setShowGroupAdmin(false);
            setSwitcherTab('contacts');
            setShowRoomSwitcher(true);
          }}
          onStartPrivateChat={(userId) => {
            setShowGroupAdmin(false);
            openOrCreatePrivateChat(userId);
          }}
          onOpenProfile={(userId) => {
            setShowGroupAdmin(false);
            setViewedProfileId(userId);
            setActiveSection('profile');
          }}
          onUpdateGroup={(updated) => {
            const ev: MeshEventPayload = { kind: 'group:config', config: updated };
            applyMeshEvent(ev);
            meshRef.current?.sendMeshEvent(ev);
          }}
          onTransferHost={(targetPeerId) => {
            meshRef.current?.transferHost(targetPeerId);
          }}
          onSwitchRoomCode={(newCode) => {
            const nextGroup: GroupConfig = {
              ...currentGroup,
              roomCode: newCode,
            };
            setSnapshot((prev) => {
              if (!prev) return prev;
              const oldMessages = prev.messagesByRoom[currentGroup.roomCode] || [];
              return {
                ...prev,
                activeRoomCode: newCode,
                groups: { ...prev.groups, [newCode]: nextGroup },
                messagesByRoom: { ...prev.messagesByRoom, [newCode]: oldMessages },
              };
            });
          }}
          onLeaveGroup={handleLeaveGroup}
          onDeleteGroup={handleDeleteConversation}
        />
      )}

      {/* Account & System Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentUser={snapshot.currentUser}
          profiles={snapshot.profiles}
          settings={snapshot.settings}
          stickers={snapshot.stickers || []}
          vaultAccounts={vaultProfilesList}
          blockedUsers={blockedUsersList}
          connectionStatus={connectionStatus}
          latencyMs={latencyMs}
          initialTab={settingsInitialTab}
          onClose={() => setShowSettings(false)}
          onUpdateProfile={(updatedProfile) => {
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    currentUser: updatedProfile,
                    profiles: { ...prev.profiles, [updatedProfile.id]: updatedProfile },
                  }
                : prev
            );
            meshRef.current?.updateUserProfile(updatedProfile);
            meshRef.current?.sendMeshEvent({ kind: 'profile:update', profile: updatedProfile });
            void syncAccountToServer({ profile: updatedProfile });
          }}
          onUpdateSettings={(nextSettings) => {
            setSnapshot((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
            void syncAccountToServer({ settings: nextSettings });
          }}
          onCreateSticker={handleCreateSticker}
          onDeleteSticker={handleDeleteSticker}
          onSwitchAccount={handleSwitchAccount}
          onCreateAccount={handleCreateAccount}
          onDeleteAccount={handleDeleteAccount}
          onSignOutToAuthGate={handleSignOutToAuthGate}
          onToggleBlockUser={handleToggleBlockUser}
          onExportBackup={() => {
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
              type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pulso-backup-${currentGroup?.roomCode || 'conta'}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          onResetLocalData={async () => {
            await clearLocalSnapshot();
            const fresh = normalizeLoadedSnapshot(createInitialSnapshot());
            setAuthToken(null);
            setHasSavedDeviceAccount(false);
            setVaultAccounts({ [fresh.currentUser.id]: fresh });
            setActiveAccountId(fresh.currentUser.id);
            setViewedProfileId(fresh.currentUser.id);
            setActiveSection('profile');
            setShowSettings(false);
            setHasEnteredApp(false);
          }}
        />
      )}

      {/* iOS 27 Conversations, Contacts & Group Switcher Modal */}
      {showRoomSwitcher && (
        <div
          role="dialog"
          aria-label="Contatos, grupos e conversas"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-[32px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.12] shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Conversas e Contatos</h3>
              <button
                type="button"
                onClick={() => setShowRoomSwitcher(false)}
                aria-label="Fechar"
                className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-full bg-zinc-100 dark:bg-zinc-800/80">
              {([
                { id: 'contacts', label: 'Grupos e Contatos' },
                { id: 'create', label: 'Criar Grupo' },
                { id: 'join', label: 'Por Código' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSwitcherTab(tab.id)}
                  className={`py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    switcherTab === tab.id
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {switcherTab === 'contacts' && (
              <div className="space-y-4 max-h-80 overflow-y-auto scrollbar-thin">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Grupos ({Object.values(snapshot.groups).filter((g) => g.kind === 'group').length})
                  </p>
                  {Object.values(snapshot.groups).filter((g) => g.kind === 'group').length === 0 ? (
                    <p className="text-xs text-zinc-500 py-2">
                      Nenhum grupo ativo. Crie um novo ou entre por código.
                    </p>
                  ) : (
                    Object.values(snapshot.groups)
                      .filter((g) => g.kind === 'group')
                      .map((grp) => {
                        const isActive = Boolean(currentGroup && grp.roomCode === currentGroup.roomCode);
                        const unread = unreadByRoom[grp.roomCode];
                        const isAdmin = grp.creatorId === snapshot.currentUser.id;
                        const confirmingGroup = confirmRemoveGroupCode === grp.roomCode;
                        return (
                          <div
                            key={grp.roomCode}
                            className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-2xl border transition-colors ${
                              isActive
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-zinc-50 dark:bg-zinc-950/70 border-black/[0.05] dark:border-white/[0.06]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSnapshot((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        activeRoomCode: grp.roomCode,
                                        unreadByRoom: clearRoomUnread(
                                          prev.unreadByRoom || {},
                                          grp.roomCode
                                        ),
                                      }
                                    : prev
                                );
                                setShowRoomSwitcher(false);
                                setActiveSection('chat');
                              }}
                              className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <Avatar src={grp.avatarUrl} name={grp.name} size="sm" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{grp.name}</p>
                                <p
                                  className={`text-[10px] font-mono truncate ${
                                    isActive ? 'text-white/80' : 'text-zinc-500'
                                  }`}
                                >
                                  {unread && unread.count > 0
                                    ? `${unread.count} nova(s) · ${unread.lastSenderName}`
                                    : grp.roomCode}
                                </p>
                              </div>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {unread && unread.count > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                                  {unread.count}
                                </span>
                              )}
                              {confirmingGroup ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteConversation(grp.roomCode)}
                                  className="px-2.5 py-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  {isAdmin ? 'Confirmar exclusão' : 'Confirmar saída'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveGroupCode(grp.roomCode)}
                                  aria-label={isAdmin ? `Excluir grupo ${grp.name}` : `Sair do grupo ${grp.name}`}
                                  title={isAdmin ? 'Excluir grupo' : 'Sair do grupo'}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                                    isActive
                                      ? 'bg-white/20 hover:bg-rose-500 text-white'
                                      : 'bg-zinc-200/70 dark:bg-zinc-800 hover:bg-rose-500/15 hover:text-rose-500'
                                  }`}
                                >
                                  {isAdmin ? 'Excluir' : 'Sair'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>

                {Object.values(snapshot.groups).some((g) => g.kind === 'dm') && (
                  <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Conversas privadas ({Object.values(snapshot.groups).filter((g) => g.kind === 'dm').length})
                    </p>
                    {Object.values(snapshot.groups)
                      .filter((g) => g.kind === 'dm')
                      .map((grp) => {
                        const isActive = Boolean(currentGroup && grp.roomCode === currentGroup.roomCode);
                        const unread = unreadByRoom[grp.roomCode];
                        const partnerId = grp.dmParticipantIds?.find(
                          (id) => id !== snapshot.currentUser.id
                        );
                        const partner = partnerId ? snapshot.profiles[partnerId] : undefined;
                        const displayName = partner?.name || grp.name;
                        return (
                          <div
                            key={grp.roomCode}
                            className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-2xl border ${
                              isActive
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-zinc-50 dark:bg-zinc-950/70 border-black/[0.05] dark:border-white/[0.06]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSnapshot((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        activeRoomCode: grp.roomCode,
                                        unreadByRoom: clearRoomUnread(
                                          prev.unreadByRoom || {},
                                          grp.roomCode
                                        ),
                                      }
                                    : prev
                                );
                                setShowRoomSwitcher(false);
                                setActiveSection('chat');
                              }}
                              className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <Avatar
                                src={partner?.avatarUrl || grp.avatarUrl}
                                name={displayName}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: partner?.accentColor || '#6366f1',
                                    }}
                                  />
                                  <span>{displayName}</span>
                                </p>
                                <p
                                  className={`text-[10px] truncate ${
                                    isActive ? 'text-white/80' : 'text-zinc-500'
                                  }`}
                                >
                                  {unread && unread.count > 0
                                    ? `${unread.count} nova(s) de ${unread.lastSenderName}`
                                    : 'Privada 1-a-1'}
                                </p>
                              </div>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {unread && unread.count > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                                  {unread.count}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteConversation(grp.roomCode)}
                                aria-label={`Excluir conversa com ${displayName}`}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                                  isActive
                                    ? 'bg-white/20 hover:bg-rose-500 text-white'
                                    : 'bg-zinc-200/70 dark:bg-zinc-800 hover:bg-rose-500/15 hover:text-rose-500'
                                }`}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}

                <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Contatos salvos ({otherUsers.length})
                  </p>
                  {otherUsers.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-4 text-center">
                      Nenhum outro perfil salvo no momento.
                    </p>
                  ) : (
                    otherUsers.map((prof) => {
                      const pref = contactPrefs[prof.id];
                      const displayName = pref?.alias || prof.name;
                      const confirmingContact = confirmRemoveContactId === prof.id;
                      return (
                        <div
                          key={prof.id}
                          className="w-full flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/70 border border-black/[0.05] dark:border-white/[0.06]"
                        >
                          <button
                            type="button"
                            onClick={() => openOrCreatePrivateChat(prof.id)}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <Avatar src={prof.avatarUrl} name={displayName} size="sm" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      pref?.customColor || prof.accentColor || '#3b82f6',
                                  }}
                                />
                                <span>{displayName}</span>
                              </p>
                              <p className="text-[11px] text-zinc-500 truncate">
                                @{prof.handle} · <span className="font-mono">{prof.appId}</span>
                              </p>
                            </div>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openOrCreatePrivateChat(prof.id)}
                              className="px-3 py-1 rounded-full bg-blue-600 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                            >
                              Conversar
                            </button>
                            {confirmingContact ? (
                              <button
                                type="button"
                                onClick={() => handleRemoveContact(prof.id)}
                                className="px-2.5 py-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                              >
                                Confirmar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveContactId(prof.id)}
                                aria-label={`Excluir contato ${displayName}`}
                                title="Excluir contato"
                                className="w-7 h-7 rounded-full bg-zinc-200/70 dark:bg-zinc-800 hover:bg-rose-500/15 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {switcherTab === 'create' && (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="new-group-name"
                    className="block text-xs font-medium text-zinc-500 mb-1"
                  >
                    Nome do novo grupo
                  </label>
                  <input
                    id="new-group-name"
                    type="text"
                    value={newGroupNameInput}
                    onChange={(e) => setNewGroupNameInput(e.target.value)}
                    placeholder="Ex: Design & Café"
                    className="w-full min-h-[42px] px-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                  />
                </div>
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-zinc-500">Código gerado</p>
                    <p className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                      {newGroupCodeInput}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewGroupCodeInput(generateRoomCode('PLS'))}
                    className="px-3 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-medium cursor-pointer"
                  >
                    Gerar outro
                  </button>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRoomSwitcher(false)}
                    className="px-4 py-2 rounded-full text-xs font-medium cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const code = newGroupCodeInput;
                      const cleanName = newGroupNameInput.trim() || `Grupo ${code.slice(4, 8)}`;
                      const created: GroupConfig = {
                        roomCode: code,
                        kind: 'group',
                        name: cleanName,
                        description: 'Grupo criado e hospedado no seu dispositivo.',
                        avatarUrl: '',
                        creatorId: snapshot.currentUser.id,
                        hostPeerId: peerId,
                        accentColor: 'blue',
                        wallpaper: 'minimal',
                        allowMedia: true,
                        allowCalls: true,
                        requireApproval: false,
                        createdAt: Date.now(),
                      };
                      setSnapshot({
                        ...snapshot,
                        activeRoomCode: code,
                        groups: { ...snapshot.groups, [code]: created },
                        messagesByRoom: { ...snapshot.messagesByRoom, [code]: [] },
                      });
                      setNewGroupNameInput('');
                      setNewGroupCodeInput(generateRoomCode('PLS'));
                      setShowRoomSwitcher(false);
                      setActiveSection('chat');
                    }}
                    className="px-4 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Criar grupo
                  </button>
                </div>
              </div>
            )}

            {switcherTab === 'join' && (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="switch-code"
                    className="block text-xs font-medium text-zinc-500 mb-1"
                  >
                    Código de acesso do grupo
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="switch-code"
                      type="text"
                      value={newRoomCodeInput}
                      onChange={(e) => setNewRoomCodeInput(e.target.value.toUpperCase())}
                      placeholder="PLS-XXXX-XX"
                      className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRoomSwitcher(false)}
                    className="px-4 py-2 rounded-full text-xs font-medium cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const code = normalizeRoomCode(newRoomCodeInput);
                      if (!code) return;
                      const grp: GroupConfig = snapshot.groups[code] || {
                        roomCode: code,
                        kind: 'group',
                        name: `Grupo ${code}`,
                        description: 'Conectado por código.',
                        avatarUrl: '',
                        creatorId: snapshot.currentUser.id,
                        hostPeerId: peerId,
                        accentColor: 'blue',
                        wallpaper: 'minimal',
                        allowMedia: true,
                        allowCalls: true,
                        requireApproval: false,
                        createdAt: Date.now(),
                      };
                      setSnapshot({
                        ...snapshot,
                        activeRoomCode: code,
                        groups: { ...snapshot.groups, [code]: grp },
                        messagesByRoom: {
                          ...snapshot.messagesByRoom,
                          [code]: snapshot.messagesByRoom[code] || [],
                        },
                      });
                      setNewRoomCodeInput('');
                      setShowRoomSwitcher(false);
                      setActiveSection('chat');
                    }}
                    className="px-4 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Entrar no grupo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
