import type {
  ChatMessage,
  FollowRelation,
  GroupConfig,
  PeerNode,
  SocialPost,
  StoryItem,
  ThoughtBubble,
  UserProfile,
} from '../types/app';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const POST_EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_ACCOUNTS_PER_DEVICE = 5;

/**
 * Generates a readable access code like PLS-7492-XK.
 */
export function generateRoomCode(prefix = 'PLS'): string {
  const part1 = Array.from({ length: 4 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
  const part2 = Array.from({ length: 2 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
  return `${prefix}-${part1}-${part2}`;
}

/**
 * Generates a permanent unique user identification code inside the app (e.g. USR-4920-K).
 */
export function generateAppUserId(): string {
  const digits = Array.from({ length: 4 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
  const suffix = CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `USR-${digits}-${suffix}`;
}

/**
 * Generates a deterministic private 1-on-1 room code for two users.
 */
export function buildDmRoomCode(userIdA: string, userIdB: string): string {
  const sorted = [userIdA, userIdB].sort();
  const sanitize = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(-6) || 'USER';
  return `DM-${sanitize(sorted[0])}-${sanitize(sorted[1])}`;
}

/**
 * Normalizes and validates an access code entered by a user.
 */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

export function isValidRoomCode(raw: string): boolean {
  const normalized = normalizeRoomCode(raw);
  return /^[A-Z0-9]{2,6}-[A-Z0-9]{3,8}(-[A-Z0-9]{2,8})?$/.test(normalized);
}

/**
 * Enforces unique display name, unique @handle, and once-only @handle editing.
 */
export function validateUniqueIdentity(
  candidateName: string,
  candidateHandle: string,
  currentUserId: string,
  profiles: Record<string, UserProfile>,
  existingHandle?: string,
  handleEditedCount = 0
): { ok: true; cleanName: string; cleanHandle: string } | { ok: false; error: string } {
  const cleanName = candidateName.trim();
  const cleanHandle = candidateHandle
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._]/g, '');

  if (cleanName.length < 2) {
    return { ok: false, error: 'O nome deve ter pelo menos 2 caracteres.' };
  }
  if (cleanHandle.length < 3) {
    return { ok: false, error: 'O @usuário deve ter pelo menos 3 caracteres.' };
  }

  if (
    existingHandle &&
    cleanHandle !== existingHandle.trim().toLowerCase() &&
    handleEditedCount >= 1
  ) {
    return {
      ok: false,
      error: 'O @usuário só pode ser editado uma única vez.',
    };
  }

  for (const prof of Object.values(profiles)) {
    if (prof.id === currentUserId) continue;
    if (prof.name.trim().toLowerCase() === cleanName.toLowerCase()) {
      return {
        ok: false,
        error: `O nome "${cleanName}" já está em uso por outro usuário.`,
      };
    }
    if (prof.handle.trim().toLowerCase() === cleanHandle) {
      return {
        ok: false,
        error: `O @${cleanHandle} já está em uso por outro usuário.`,
      };
    }
  }

  return { ok: true, cleanName, cleanHandle };
}

export function canEditHandleOnce(profile: UserProfile): boolean {
  return (profile.handleEditedCount ?? 0) < 1;
}

export function canCreateAccountOnDevice(accountCount: number): boolean {
  return accountCount < MAX_ACCOUNTS_PER_DEVICE;
}

/**
 * Posts can only be edited within 5 minutes of creation, by their author.
 */
export function canEditPost(
  post: SocialPost,
  userId: string,
  now = Date.now()
): boolean {
  if (post.authorId !== userId) return false;
  return now - post.timestamp <= POST_EDIT_WINDOW_MS;
}

export function getPostEditRemainingMs(
  post: SocialPost,
  now = Date.now()
): number {
  return Math.max(0, POST_EDIT_WINDOW_MS - (now - post.timestamp));
}

export function isUserBlocked(
  userId: string,
  blockedUserIds: string[] | undefined
): boolean {
  if (!blockedUserIds || blockedUserIds.length === 0) return false;
  return blockedUserIds.includes(userId);
}

/**
 * Searches profiles by display name, @handle, appId, or bio.
 */
export function searchProfiles(
  profiles: Record<string, UserProfile>,
  query: string,
  excludeUserId?: string
): UserProfile[] {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const list = Object.values(profiles).filter((p) => p.id !== excludeUserId);
  if (!q) return list.sort((a, b) => a.name.localeCompare(b.name));
  return list
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.handle.toLowerCase().includes(q) ||
        p.appId.toLowerCase().includes(q) ||
        p.bio.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      const aExact = a.handle.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q);
      const bExact = b.handle.toLowerCase().startsWith(q) || b.name.toLowerCase().startsWith(q);
      if (aExact !== bExact) return aExact ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Extracts @mentions from text (messages, captions, comments).
 */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9._]{2,30})/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}

export function isThoughtActive(
  thought: ThoughtBubble | null | undefined,
  now = Date.now()
): boolean {
  if (!thought) return false;
  return thought.expiresAt > now;
}

export function isPostActive(post: SocialPost, now = Date.now()): boolean {
  if (!post.expiresAt) return true;
  return post.expiresAt > now;
}

export function isMessageActive(msg: ChatMessage, now = Date.now()): boolean {
  if (!msg.expiresAt) return true;
  return msg.expiresAt > now;
}

export function isStoryActive(story: StoryItem, now = Date.now()): boolean {
  return story.expiresAt > now;
}

export function canDeleteStory(story: StoryItem, userId: string): boolean {
  return Boolean(userId) && story.authorId === userId;
}

export function removeSavedContact(
  removedContactIds: string[] | undefined,
  targetUserId: string,
  currentUserId?: string
): string[] {
  const existing = Array.isArray(removedContactIds) ? removedContactIds : [];
  if (!targetUserId || targetUserId === currentUserId) return existing;
  if (existing.includes(targetUserId)) return existing;
  return [...existing, targetUserId];
}

export function restoreSavedContact(
  removedContactIds: string[] | undefined,
  targetUserId: string
): string[] {
  const existing = Array.isArray(removedContactIds) ? removedContactIds : [];
  if (!existing.includes(targetUserId)) return existing;
  return existing.filter((id) => id !== targetUserId);
}

export function filterVisibleContacts(
  profiles: Record<string, UserProfile>,
  currentUserId: string,
  removedContactIds?: string[],
  blockedUserIds?: string[]
): UserProfile[] {
  const removed = new Set(removedContactIds || []);
  const blocked = new Set(blockedUserIds || []);
  return Object.values(profiles)
    .filter(
      (p) =>
        p &&
        p.id !== currentUserId &&
        !removed.has(p.id) &&
        !blocked.has(p.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function leaveOrDeleteGroupFromState<TUnread>(
  groups: Record<string, GroupConfig>,
  messagesByRoom: Record<string, ChatMessage[]>,
  unreadByRoom: Record<string, TUnread>,
  activeRoomCode: string | null,
  targetRoomCode: string
): {
  groups: Record<string, GroupConfig>;
  messagesByRoom: Record<string, ChatMessage[]>;
  unreadByRoom: Record<string, TUnread>;
  activeRoomCode: string | null;
} {
  if (!groups[targetRoomCode]) {
    return { groups, messagesByRoom, unreadByRoom, activeRoomCode };
  }
  const nextGroups = { ...groups };
  delete nextGroups[targetRoomCode];

  const nextMessages = { ...messagesByRoom };
  delete nextMessages[targetRoomCode];

  const nextUnread = { ...unreadByRoom };
  delete nextUnread[targetRoomCode];

  const remainingCodes = Object.keys(nextGroups);
  const nextActive =
    activeRoomCode === targetRoomCode ? remainingCodes[0] ?? null : activeRoomCode;

  return {
    groups: nextGroups,
    messagesByRoom: nextMessages,
    unreadByRoom: nextUnread,
    activeRoomCode: nextActive,
  };
}

/**
 * Deterministic "best device" host election for shared server failover:
 * prioritizes peers with lower measured latency when available, then longest-standing peer.
 */
export function electNextHost(
  peers: PeerNode[],
  departedHostPeerId?: string
): PeerNode | null {
  const candidates = peers
    .filter((p) => p.peerId !== departedHostPeerId)
    .slice()
    .sort((a, b) => {
      const latA = typeof a.latencyMs === 'number' ? a.latencyMs : Number.MAX_SAFE_INTEGER;
      const latB = typeof b.latencyMs === 'number' ? b.latencyMs : Number.MAX_SAFE_INTEGER;
      // Only prefer latency if difference is meaningful (>25ms)
      if (Math.abs(latA - latB) > 25 && (latA < Number.MAX_SAFE_INTEGER || latB < Number.MAX_SAFE_INTEGER)) {
        return latA - latB;
      }
      if (a.joinedAt !== b.joinedAt) {
        return a.joinedAt - b.joinedAt;
      }
      return a.peerId.localeCompare(b.peerId);
    });

  return candidates.length > 0 ? candidates[0] : null;
}

export function applyHostElection(
  peers: PeerNode[],
  electedHostPeerId: string
): PeerNode[] {
  return peers.map((peer) => ({
    ...peer,
    isHost: peer.peerId === electedHostPeerId,
    connectionType:
      peer.peerId === electedHostPeerId
        ? 'host'
        : peer.connectionType === 'host'
        ? 'webrtc'
        : peer.connectionType,
  }));
}

export function mergeMessageHistory(
  localMessages: ChatMessage[],
  incomingMessages: ChatMessage[]
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  for (const msg of localMessages) {
    byId.set(msg.id, msg);
  }

  for (const msg of incomingMessages) {
    const existing = byId.get(msg.id);
    if (!existing) {
      byId.set(msg.id, msg);
    } else {
      const mergedDelivered = Array.from(
        new Set([...existing.deliveredTo, ...msg.deliveredTo])
      );
      const mergedRead = Array.from(
        new Set([...existing.readBy, ...msg.readBy])
      );
      byId.set(msg.id, {
        ...existing,
        ...msg,
        deliveredTo: mergedDelivered,
        readBy: mergedRead,
        reactions:
          Object.keys(msg.reactions).length >= Object.keys(existing.reactions).length
            ? msg.reactions
            : existing.reactions,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id.localeCompare(b.id);
  });
}

export function getFollowStatus(
  viewerId: string,
  targetUserId: string,
  relations: FollowRelation[]
): 'self' | 'none' | 'pending' | 'accepted' {
  if (viewerId === targetUserId) return 'self';
  const rel = relations.find(
    (r) => r.fromUserId === viewerId && r.toUserId === targetUserId
  );
  return rel ? rel.status : 'none';
}

export function canViewPrivateProfileContent(
  viewerId: string,
  targetProfile: UserProfile,
  relations: FollowRelation[]
): boolean {
  if (viewerId === targetProfile.id) return true;
  if (!targetProfile.isPrivate) return true;
  return getFollowStatus(viewerId, targetProfile.id, relations) === 'accepted';
}

export interface PasswordStrengthResult {
  ok: boolean;
  score: number; // 0..5
  label: 'Fraca' | 'Média' | 'Forte' | 'Excelente';
  unmet: string[];
}

/**
 * Enforces strong passwords for individual Pulso accounts:
 * minimum 8 chars, uppercase, lowercase, digit, and special character.
 */
export function validateStrongPassword(password: string): PasswordStrengthResult {
  const unmet: string[] = [];
  let score = 0;

  if (password.length >= 8) score += 1;
  else unmet.push('Mínimo de 8 caracteres');

  if (/[A-Z]/.test(password)) score += 1;
  else unmet.push('1 letra maiúscula');

  if (/[a-z]/.test(password)) score += 1;
  else unmet.push('1 letra minúscula');

  if (/[0-9]/.test(password)) score += 1;
  else unmet.push('1 número');

  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  else unmet.push('1 símbolo (!@#$...)');

  const label: PasswordStrengthResult['label'] =
    score >= 5 ? 'Excelente' : score >= 4 ? 'Forte' : score >= 3 ? 'Média' : 'Fraca';

  return {
    ok: unmet.length === 0,
    score,
    label,
    unmet,
  };
}

export function recordUnreadMessage(
  current: Record<string, {
    count: number;
    lastSenderId: string;
    lastSenderName: string;
    lastSenderColor?: string;
    lastSenderAvatar?: string;
    lastMessageAt: number;
  }>,
  msg: ChatMessage,
  currentUserId: string,
  activeRoomCode: string | null,
  isViewingChat: boolean
) {
  if (msg.systemEvent || msg.senderId === currentUserId) {
    return current;
  }
  if (isViewingChat && activeRoomCode === msg.roomCode) {
    return current;
  }
  const prev = current[msg.roomCode];
  return {
    ...current,
    [msg.roomCode]: {
      count: (prev?.count ?? 0) + 1,
      lastSenderId: msg.senderId,
      lastSenderName: msg.senderName,
      lastSenderColor: msg.senderColor,
      lastSenderAvatar: msg.senderAvatar,
      lastMessageAt: msg.timestamp,
    },
  };
}

export function clearRoomUnread<T extends Record<string, unknown>>(
  current: T,
  roomCode: string
): T {
  if (!(roomCode in current)) return current;
  const copy = { ...current };
  delete copy[roomCode];
  return copy;
}

/**
 * Evicts cached posts for other users' profiles when the viewer exits their profile,
 * preserving liked post IDs in account state.
 */
export function evictOtherProfileCache(
  cache: Record<string, SocialPost[]>,
  activeProfileId: string | null,
  currentUserId: string
): Record<string, SocialPost[]> {
  if (!activeProfileId || activeProfileId === currentUserId) {
    return {};
  }
  if (cache[activeProfileId]) {
    return { [activeProfileId]: cache[activeProfileId] };
  }
  return {};
}

