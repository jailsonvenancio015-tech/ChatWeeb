import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_EDIT_WINDOW_MS,
  buildDmRoomCode,
  canCreateAccountOnDevice,
  canDeleteStory,
  canEditHandleOnce,
  canEditPost,
  canViewPrivateProfileContent,
  clearRoomUnread,
  electNextHost,
  evictOtherProfileCache,
  extractMentions,
  filterVisibleContacts,
  generateAppUserId,
  generateRoomCode,
  isMessageActive,
  isPostActive,
  isStoryActive,
  isThoughtActive,
  isUserBlocked,
  isValidRoomCode,
  leaveOrDeleteGroupFromState,
  mergeMessageHistory,
  recordUnreadMessage,
  removeSavedContact,
  restoreSavedContact,
  searchProfiles,
  validateStrongPassword,
  validateUniqueIdentity,
} from './meshProtocol.ts';
import type { ChatMessage, FollowRelation, GroupConfig, PeerNode, SocialPost, StoryItem, UserProfile } from '../types/app.ts';

test('generateRoomCode and generateAppUserId produce valid structured IDs', () => {
  const code = generateRoomCode('PLS');
  assert.equal(isValidRoomCode(code), true);
  assert.match(code, /^PLS-[A-Z0-9]{4}-[A-Z0-9]{2}$/);

  const uid = generateAppUserId();
  assert.match(uid, /^USR-[A-Z0-9]{4}-[A-Z0-9]$/);
});

test('buildDmRoomCode is order-independent and valid', () => {
  const ab = buildDmRoomCode('user-alpha', 'user-beta');
  const ba = buildDmRoomCode('user-beta', 'user-alpha');
  assert.equal(ab, ba);
  assert.equal(isValidRoomCode(ab), true);
});

test('validateUniqueIdentity enforces unique names, @handles, and once-only @handle editing', () => {
  const profiles: Record<string, UserProfile> = {
    'u-1': {
      id: 'u-1',
      appId: 'USR-1111-A',
      name: 'Clara Mendes',
      handle: 'clara.design',
      handleEditedCount: 0,
      bio: '',
      avatarUrl: '',
      accentColor: '#3b82f6',
      isPrivate: true,
      joinedAt: 1000,
    },
    'u-2': {
      id: 'u-2',
      appId: 'USR-2222-B',
      name: 'Rafael Costa',
      handle: 'rafael.studio',
      handleEditedCount: 1,
      bio: '',
      avatarUrl: '',
      accentColor: '#6366f1',
      isPrivate: true,
      joinedAt: 2000,
    },
  };

  const dupName = validateUniqueIdentity('clara mendes', 'rafael.studio', 'u-2', profiles);
  assert.equal(dupName.ok, false);

  const dupHandle = validateUniqueIdentity('Rafael Novo', '@CLARA.DESIGN', 'u-2', profiles);
  assert.equal(dupHandle.ok, false);

  const lockedHandle = validateUniqueIdentity(
    'Rafael Costa',
    'rafael.novo',
    'u-2',
    profiles,
    'rafael.studio',
    1
  );
  assert.equal(lockedHandle.ok, false);

  const firstHandleChange = validateUniqueIdentity(
    'Clara M.',
    'clara.foto',
    'u-1',
    profiles,
    'clara.design',
    0
  );
  assert.equal(firstHandleChange.ok, true);
});

test('canEditPost enforces 5-minute window and author ownership', () => {
  const now = 10_000_000;
  const post: SocialPost = {
    id: 'p1',
    authorId: 'u-1',
    kind: 'text',
    filterId: 'original',
    caption: 'Hello',
    timestamp: now - 60_000, // 1 min ago
    likedBy: [],
    savedBy: [],
    repostedBy: [],
    comments: [],
  };
  assert.equal(canEditPost(post, 'u-1', now), true);
  assert.equal(canEditPost(post, 'u-2', now), false);
  assert.equal(canEditPost(post, 'u-1', post.timestamp + POST_EDIT_WINDOW_MS + 1), false);
});

