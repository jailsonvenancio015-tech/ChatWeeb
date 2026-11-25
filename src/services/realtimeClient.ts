import type { PeerNode, UserProfile } from '../types/app';

export type MeshEventPayload =
  | { kind: 'chat:message'; message: unknown }
  | { kind: 'chat:edit'; roomCode: string; messageId: string; newText: string; editedAt: number }
  | { kind: 'chat:delete'; roomCode: string; messageId: string }
  | { kind: 'chat:reaction'; messageId: string; emoji: string; userId: string }
  | { kind: 'chat:pin'; messageId: string; pinned: boolean }
  | { kind: 'chat:poll-vote'; messageId: string; optionId: string; userId: string }
  | { kind: 'group:config'; config: unknown }
  | { kind: 'social:post'; post: unknown }
  | { kind: 'social:post-edit'; postId: string; patch: Record<string, unknown>; editedAt: number }
  | { kind: 'social:post-delete'; postId: string }
  | { kind: 'social:post-like'; postId: string; userId: string }
  | { kind: 'social:repost'; postId: string; userId: string }
  | { kind: 'social:post-comment'; postId: string; comment: unknown }
  | { kind: 'social:story'; story: unknown }
  | { kind: 'social:story-delete'; storyId: string }
  | { kind: 'social:follow-request'; relation: unknown }
  | { kind: 'social:follow-respond'; fromUserId: string; toUserId: string; status: 'accepted' | 'rejected' }
  | { kind: 'profile:update'; profile: UserProfile }
  | { kind: 'profile:thought'; userId: string; thoughtBubble: UserProfile['thoughtBubble'] };

export interface RealtimeCallbacks {
  onPeersChange: (peers: PeerNode[], hostPeerId: string | null) => void;
  onDirectoryProfiles?: (profiles: UserProfile[]) => void;
  onHostMigrated: (info: {
    previousHostName: string;
    newHostPeerId: string | null;
    newHostName: string;
    peers: PeerNode[];
  }) => void;
  onMeshEvent: (event: MeshEventPayload, fromPeerId: string) => void;
  onSyncRequested: (requesterPeerId: string) => void;
  onSyncSnapshot: (payload: unknown) => void;
  onTyping: (userId: string, userName: string, isTyping: boolean) => void;
  onCallInvite: (data: { callId: string; mode: 'audio' | 'video'; callerId: string; callerName: string; callerAvatar: string }) => void;
  onCallAccept?: (data: { callId: string; peerId: string; userName: string }) => void;
  onCallEnd: (data: { callId: string; endedBy: string }) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerStreamRemoved: (peerId: string) => void;
  onConnectionStatus: (status: 'connecting' | 'connected' | 'reconnecting') => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function detectDeviceLabel(): string {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Web';
  if (/Android/i.test(ua)) return 'Android Web';
  if (/Mac/i.test(ua)) return 'Mac Desktop';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Navegador Web';
}

export class RealtimeMeshClient {
  private ws: WebSocket | null = null;
  private peerId: string;
  private roomCode: string | null = null;
  private currentUser: UserProfile | null = null;
  private callbacks: RealtimeCallbacks;
  private rtcPeers = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private localCallStream: MediaStream | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastLatencyMs: number | undefined = undefined;
  private disposed = false;

