import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  canDeleteStory,
  canEditPost,
  electNextHost,
  applyHostElection,
  generateAppUserId,
  isPostActive,
  isStoryActive,
  isValidRoomCode,
  normalizeRoomCode,
  validateStrongPassword,
  validateUniqueIdentity,
} from './src/utils/meshProtocol.ts';
import type {
  AccountSettings,
  PeerNode,
  SocialPost,
  StickerItem,
  StoryItem,
  UserProfile,
} from './src/types/app.ts';

interface RoomPeerEntry {
  ws: WebSocket;
  peer: PeerNode;
}

interface RoomState {
  roomCode: string;
  hostPeerId: string | null;
  peers: Map<string, RoomPeerEntry>;
  createdAt: number;
}

interface StoredAccount {
  userId: string;
  usernameLower: string;
  passwordSalt: string;
  passwordHash: string;
  profile: UserProfile;
  stickers: StickerItem[];
  likedPostIds: string[];
  settings?: Partial<AccountSettings>;
  createdAt: number;
  updatedAt: number;
}

interface PersistedStore {
  accounts: Record<string, StoredAccount>;
  posts: SocialPost[];
  stories?: StoryItem[];
}

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), '.pulso-data');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

const rooms = new Map<string, RoomState>();
const globalDirectory = new Map<string, UserProfile>();
const accountsById = new Map<string, StoredAccount>();
const postsById = new Map<string, SocialPost>();
const storiesById = new Map<string, StoryItem>();
const sessions = new Map<string, { userId: string; createdAt: number }>();

function ensureStoreLoaded(): void {
  try {
    if (!STORE_PATH.startsWith(DATA_DIR + path.sep)) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedStore;
      if (parsed.accounts) {
        for (const acc of Object.values(parsed.accounts)) {
          if (acc && acc.userId && acc.profile) {
            accountsById.set(acc.userId, acc);
            globalDirectory.set(acc.profile.id, acc.profile);
          }
        }
      }
      if (Array.isArray(parsed.posts)) {
        for (const post of parsed.posts) {
          if (post && post.id && accountsById.has(post.authorId)) {
            postsById.set(post.id, post);
          }
        }
      }
      if (Array.isArray(parsed.stories)) {
        const now = Date.now();
        for (const st of parsed.stories) {
          if (st && st.id && accountsById.has(st.authorId) && isStoryActive(st, now)) {
            storiesById.set(st.id, st);
          }
        }
      }
    }
  } catch {
    // start cleanly if store file does not exist or is unreadable
  }
}

function persistStore(): void {
  try {
    if (!STORE_PATH.startsWith(DATA_DIR + path.sep)) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload: PersistedStore = {
      accounts: Object.fromEntries(accountsById.entries()),
      posts: Array.from(postsById.values()),
      stories: Array.from(storiesById.values()),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // ignore disk write issues in ephemeral containers
  }
}

function hashPassword(password: string, existingSalt?: string): Promise<{ salt: string; hash: string }> {
  return new Promise((resolve, reject) => {
    const salt = existingSalt || crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve({ salt, hash: derived.toString('hex') });
    });
  });
}