test('5-account device limit, handle edit once, block check, and profile search work accurately', () => {
  assert.equal(canCreateAccountOnDevice(4), true);
  assert.equal(canCreateAccountOnDevice(5), false);

  const profiles: Record<string, UserProfile> = {
    'u-1': {
      id: 'u-1',
      appId: 'USR-1027-A',
      name: 'Rafael Costa',
      handle: 'rafael.studio',
      handleEditedCount: 0,
      bio: 'Design e áudio',
      avatarUrl: '',
      accentColor: '#3b82f6',
      isPrivate: true,
      joinedAt: 1,
    },
    'u-2': {
      id: 'u-2',
      appId: 'USR-4481-C',
      name: 'Clara Mendes',
      handle: 'clara.design',
      handleEditedCount: 1,
      bio: 'Fotografia analógica',
      avatarUrl: '',
      accentColor: '#6366f1',
      isPrivate: true,
      joinedAt: 2,
    },
  };

  assert.equal(canEditHandleOnce(profiles['u-1']), true);
  assert.equal(canEditHandleOnce(profiles['u-2']), false);
  assert.equal(isUserBlocked('u-2', ['u-2']), true);
  assert.equal(isUserBlocked('u-1', ['u-2']), false);

  assert.equal(searchProfiles(profiles, 'USR-4481').length, 1);
  assert.equal(searchProfiles(profiles, '@clara')[0].id, 'u-2');
});

test('extractMentions and expiration helpers work deterministically', () => {
  const mentions = extractMentions('Oi @clara.design e @lucas.arq, olhem isso @clara.design');
  assert.deepEqual(mentions, ['clara.design', 'lucas.arq']);

  const now = 50000;
  assert.equal(isThoughtActive({ text: 'Oi', createdAt: 1, expiresAt: 60000, durationLabel: '1h' }, now), true);
  assert.equal(isThoughtActive({ text: 'Oi', createdAt: 1, expiresAt: 40000, durationLabel: '1h' }, now), false);

  const tempPost: SocialPost = {
    id: 'p1',
    authorId: 'u1',
    kind: 'text',
    filterId: 'original',
    caption: 'Temp',
    timestamp: 1000,
    expiresAt: 45000,
    likedBy: [],
    savedBy: [],
    repostedBy: [],
    comments: [],
  };
  assert.equal(isPostActive(tempPost, 46000), false);
  assert.equal(isPostActive(tempPost, 40000), true);

  const tempMsg: ChatMessage = {
    id: 'm1',
    roomCode: 'PLS-1',
    senderId: 'u1',
    senderName: 'A',
    senderHandle: 'a',
    senderAvatar: '',
    text: 'Segredo',
    timestamp: 1000,
    expiresAt: 55000,
    textStyle: 'normal',
    bubbleEffect: 'none',
    screenEffect: 'none',
    attachments: [],
    reactions: {},
    deliveredTo: [],
    readBy: [],
  };
  assert.equal(isMessageActive(tempMsg, 54000), true);
  assert.equal(isMessageActive(tempMsg, 56000), false);
});

test('electNextHost prefers lower-latency or longest-standing peer on host exit', () => {
  const peers: PeerNode[] = [
    {
      peerId: 'peer-host',
      userId: 'u1',
      name: 'Criador',
      handle: 'criador',
      avatarUrl: '',
      joinedAt: 1000,
      lastHeartbeat: 1000,
      latencyMs: 30,
      isHost: true,
      connectionType: 'host',
      deviceLabel: 'Mac',
    },
    {
      peerId: 'peer-2',
      userId: 'u2',
      name: 'Clara',
      handle: 'clara',
      avatarUrl: '',
      joinedAt: 2000,
      lastHeartbeat: 2000,
      latencyMs: 90,
      isHost: false,
      connectionType: 'webrtc',
      deviceLabel: 'iPhone',
    },
    {
      peerId: 'peer-3',
      userId: 'u3',
      name: 'Lucas',
      handle: 'lucas',
      avatarUrl: '',
      joinedAt: 3000,
      lastHeartbeat: 3000,
      latencyMs: 18,
      isHost: false,
      connectionType: 'webrtc',
      deviceLabel: 'Linux',
    },
  ];

  const nextHost = electNextHost(peers, 'peer-host');
  assert.equal(nextHost?.peerId, 'peer-3');
});

