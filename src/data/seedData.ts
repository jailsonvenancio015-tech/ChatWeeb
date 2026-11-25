import type { AccountSettings, UserProfile } from '../types/app';
import type { LocalAppSnapshot } from '../utils/localStore';

export const DEFAULT_ROOM_CODE = 'PLS-2026-AR';

export function createInitialSnapshot(): LocalAppSnapshot {
  const now = Date.now();

  const currentUser: UserProfile = {
    id: 'user-draft',
    appId: 'USR-0000-0',
    name: '',
    handle: '',
    handleEditedCount: 0,
    bio: '',
    avatarUrl: '',
    accentColor: '#3b82f6',
    isPrivate: true,
    joinedAt: now,
    thoughtBubble: null,
  };

  const settings: AccountSettings = {
    theme: 'dark',
    fontScale: 'standard',
    glassIntensity: 'liquid',
    soundEnabled: true,
    compactMessages: false,
    dndMode: false,
    showTypingStatus: true,
    showReadReceipts: true,
    allowPrivateMessagesFrom: 'everyone',
    autoRevealInvisibleInk: false,
    blockedUserIds: [],
    removedContactIds: [],
    mutedRoomCodes: [],
    contactPrefs: {},
    quickReplies: [
      { id: 'qr-1', shortcut: '/oi', label: 'Saudação rápida', text: 'Olá! Já estou conectado no grupo.' },
      { id: 'qr-2', shortcut: '/call', label: 'Chamar para vídeo', text: 'Podemos entrar em chamada de vídeo agora?' },
      { id: 'qr-3', shortcut: '/ok', label: 'Confirmado', text: 'Perfeito, recebido e salvo por aqui!' },
    ],
  };

  return {
    currentUser,
    settings,
    activeRoomCode: null,
    groups: {},
    messagesByRoom: {},
    profiles: {},
    posts: [],
    stories: [],
    highlights: [],
    followRelations: [],
    stickers: [],
    likedPostIds: [],
    unreadByRoom: {},
    updatedAt: now,
  };
}
