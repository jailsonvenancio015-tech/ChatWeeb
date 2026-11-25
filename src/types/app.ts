export type ThemeMode = 'dark' | 'light';

export type BubbleEffect = 'none' | 'slam' | 'loud' | 'gentle' | 'invisible';
export type ScreenEffect = 'none' | 'confetti' | 'hearts' | 'pulse';
export type TextStyleType = 'normal' | 'bold' | 'editorial' | 'mono' | 'gradient';
export type VoiceEffectType = 'normal' | 'deep' | 'chipmunk' | 'robot' | 'space' | 'radio';

export type TapbackEmoji = '❤️' | '👍' | '👎' | '😂' | '‼️' | '❓';

export interface ThoughtBubble {
  text: string;
  emoji?: string;
  createdAt: number;
  expiresAt: number;
  durationLabel: string;
}

export interface UserProfile {
  id: string;
  appId: string; // Unique user identification code inside the app (e.g. USR-8492-K)
  name: string;
  handle: string;
  handleEditedCount?: number; // @handle can only be changed once (0 -> 1)
  bio: string;
  avatarUrl: string;
  accentColor: string; // Personal color displayed in chat & profile
  isPrivate: boolean;
  joinedAt: number;
  thoughtBubble?: ThoughtBubble | null;
}

export interface PeerNode {
  peerId: string;
  userId: string;
  appId?: string;
  name: string;
  handle: string;
  avatarUrl: string;
  accentColor?: string;
  joinedAt: number;
  lastHeartbeat: number;
  latencyMs?: number;
  isHost: boolean;
  connectionType: 'host' | 'webrtc' | 'relay';
  deviceLabel: string;
}

export interface StickerItem {
  id: string;
  ownerId: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}

export interface UnreadRoomInfo {
  count: number;
  lastSenderId: string;
  lastSenderName: string;
  lastSenderColor?: string;
  lastSenderAvatar?: string;
  lastMessageAt: number;
}

export interface ChatAttachment {
  id: string;
  kind: 'image' | 'video' | 'file' | 'audio' | 'sticker';
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  durationSec?: number;
  voiceEffect?: VoiceEffectType;
  waveform?: number[];
}

export interface PollOption {
  id: string;
  label: string;
  voterIds: string[];
}

export interface ChatPoll {
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
}

export interface SharedPostPreview {
  postId: string;
  authorName: string;
  authorHandle: string;
  caption: string;
  imageUrl?: string;
  textCardBg?: string;
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  senderId: string;
  senderName: string;
  senderHandle: string;
  senderAvatar: string;
  senderColor?: string;
  text: string;
  timestamp: number;
  editedAt?: number;
  expiresAt?: number; // Self-destruct timestamp
  selfDestructSec?: number;
  textStyle: TextStyleType;
  bubbleEffect: BubbleEffect;
  screenEffect: ScreenEffect;
  attachments: ChatAttachment[];
  replyTo?: {
    messageId: string;
    senderName: string;
    textPreview: string;
  };
  reactions: Record<string, string[]>;
  pinned?: boolean;
  poll?: ChatPoll;
  sharedPost?: SharedPostPreview;
  systemEvent?: boolean;
  deliveredTo: string[];
  readBy: string[];
}

export type GroupWallpaper = 'minimal' | 'gradient' | 'grid' | 'midnight' | 'warm';

export interface GroupConfig {
  roomCode: string;
  kind: 'group' | 'dm';
  dmParticipantIds?: string[]; // Exactly 2 userIds for private 1-on-1 chats
  name: string;
  description: string;
  avatarUrl: string;
  creatorId: string;
  hostPeerId: string;
  accentColor: 'blue' | 'emerald' | 'indigo' | 'rose' | 'amber' | 'zinc';
  wallpaper: GroupWallpaper;
  allowMedia: boolean;
  allowCalls: boolean;
  requireApproval: boolean;
  createdAt: number;
}

export type ImageFilterId =
  | 'original'
  | 'noir'
  | 'sepia'
  | 'cinema'
  | 'vivid'
  | 'cool'
  | 'matte';

export interface PostComment {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  text: string;
  timestamp: number;
}

export interface SocialPost {
  id: string;
  authorId: string;
  kind: 'media' | 'text';
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  filterId: ImageFilterId;
  textCardBg?: string;
  textCardAlign?: 'left' | 'center';
  caption: string;
  timestamp: number;
  editedAt?: number;
  expiresAt?: number; // Optional user-selected expiration time
  durationLabel?: string;
  likedBy: string[];
  savedBy: string[];
  repostedBy: string[]; // Users who reposted this publication
  comments: PostComment[];
}

export interface StoryItem {
  id: string;
  authorId: string;
  kind: 'image' | 'text';
  mediaUrl?: string;
  filterId: ImageFilterId;
  text?: string;
  bgGradient?: string;
  timestamp: number;
  expiresAt: number;
  durationLabel?: string;
  viewedBy: string[];
  highlightTitle?: string;
}

export interface HighlightCollection {
  id: string;
  ownerId: string;
  title: string;
  coverUrl?: string;
  coverColor: string;
  storyIds: string[];
}

export type FollowStatus = 'none' | 'pending' | 'accepted';

export interface FollowRelation {
  fromUserId: string;
  toUserId: string;
  status: Exclude<FollowStatus, 'none'>;
  timestamp: number;
}

export interface QuickReplySnippet {
  id: string;
  shortcut: string;
  label: string;
  text: string;
}

export interface ContactPreference {
  alias?: string;
  customColor?: string;
  muted?: boolean;
}

export interface AccountSettings {
  theme: ThemeMode;
  fontScale: 'compact' | 'standard' | 'comfortable';
  glassIntensity: 'subtle' | 'liquid';
  soundEnabled: boolean;
  compactMessages: boolean;
  dndMode: boolean;
  showTypingStatus: boolean;
  showReadReceipts: boolean;
  allowPrivateMessagesFrom: 'everyone' | 'followers';
  autoRevealInvisibleInk: boolean;
  quickReplies: QuickReplySnippet[];
  blockedUserIds: string[];
  removedContactIds?: string[];
  mutedRoomCodes: string[];
  contactPrefs: Record<string, ContactPreference>;
}

export interface ActiveCallState {
  callId: string;
  roomCode: string;
  mode: 'audio' | 'video';
  initiatorId: string;
  startedAt: number;
  participants: string[];
  status: 'ringing' | 'active';
}