test('mergeMessageHistory merges idempotently without duplicates', () => {
  const baseMsg: ChatMessage = {
    id: 'm1',
    roomCode: 'PLS-2026-AR',
    senderId: 'u1',
    senderName: 'Clara',
    senderHandle: 'clara',
    senderAvatar: '',
    text: 'Olá',
    timestamp: 1000,
    textStyle: 'normal',
    bubbleEffect: 'none',
    screenEffect: 'none',
    attachments: [],
    reactions: {},
    deliveredTo: ['u1'],
    readBy: [],
  };
  const updatedMsg: ChatMessage = {
    ...baseMsg,
    reactions: { '❤️': ['u2'] },
    deliveredTo: ['u1', 'u2'],
    readBy: ['u2'],
  };
  const merged = mergeMessageHistory([baseMsg], [updatedMsg]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].reactions, { '❤️': ['u2'] });
});

test('private profile enforces follow permission before exposing content', () => {
  const target: UserProfile = {
    id: 'u-clara',
    appId: 'USR-4481-C',
    name: 'Clara',
    handle: 'clara',
    bio: 'Privada',
    avatarUrl: '',
    accentColor: '#3b82f6',
    isPrivate: true,
    joinedAt: 1000,
  };
  const pending: FollowRelation[] = [
    { fromUserId: 'u-rafael', toUserId: 'u-clara', status: 'pending', timestamp: 1200 },
  ];
  assert.equal(canViewPrivateProfileContent('u-rafael', target, pending), false);
  const accepted: FollowRelation[] = [
    { fromUserId: 'u-rafael', toUserId: 'u-clara', status: 'accepted', timestamp: 1200 },
  ];
  assert.equal(canViewPrivateProfileContent('u-rafael', target, accepted), true);
});

test('validateStrongPassword enforces all security criteria', () => {
  const weak = validateStrongPassword('abc');
  assert.equal(weak.ok, false);
  assert.equal(weak.unmet.length >= 3, true);

  const missingSymbol = validateStrongPassword('SenhaForte123');
  assert.equal(missingSymbol.ok, false);
  assert.equal(missingSymbol.unmet.includes('1 símbolo (!@#$...)'), true);

  const strong = validateStrongPassword('Pulso@2026!');
  assert.equal(strong.ok, true);
  assert.equal(strong.label, 'Excelente');
});

test('recordUnreadMessage tracks unread count + sender and clearRoomUnread resets it', () => {
  const msg: ChatMessage = {
    id: 'm-99',
    roomCode: 'PLS-ROOM-1',
    senderId: 'u-clara',
    senderName: 'Clara Mendes',
    senderHandle: 'clara',
    senderAvatar: '',
    senderColor: '#6366f1',
    text: 'Oi!',
    timestamp: 2000,
    textStyle: 'normal',
    bubbleEffect: 'none',
    screenEffect: 'none',
    attachments: [],
    reactions: {},
    deliveredTo: [],
    readBy: [],
  };

  // User is viewing profile, not chat -> records unread
  const step1 = recordUnreadMessage({}, msg, 'u-rafael', 'PLS-ROOM-1', false);
  assert.equal(step1['PLS-ROOM-1']?.count, 1);
  assert.equal(step1['PLS-ROOM-1']?.lastSenderName, 'Clara Mendes');
  assert.equal(step1['PLS-ROOM-1']?.lastSenderColor, '#6366f1');

  // Same room while actively viewing chat -> ignored
  const step2 = recordUnreadMessage(step1, msg, 'u-rafael', 'PLS-ROOM-1', true);
  assert.equal(step2['PLS-ROOM-1']?.count, 1);

  // Clear when opening room
  const cleared = clearRoomUnread(step1, 'PLS-ROOM-1');
  assert.equal(cleared['PLS-ROOM-1'], undefined);
});