async function verifyPassword(password: string, salt: string, storedHex: string): Promise<boolean> {
  try {
    const { hash } = await hashPassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(storedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sanitizeAccountForClient(acc: StoredAccount) {
  const now = Date.now();
  const ownPosts = Array.from(postsById.values())
    .filter((p) => p.authorId === acc.userId && isPostActive(p, now))
    .sort((a, b) => b.timestamp - a.timestamp);
  const activeStories = Array.from(storiesById.values())
    .filter((s) => isStoryActive(s, now))
    .sort((a, b) => b.timestamp - a.timestamp);
  return {
    profile: acc.profile,
    stickers: acc.stickers || [],
    likedPostIds: acc.likedPostIds || [],
    settings: acc.settings || {},
    posts: ownPosts,
    stories: activeStories,
  };
}

function extractBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function getOrCreateRoom(roomCode: string): RoomState {
  const normalized = normalizeRoomCode(roomCode);
  let room = rooms.get(normalized);
  if (!room) {
    room = {
      roomCode: normalized,
      hostPeerId: null,
      peers: new Map(),
      createdAt: Date.now(),
    };
    rooms.set(normalized, room);
  }
  return room;
}

function getSerializedPeers(room: RoomState): PeerNode[] {
  const list = Array.from(room.peers.values()).map((entry) => entry.peer);
  if (room.hostPeerId) {
    return applyHostElection(list, room.hostPeerId);
  }
  return list;
}

function broadcastToRoom(
  room: RoomState,
  payload: Record<string, unknown>,
  excludePeerId?: string
): void {
  const raw = JSON.stringify(payload);
  for (const [peerId, entry] of room.peers.entries()) {
    if (excludePeerId && peerId === excludePeerId) continue;
    if (entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(raw);
    }
  }
}

function sendToPeer(room: RoomState, targetPeerId: string, payload: Record<string, unknown>): void {
  const entry = room.peers.get(targetPeerId);
  if (entry && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify(payload));
  }
}

function handlePeerLeave(roomCode: string, peerId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;

  const wasHost = room.hostPeerId === peerId;
  const leavingEntry = room.peers.get(peerId);
  room.peers.delete(peerId);

  if (room.peers.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (wasHost) {
    const remainingPeers = Array.from(room.peers.values()).map((e) => e.peer);
    const nextHost = electNextHost(remainingPeers, peerId);
    room.hostPeerId = nextHost ? nextHost.peerId : null;
    const updatedPeers = getSerializedPeers(room);
    for (const p of updatedPeers) {
      const entry = room.peers.get(p.peerId);
      if (entry) entry.peer = p;
    }

    broadcastToRoom(room, {
      type: 'host:migrated',
      roomCode,
      previousHostPeerId: peerId,
      previousHostName: leavingEntry?.peer.name ?? 'Anfitrião anterior',
      newHostPeerId: room.hostPeerId,
      newHostName: nextHost?.name ?? 'Novo dispositivo',
      peers: updatedPeers,
      timestamp: Date.now(),
    });
  } else {
    broadcastToRoom(room, {
      type: 'peers:update',
      roomCode,
      hostPeerId: room.hostPeerId,
      peers: getSerializedPeers(room),
    });
  }
}

async function startServer() {
  ensureStoreLoaded();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
      directoryCount: globalDirectory.size,
      registeredAccounts: accountsById.size,
      timestamp: Date.now(),
    });
  });

  app.get('/api/directory', (_req, res) => {
    const activeOnlineUserIds = new Set<string>();
    for (const room of rooms.values()) {
      for (const entry of room.peers.values()) {
        activeOnlineUserIds.add(entry.peer.userId);
      }
    }
    const realProfiles = Array.from(globalDirectory.values()).filter(
      (p) => accountsById.has(p.id) || activeOnlineUserIds.has(p.id)
    );
    res.json({
      ok: true,
      profiles: realProfiles,
    });
  });

  app.post('/api/auth/register', async (req, res) => {
    const body = req.body as {
      name?: unknown;
      username?: unknown;
      password?: unknown;
      accentColor?: unknown;
      bio?: unknown;
    };

    const rawName = typeof body.name === 'string' ? body.name : '';
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';
    const accentColor =
      typeof body.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accentColor)
        ? body.accentColor
        : '#3b82f6';
    const bio =
      typeof body.bio === 'string' && body.bio.trim()
        ? body.bio.trim().slice(0, 160)
        : 'Perfil individual conectado no Pulso.';

    const pwdCheck = validateStrongPassword(rawPassword);
    if (!pwdCheck.ok) {
      res.status(400).json({
        ok: false,
        error: `Senha fraca. Falta: ${pwdCheck.unmet.join(', ')}.`,
      });
      return;
    }

    const existingProfiles: Record<string, UserProfile> = {};
    for (const p of globalDirectory.values()) {
      existingProfiles[p.id] = p;
    }
    for (const acc of accountsById.values()) {
      existingProfiles[acc.userId] = acc.profile;
    }

    const tempId = `user-${crypto.randomBytes(6).toString('hex')}`;
    const idCheck = validateUniqueIdentity(rawName, rawUsername, tempId, existingProfiles);
    if (!idCheck.ok) {
      res.status(409).json({ ok: false, error: idCheck.error });
      return;
    }

    try {
      const { salt, hash } = await hashPassword(rawPassword);
      const now = Date.now();
      const profile: UserProfile = {
        id: tempId,
        appId: generateAppUserId(),
        name: idCheck.cleanName,
        handle: idCheck.cleanHandle,
        handleEditedCount: 0,
        bio,
        avatarUrl: '',
        accentColor,
        isPrivate: true,
        joinedAt: now,
      };
      const account: StoredAccount = {
        userId: tempId,
        usernameLower: idCheck.cleanHandle,
        passwordSalt: salt,
        passwordHash: hash,
        profile,
        stickers: [],
        likedPostIds: [],
        createdAt: now,
        updatedAt: now,
      };
      accountsById.set(account.userId, account);
      globalDirectory.set(profile.id, profile);
      persistStore();

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userId: account.userId, createdAt: now });

      res.status(201).json({
        ok: true,
        token,
        account: sanitizeAccountForClient(account),
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Erro ao criar conta segura.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const body = req.body as { username?: unknown; password?: unknown };
    const cleanHandle = (typeof body.username === 'string' ? body.username : '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');
    const password = typeof body.password === 'string' ? body.password : '';

    if (!cleanHandle || !password) {
      res.status(400).json({ ok: false, error: 'Informe seu @usuário e senha.' });
      return;
    }

    const account = Array.from(accountsById.values()).find(
      (acc) => acc.usernameLower === cleanHandle || acc.profile.handle.toLowerCase() === cleanHandle
    );

    if (!account) {
      res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos.' });
      return;
    }

    const valid = await verifyPassword(password, account.passwordSalt, account.passwordHash);
    if (!valid) {
      res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: account.userId, createdAt: Date.now() });

    res.json({
      ok: true,
      token,
      account: sanitizeAccountForClient(account),
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (!session) {
      res.status(401).json({ ok: false, error: 'Sessão não autenticada.' });
      return;
    }
    const account = accountsById.get(session.userId);
    if (!account) {
      res.status(404).json({ ok: false, error: 'Conta não encontrada.' });
      return;
    }
    res.json({ ok: true, account: sanitizeAccountForClient(account) });
  });

  app.put('/api/auth/account', (req, res) => {
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (!session) {
      res.status(401).json({ ok: false, error: 'Sessão não autenticada.' });
      return;
    }
    const account = accountsById.get(session.userId);
    if (!account) {
      res.status(404).json({ ok: false, error: 'Conta não encontrada.' });
      return;
    }

    const body = req.body as {
      profile?: Partial<UserProfile>;
      stickers?: StickerItem[];
      likedPostIds?: string[];
      settings?: Partial<AccountSettings>;
    };

    if (body.profile) {
      const candidateName = typeof body.profile.name === 'string' ? body.profile.name : account.profile.name;
      const candidateHandle =
        typeof body.profile.handle === 'string' ? body.profile.handle : account.profile.handle;

      const existingProfiles: Record<string, UserProfile> = {};
      for (const acc of accountsById.values()) {
        existingProfiles[acc.userId] = acc.profile;
      }

      const idCheck = validateUniqueIdentity(
        candidateName,
        candidateHandle,
        account.userId,
        existingProfiles,
        account.profile.handle,
        account.profile.handleEditedCount ?? 0
      );

      if (!idCheck.ok) {
        res.status(409).json({ ok: false, error: idCheck.error });
        return;
      }

      const handleChanged = idCheck.cleanHandle !== account.profile.handle.toLowerCase();
      account.profile = {
        ...account.profile,
        name: idCheck.cleanName,
        handle: idCheck.cleanHandle,
        handleEditedCount: handleChanged
          ? (account.profile.handleEditedCount ?? 0) + 1
          : account.profile.handleEditedCount ?? 0,
        bio: typeof body.profile.bio === 'string' ? body.profile.bio.slice(0, 160) : account.profile.bio,
        avatarUrl:
          typeof body.profile.avatarUrl === 'string'
            ? body.profile.avatarUrl
            : account.profile.avatarUrl,
        accentColor:
          typeof body.profile.accentColor === 'string'
            ? body.profile.accentColor
            : account.profile.accentColor,
        isPrivate:
          typeof body.profile.isPrivate === 'boolean'
            ? body.profile.isPrivate
            : account.profile.isPrivate,
        thoughtBubble:
          body.profile.thoughtBubble !== undefined
            ? body.profile.thoughtBubble
            : account.profile.thoughtBubble,
      };
      account.usernameLower = account.profile.handle.toLowerCase();
      globalDirectory.set(account.profile.id, account.profile);
    }

    if (Array.isArray(body.stickers)) {
      account.stickers = body.stickers.slice(0, 60).map((s) => ({
        ...s,
        ownerId: account.userId,
      }));
    }

    if (Array.isArray(body.likedPostIds)) {
      account.likedPostIds = Array.from(
        new Set(body.likedPostIds.filter((id): id is string => typeof id === 'string'))
      );
    }

    if (body.settings && typeof body.settings === 'object') {
      account.settings = {
        ...account.settings,
        ...body.settings,
      };
    }

    account.updatedAt = Date.now();
    accountsById.set(account.userId, account);
    persistStore();

    res.json({ ok: true, account: sanitizeAccountForClient(account) });
  });

  // App-wide individual posts endpoints (on-demand per-profile loading & ownership enforcement)
  app.get('/api/posts', (req, res) => {
    const authorId = typeof req.query.authorId === 'string' ? req.query.authorId.trim() : '';
    const now = Date.now();
    let list = Array.from(postsById.values()).filter((p) => isPostActive(p, now));
    if (authorId) {
      list = list.filter((p) => p.authorId === authorId);
    }
    list.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ ok: true, posts: list });
  });

  app.post('/api/posts', (req, res) => {
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    const post = req.body?.post as SocialPost | undefined;
    if (!post || !post.id || !post.authorId) {
      res.status(400).json({ ok: false, error: 'Dados da publicação inválidos.' });
      return;
    }
    if (accountsById.has(post.authorId) && session?.userId !== post.authorId) {
      res.status(401).json({ ok: false, error: 'Autenticação necessária para publicar neste perfil.' });
      return;
    }
    if (session && session.userId !== post.authorId) {
      res.status(403).json({ ok: false, error: 'Sem permissão para publicar em outro perfil.' });
      return;
    }
    const cleanPost: SocialPost = {
      ...post,
      repostedBy: Array.isArray(post.repostedBy) ? post.repostedBy : [],
      likedBy: Array.isArray(post.likedBy) ? post.likedBy : [],
      savedBy: Array.isArray(post.savedBy) ? post.savedBy : [],
      comments: Array.isArray(post.comments) ? post.comments : [],
    };
    postsById.set(cleanPost.id, cleanPost);
    persistStore();
    res.status(201).json({ ok: true, post: cleanPost });
  });

  app.patch('/api/posts/:id', (req, res) => {
    const postId = String(req.params.id || '');
    const existing = postsById.get(postId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Publicação não encontrada.' });
      return;
    }
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (accountsById.has(existing.authorId) && session?.userId !== existing.authorId) {
      res.status(401).json({ ok: false, error: 'Autenticação necessária para editar esta publicação.' });
      return;
    }
    const requesterId =
      session?.userId || (typeof req.body?.authorId === 'string' ? req.body.authorId : '');

    if (!canEditPost(existing, requesterId)) {
      res.status(403).json({
        ok: false,
        error: 'Edição permitida apenas ao autor nos primeiros 5 minutos.',
      });
      return;
    }

    const patch = (req.body?.patch || {}) as Partial<SocialPost>;
    const updated: SocialPost = {
      ...existing,
      caption: typeof patch.caption === 'string' ? patch.caption : existing.caption,
      filterId: patch.filterId || existing.filterId,
      textCardBg: patch.textCardBg ?? existing.textCardBg,
      editedAt: Date.now(),
    };
    postsById.set(postId, updated);
    persistStore();
    res.json({ ok: true, post: updated });
  });

  app.delete('/api/posts/:id', (req, res) => {
    const postId = String(req.params.id || '');
    const existing = postsById.get(postId);
    if (!existing) {
      res.json({ ok: true });
      return;
    }
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (accountsById.has(existing.authorId) && session?.userId !== existing.authorId) {
      res.status(401).json({ ok: false, error: 'Autenticação necessária para apagar esta publicação.' });
      return;
    }
    const requesterId =
      session?.userId || (typeof req.query.authorId === 'string' ? req.query.authorId : '');

    if (!requesterId || existing.authorId !== requesterId) {
      res.status(403).json({ ok: false, error: 'Somente o autor pode apagar a publicação.' });
      return;
    }

    postsById.delete(postId);
    persistStore();
    res.json({ ok: true });
  });

  app.post('/api/posts/:id/like', (req, res) => {
    const postId = String(req.params.id || '');
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    const userId =
      session?.userId || (typeof req.body?.userId === 'string' ? req.body.userId : '');
    if (!userId) {
      res.status(400).json({ ok: false, error: 'Usuário inválido.' });
      return;
    }

    const existing = postsById.get(postId);
    let liked = false;
    if (existing) {
      const hasLiked = existing.likedBy.includes(userId);
      liked = !hasLiked;
      existing.likedBy = hasLiked
        ? existing.likedBy.filter((id) => id !== userId)
        : [...existing.likedBy, userId];
      postsById.set(postId, existing);
    }

    const account = accountsById.get(userId);
    if (account) {
      const currentLikes = new Set(account.likedPostIds || []);
      if (currentLikes.has(postId)) {
        currentLikes.delete(postId);
        liked = false;
      } else {
        currentLikes.add(postId);
        liked = true;
      }
      account.likedPostIds = Array.from(currentLikes);
      account.updatedAt = Date.now();
      accountsById.set(userId, account);
    }

    persistStore();
    res.json({ ok: true, liked, post: existing || null });
  });

  // Stories endpoints with individual ownership enforcement
  app.get('/api/stories', (req, res) => {
    const authorId = typeof req.query.authorId === 'string' ? req.query.authorId.trim() : '';
    const now = Date.now();
    let list = Array.from(storiesById.values()).filter((s) => isStoryActive(s, now));
    if (authorId) {
      list = list.filter((s) => s.authorId === authorId);
    }
    list.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ ok: true, stories: list });
  });

  app.post('/api/stories', (req, res) => {
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    const story = req.body?.story as StoryItem | undefined;
    if (!story || !story.id || !story.authorId) {
      res.status(400).json({ ok: false, error: 'Dados do story inválidos.' });
      return;
    }
    if (accountsById.has(story.authorId) && session?.userId !== story.authorId) {
      res.status(401).json({ ok: false, error: 'Autenticação necessária para publicar story neste perfil.' });
      return;
    }
    if (session && session.userId !== story.authorId) {
      res.status(403).json({ ok: false, error: 'Sem permissão para publicar story em outro perfil.' });
      return;
    }
    const cleanStory: StoryItem = {
      ...story,
      viewedBy: Array.isArray(story.viewedBy) ? story.viewedBy : [],
    };
    storiesById.set(cleanStory.id, cleanStory);
    persistStore();
    res.status(201).json({ ok: true, story: cleanStory });
  });

  app.delete('/api/stories/:id', (req, res) => {
    const storyId = String(req.params.id || '');
    const existing = storiesById.get(storyId);
    if (!existing) {
      res.json({ ok: true });
      return;
    }
    const token = extractBearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (accountsById.has(existing.authorId) && session?.userId !== existing.authorId) {
      res.status(401).json({ ok: false, error: 'Autenticação necessária para apagar este story.' });
      return;
    }
    const requesterId =
      session?.userId || (typeof req.query.authorId === 'string' ? req.query.authorId : '');

    if (!canDeleteStory(existing, requesterId)) {
      res.status(403).json({ ok: false, error: 'Somente o autor pode apagar o próprio story.' });
      return;
    }

    storiesById.delete(storyId);
    persistStore();
    res.json({ ok: true });
  });

  app.get('/api/rooms/:code/status', (req, res) => {
    const code = normalizeRoomCode(String(req.params.code || ''));
    if (!isValidRoomCode(code)) {
      res.status(400).json({ ok: false, error: 'Código de acesso inválido.' });
      return;
    }
    const room = rooms.get(code);
    res.json({
      ok: true,
      roomCode: code,
      active: Boolean(room),
      peerCount: room ? room.peers.size : 0,
      hostPeerId: room?.hostPeerId ?? null,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 15 * 1024 * 1024, // 15MB max payload for media attachments
  });

  wss.on('connection', (ws) => {
    let boundRoomCode: string | null = null;
    let boundPeerId: string | null = null;

    ws.on('message', (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';

      if (type === 'ping') {
        if (boundRoomCode && boundPeerId && typeof msg.latencyMs === 'number') {
          const entry = rooms.get(boundRoomCode)?.peers.get(boundPeerId);
          if (entry) {
            entry.peer.latencyMs = Math.max(0, Math.round(msg.latencyMs));
            entry.peer.lastHeartbeat = Date.now();
          }
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'pong',
              clientSentAt: typeof msg.clientSentAt === 'number' ? msg.clientSentAt : undefined,
              timestamp: Date.now(),
            })
          );
        }
        return;
      }

      if (type === 'directory:register') {
        const prof = msg.profile as Partial<UserProfile> | undefined;
        if (
          prof &&
          typeof prof.id === 'string' &&
          prof.id !== 'user-draft' &&
          typeof prof.name === 'string' &&
          prof.name.trim().length > 0
        ) {
          globalDirectory.set(prof.id, {
            id: prof.id,
            appId: typeof prof.appId === 'string' ? prof.appId : 'USR-0000-W',
            name: prof.name.slice(0, 60),
            handle: typeof prof.handle === 'string' ? prof.handle.slice(0, 40) : 'usuario',
            handleEditedCount: typeof prof.handleEditedCount === 'number' ? prof.handleEditedCount : 0,
            bio: typeof prof.bio === 'string' ? prof.bio.slice(0, 180) : '',
            avatarUrl: typeof prof.avatarUrl === 'string' ? prof.avatarUrl : '',
            accentColor: typeof prof.accentColor === 'string' ? prof.accentColor : '#3b82f6',
            isPrivate: prof.isPrivate !== false,
            joinedAt: typeof prof.joinedAt === 'number' ? prof.joinedAt : Date.now(),
            thoughtBubble: prof.thoughtBubble ?? null,
          });
        }
        return;
      }

      if (type === 'join') {
        const rawCode = typeof msg.roomCode === 'string' ? msg.roomCode : '';
        const roomCode = normalizeRoomCode(rawCode);
        if (!isValidRoomCode(roomCode)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Código de sala inválido.' }));
          return;
        }

        const rawPeer = msg.peer as Partial<PeerNode> | undefined;
        if (!rawPeer || typeof rawPeer.peerId !== 'string' || !rawPeer.peerId) {
          return;
        }

        // Clean up previous room binding if switching rooms
        if (boundRoomCode && boundPeerId && boundRoomCode !== roomCode) {
          handlePeerLeave(boundRoomCode, boundPeerId);
        }

        const room = getOrCreateRoom(roomCode);
        const isFirstOrCreator = room.peers.size === 0 || !room.hostPeerId;
        if (isFirstOrCreator) {
          room.hostPeerId = rawPeer.peerId;
        }

        const peer: PeerNode = {
          peerId: rawPeer.peerId,
          userId: typeof rawPeer.userId === 'string' ? rawPeer.userId : rawPeer.peerId,
          appId: typeof rawPeer.appId === 'string' ? rawPeer.appId : undefined,
          name: typeof rawPeer.name === 'string' ? rawPeer.name.slice(0, 60) : 'Dispositivo',
          handle: typeof rawPeer.handle === 'string' ? rawPeer.handle.slice(0, 40) : 'usuario',
          avatarUrl: typeof rawPeer.avatarUrl === 'string' ? rawPeer.avatarUrl : '',
          accentColor: typeof rawPeer.accentColor === 'string' ? rawPeer.accentColor : '#3b82f6',
          joinedAt: typeof rawPeer.joinedAt === 'number' ? rawPeer.joinedAt : Date.now(),
          lastHeartbeat: Date.now(),
          isHost: room.hostPeerId === rawPeer.peerId,
          connectionType: room.hostPeerId === rawPeer.peerId ? 'host' : 'webrtc',
          deviceLabel: typeof rawPeer.deviceLabel === 'string' ? rawPeer.deviceLabel.slice(0, 40) : 'Web',
        };

        boundRoomCode = roomCode;
        boundPeerId = peer.peerId;
        room.peers.set(peer.peerId, { ws, peer });

        const serializedPeers = getSerializedPeers(room);
        ws.send(
          JSON.stringify({
            type: 'joined',
            roomCode,
            hostPeerId: room.hostPeerId,
            isHost: room.hostPeerId === peer.peerId,
            peers: serializedPeers,
            directory: Array.from(globalDirectory.values()),
          })
        );

        broadcastToRoom(
          room,
          {
            type: 'peers:update',
            roomCode,
            hostPeerId: room.hostPeerId,
            peers: serializedPeers,
          },
          peer.peerId
        );

        // Ask the current host device to push authoritative local snapshot to the newcomer
        if (room.hostPeerId && room.hostPeerId !== peer.peerId) {
          sendToPeer(room, room.hostPeerId, {
            type: 'sync:request',
            roomCode,
            requesterPeerId: peer.peerId,
          });
        }
        return;
      }

      if (!boundRoomCode || !boundPeerId) return;
      const room = rooms.get(boundRoomCode);
      if (!room) return;

      // Update heartbeat
      const currentEntry = room.peers.get(boundPeerId);
      if (currentEntry) {
        currentEntry.peer.lastHeartbeat = Date.now();
      }

      if (type === 'peer:update') {
        const patch = msg.peer as Partial<PeerNode> | undefined;
        if (currentEntry && patch) {
          currentEntry.peer = {
            ...currentEntry.peer,
            name: typeof patch.name === 'string' ? patch.name.slice(0, 60) : currentEntry.peer.name,
            handle: typeof patch.handle === 'string' ? patch.handle.slice(0, 40) : currentEntry.peer.handle,
            avatarUrl: typeof patch.avatarUrl === 'string' ? patch.avatarUrl : currentEntry.peer.avatarUrl,
            accentColor: typeof patch.accentColor === 'string' ? patch.accentColor : currentEntry.peer.accentColor,
          };
          broadcastToRoom(room, {
            type: 'peers:update',
            roomCode: boundRoomCode,
            hostPeerId: room.hostPeerId,
            peers: getSerializedPeers(room),
          });
        }
        return;
      }

      if (type === 'host:transfer') {
        const targetPeerId = typeof msg.targetPeerId === 'string' ? msg.targetPeerId : '';
        if (room.hostPeerId === boundPeerId && room.peers.has(targetPeerId)) {
          const previousName = currentEntry?.peer.name ?? 'Anfitrião';
          const nextEntry = room.peers.get(targetPeerId);
          room.hostPeerId = targetPeerId;
          const updatedPeers = getSerializedPeers(room);
          for (const p of updatedPeers) {
            const entry = room.peers.get(p.peerId);
            if (entry) entry.peer = p;
          }
          broadcastToRoom(room, {
            type: 'host:migrated',
            roomCode: boundRoomCode,
            previousHostPeerId: boundPeerId,
            previousHostName: previousName,
            newHostPeerId: targetPeerId,
            newHostName: nextEntry?.peer.name ?? 'Novo dispositivo',
            peers: updatedPeers,
            timestamp: Date.now(),
          });
        }
        return;
      }

      if (type === 'sync:snapshot') {
        const targetPeerId = typeof msg.targetPeerId === 'string' ? msg.targetPeerId : '';
        if (targetPeerId) {
          sendToPeer(room, targetPeerId, {
            type: 'sync:snapshot',
            roomCode: boundRoomCode,
            fromPeerId: boundPeerId,
            payload: msg.payload,
          });
        }
        return;
      }

      // Direct WebRTC signaling
      if (type === 'webrtc:signal') {
        const targetPeerId = typeof msg.targetPeerId === 'string' ? msg.targetPeerId : '';
        if (targetPeerId) {
          sendToPeer(room, targetPeerId, {
            type: 'webrtc:signal',
            fromPeerId: boundPeerId,
            signal: msg.signal,
          });
        }
        return;
      }

      // Broadcast chat, call, and social events across the room
      if (
        type === 'mesh:event' ||
        type === 'call:invite' ||
        type === 'call:accept' ||
        type === 'call:end' ||
        type === 'chat:typing'
      ) {
        broadcastToRoom(
          room,
          {
            ...msg,
            fromPeerId: boundPeerId,
            roomCode: boundRoomCode,
          },
          boundPeerId
        );
      }
    });

    ws.on('close', () => {
      if (boundRoomCode && boundPeerId) {
        handlePeerLeave(boundRoomCode, boundPeerId);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pulso server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Pulso server:', err);
  process.exit(1);
});