  constructor(peerId: string, callbacks: RealtimeCallbacks) {
    this.peerId = peerId;
    this.callbacks = callbacks;
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public getLatencyMs(): number | undefined {
    return this.lastLatencyMs;
  }

  public connect(roomCode: string, user: UserProfile): void {
    this.roomCode = roomCode;
    this.currentUser = user;
    this.disposed = false;
    this.openSocket();
  }

  public updateUserProfile(user: UserProfile): void {
    this.currentUser = user;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'peer:update',
          peer: {
            name: user.name,
            handle: user.handle,
            avatarUrl: user.avatarUrl,
            accentColor: user.accentColor,
          },
        })
      );
      this.ws.send(
        JSON.stringify({
          type: 'directory:register',
          profile: user,
        })
      );
    }
  }

  public transferHost(targetPeerId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'host:transfer',
          targetPeerId,
        })
      );
    }
  }

  public sendMeshEvent(event: MeshEventPayload): void {
    const envelope = {
      type: 'mesh:event',
      event,
      timestamp: Date.now(),
    };

    // Send over active P2P DataChannels where open, plus WebSocket relay for stability
    let sentViaDataChannel = false;
    const raw = JSON.stringify(envelope);
    for (const channel of this.dataChannels.values()) {
      if (channel.readyState === 'open') {
        try {
          channel.send(raw);
          sentViaDataChannel = true;
        } catch {
          // fallback to WS
        }
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          ...envelope,
          p2pAttempted: sentViaDataChannel,
        })
      );
    }
  }

  public sendSyncSnapshot(targetPeerId: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'sync:snapshot',
          targetPeerId,
          payload,
        })
      );
    }
  }

  public sendTyping(isTyping: boolean): void {
    if (!this.currentUser || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'chat:typing',
        userId: this.currentUser.id,
        userName: this.currentUser.name,
        isTyping,
      })
    );
  }

  public sendCallInvite(callId: string, mode: 'audio' | 'video'): void {
    if (!this.currentUser || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'call:invite',
        callId,
        mode,
        callerId: this.currentUser.id,
        callerName: this.currentUser.name,
        callerAvatar: this.currentUser.avatarUrl,
      })
    );
  }

  public sendCallAccept(callId: string): void {
    if (!this.currentUser || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'call:accept',
        callId,
        peerId: this.peerId,
        userName: this.currentUser.name,
      })
    );
  }

  public sendCallEnd(callId: string): void {
    if (!this.currentUser || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'call:end',
        callId,
        endedBy: this.currentUser.name,
      })
    );
  }

  public async attachLocalCallStream(stream: MediaStream | null, peerIds: string[]): Promise<void> {
    this.localCallStream = stream;
    for (const remotePeerId of peerIds) {
      if (remotePeerId === this.peerId) continue;
      const pc = this.ensureRtcConnection(remotePeerId, true);
      if (stream) {
        const senders = pc.getSenders();
        for (const track of stream.getTracks()) {
          const existing = senders.find((s) => s.track?.kind === track.kind);
          if (existing) {
            await existing.replaceTrack(track);
          } else {
            pc.addTrack(track, stream);
          }
        }
      }
      // Renegotiate
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(remotePeerId, { sdp: pc.localDescription });
      } catch {
        // ignore if peer disconnected
      }
    }
  }

  public clearCallTracks(): void {
    this.localCallStream = null;
    for (const pc of this.rtcPeers.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track) {
          try {
            pc.removeTrack(sender);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  public disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const pc of this.rtcPeers.values()) {
      pc.close();
    }
    this.rtcPeers.clear();
    this.dataChannels.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private openSocket(): void {
    if (this.disposed || !this.roomCode || !this.currentUser) return;
    this.callbacks.onConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.callbacks.onConnectionStatus('connected');
      if (!this.roomCode || !this.currentUser) return;
      ws.send(
        JSON.stringify({
          type: 'join',
          roomCode: this.roomCode,
          peer: {
            peerId: this.peerId,
            userId: this.currentUser.id,
            appId: this.currentUser.appId,
            name: this.currentUser.name,
            handle: this.currentUser.handle,
            avatarUrl: this.currentUser.avatarUrl,
            accentColor: this.currentUser.accentColor,
            joinedAt: Date.now(),
            deviceLabel: detectDeviceLabel(),
          },
        })
      );
      ws.send(
        JSON.stringify({
          type: 'directory:register',
          profile: this.currentUser,
        })
      );

      if (this.pingTimer) window.clearInterval(this.pingTimer);
      // Initial ping for fast latency measurement
      ws.send(JSON.stringify({ type: 'ping', clientSentAt: Date.now() }));
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'ping',
              clientSentAt: Date.now(),
              latencyMs: this.lastLatencyMs,
            })
          );
        }
      }, 12000);
    };

    ws.onmessage = async (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(data.type || '');

      if (type === 'pong') {
        if (typeof data.clientSentAt === 'number') {
          this.lastLatencyMs = Math.max(1, Date.now() - data.clientSentAt);
        }
        return;
      }

      if (type === 'joined' || type === 'peers:update') {
        const peers = (data.peers as PeerNode[]) || [];
        const hostPeerId = (data.hostPeerId as string | null) ?? null;
        if (Array.isArray(data.directory) && this.callbacks.onDirectoryProfiles) {
          this.callbacks.onDirectoryProfiles(data.directory as UserProfile[]);
        }
        this.callbacks.onPeersChange(peers, hostPeerId);
        this.reconcileWebRtcMesh(peers);
        return;
      }

      if (type === 'host:migrated') {
        const peers = (data.peers as PeerNode[]) || [];
        this.callbacks.onHostMigrated({
          previousHostName: String(data.previousHostName || 'Anfitrião anterior'),
          newHostPeerId: (data.newHostPeerId as string | null) ?? null,
          newHostName: String(data.newHostName || 'Novo anfitrião'),
          peers,
        });
        this.reconcileWebRtcMesh(peers);
        return;
      }

      if (type === 'sync:request') {
        const requesterPeerId = String(data.requesterPeerId || '');
        if (requesterPeerId) {
          this.callbacks.onSyncRequested(requesterPeerId);
        }
        return;
      }

      if (type === 'sync:snapshot') {
        this.callbacks.onSyncSnapshot(data.payload);
        return;
      }

      if (type === 'mesh:event') {
        this.callbacks.onMeshEvent(
          data.event as MeshEventPayload,
          String(data.fromPeerId || '')
        );
        return;
      }

      if (type === 'chat:typing') {
        this.callbacks.onTyping(
          String(data.userId || ''),
          String(data.userName || ''),
          Boolean(data.isTyping)
        );
        return;
      }

      if (type === 'call:invite') {
        this.callbacks.onCallInvite({
          callId: String(data.callId || ''),
          mode: data.mode === 'video' ? 'video' : 'audio',
          callerId: String(data.callerId || ''),
          callerName: String(data.callerName || ''),
          callerAvatar: String(data.callerAvatar || ''),
        });
        return;
      }

      if (type === 'call:accept') {
        const acceptPeerId = String(data.fromPeerId || data.peerId || '');
        if (this.localCallStream && acceptPeerId) {
          this.attachLocalCallStream(this.localCallStream, [acceptPeerId]).catch(() => {});
        }
        this.callbacks.onCallAccept?.({
          callId: String(data.callId || ''),
          peerId: acceptPeerId,
          userName: String(data.userName || ''),
        });
        return;
      }

      if (type === 'call:end') {
        this.callbacks.onCallEnd({
          callId: String(data.callId || ''),
          endedBy: String(data.endedBy || ''),
        });
        return;
      }

      if (type === 'webrtc:signal') {
        await this.handleRemoteSignal(
          String(data.fromPeerId || ''),
          data.signal as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
        );
      }
    };

    ws.onclose = () => {
      if (this.pingTimer) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.disposed) {
        this.callbacks.onConnectionStatus('reconnecting');
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), 2000);
      }
    };
  }

  private reconcileWebRtcMesh(peers: PeerNode[]): void {
    const activeIds = new Set(peers.map((p) => p.peerId));
    for (const [id, pc] of this.rtcPeers.entries()) {
      if (!activeIds.has(id)) {
        pc.close();
        this.rtcPeers.delete(id);
        this.dataChannels.delete(id);
        this.callbacks.onPeerStreamRemoved(id);
      }
    }

    for (const peer of peers) {
      if (peer.peerId === this.peerId) continue;
      if (!this.rtcPeers.has(peer.peerId)) {
        const shouldInitiate = this.peerId.localeCompare(peer.peerId) < 0;
        const pc = this.ensureRtcConnection(peer.peerId, shouldInitiate);
        if (shouldInitiate) {
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => this.sendSignal(peer.peerId, { sdp: pc.localDescription }))
            .catch(() => {});
        }
      }
    }
  }

  private ensureRtcConnection(remotePeerId: string, createChannel: boolean): RTCPeerConnection {
    const existing = this.rtcPeers.get(remotePeerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.rtcPeers.set(remotePeerId, pc);

    if (this.localCallStream) {
      for (const track of this.localCallStream.getTracks()) {
        pc.addTrack(track, this.localCallStream);
      }
    }

    if (createChannel) {
      const dc = pc.createDataChannel('pulso-mesh', { ordered: true });
      this.bindDataChannel(remotePeerId, dc);
    }

    pc.ondatachannel = (ev) => {
      this.bindDataChannel(remotePeerId, ev.channel);
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal(remotePeerId, { candidate: ev.candidate.toJSON() });
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
      this.callbacks.onRemoteStream(remotePeerId, stream);
    };

    return pc;
  }

  private bindDataChannel(remotePeerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(remotePeerId, dc);
    dc.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as { type?: string; event?: MeshEventPayload };
        if (parsed.type === 'mesh:event' && parsed.event) {
          this.callbacks.onMeshEvent(parsed.event, remotePeerId);
        }
      } catch {
        // ignore malformed p2p frame
      }
    };
  }

  private async handleRemoteSignal(
    fromPeerId: string,
    signal: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
  ): Promise<void> {
    if (!fromPeerId || !signal) return;
    const pc = this.ensureRtcConnection(fromPeerId, false);
    const polite = this.peerId.localeCompare(fromPeerId) < 0;
    try {
      if (signal.sdp) {
        const offerCollision =
          signal.sdp.type === 'offer' && pc.signalingState !== 'stable';
        if (offerCollision && !polite) {
          return;
        }
        if (offerCollision && polite) {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal(fromPeerId, { sdp: pc.localDescription });
        }
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch {
      // ignore transient ICE race
    }
  }

  private sendSignal(targetPeerId: string, signal: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'webrtc:signal',
          targetPeerId,
          signal,
        })
      );
    }
  }
}