test('evictOtherProfileCache clears other users posts on exit', () => {
  const post: SocialPost = {
    id: 'p-clara',
    authorId: 'u-clara',
    kind: 'text',
    filterId: 'original',
    caption: 'Foto',
    timestamp: 1000,
    likedBy: ['u-rafael'],
    savedBy: [],
    repostedBy: [],
    comments: [],
  };
  const cache = { 'u-clara': [post] };
  assert.equal(Object.keys(evictOtherProfileCache(cache, 'u-clara', 'u-rafael')).length, 1);
  assert.equal(Object.keys(evictOtherProfileCache(cache, 'u-rafael', 'u-rafael')).length, 0);
  assert.equal(Object.keys(evictOtherProfileCache(cache, null, 'u-rafael')).length, 0);
});

test('story expiration, author deletion permission, contact removal, and leaving groups work cleanly', () => {
  const now = 50_000;
  const story: StoryItem = {
    id: 'st-1',
    authorId: 'u-alice',
    kind: 'text',
    filterId: 'original',
    text: 'Bom dia',
    timestamp: 10_000,
    expiresAt: 60_000,
    viewedBy: [],
  };

  assert.equal(isStoryActive(story, now), true);
  assert.equal(isStoryActive(story, 65_000), false);
  assert.equal(canDeleteStory(story, 'u-alice'), true);
  assert.equal(canDeleteStory(story, 'u-bruno'), false);

  const removed1 = removeSavedContact([], 'u-bruno', 'u-alice');
  assert.deepEqual(removed1, ['u-bruno']);
  // Never remove self
  assert.deepEqual(removeSavedContact(removed1, 'u-alice', 'u-alice'), ['u-bruno']);

  const profiles: Record<string, UserProfile> = {
    'u-alice': {
      id: 'u-alice',
      appId: 'USR-1111-A',
      name: 'Alice',
      handle: 'alice',
      bio: '',
      avatarUrl: '',
      accentColor: '#3b82f6',
      isPrivate: true,
      joinedAt: 1,
    },
    'u-bruno': {
      id: 'u-bruno',
      appId: 'USR-2222-B',
      name: 'Bruno',
      handle: 'bruno',
      bio: '',
      avatarUrl: '',
      accentColor: '#10b981',
      isPrivate: true,
      joinedAt: 2,
    },
    'u-carla': {
      id: 'u-carla',
      appId: 'USR-3333-C',
      name: 'Carla',
      handle: 'carla',
      bio: '',
      avatarUrl: '',
      accentColor: '#6366f1',
      isPrivate: true,
      joinedAt: 3,
    },
  };
  assert.deepEqual(
    filterVisibleContacts(profiles, 'u-alice', removed1, []).map((p) => p.id),
    ['u-carla']
  );
  const restored = restoreSavedContact(removed1, 'u-bruno');
  assert.deepEqual(
    filterVisibleContacts(profiles, 'u-alice', restored, []).map((p) => p.id),
    ['u-bruno', 'u-carla']
  );

  const grp1: GroupConfig = {
    roomCode: 'PLS-1111-AA',
    kind: 'group',
    name: 'Sala 1',
    description: '',
    avatarUrl: '',
    creatorId: 'u-alice',
    hostPeerId: 'p1',
    accentColor: 'blue',
    wallpaper: 'minimal',
    allowMedia: true,
    allowCalls: true,
    requireApproval: false,
    createdAt: 100,
  };
  const afterLeave = leaveOrDeleteGroupFromState(
    { [grp1.roomCode]: grp1 },
    { [grp1.roomCode]: [] },
    { [grp1.roomCode]: { count: 2 } },
    grp1.roomCode,
    grp1.roomCode
  );
  assert.equal(Object.keys(afterLeave.groups).length, 0);
  assert.equal(afterLeave.activeRoomCode, null);
  assert.equal(afterLeave.messagesByRoom[grp1.roomCode], undefined);
  assert.equal(afterLeave.unreadByRoom[grp1.roomCode], undefined);
});


