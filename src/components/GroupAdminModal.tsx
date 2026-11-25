import React, { useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Copy,
  Link2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import type { GroupConfig, GroupWallpaper, PeerNode, UserProfile } from '../types/app';
import { Avatar } from './Avatar';
import { generateRoomCode } from '../utils/meshProtocol';

interface GroupAdminModalProps {
  group: GroupConfig;
  peers: PeerNode[];
  profiles: Record<string, UserProfile>;
  currentUserId: string;
  currentPeerId: string;
  isCurrentUserAdmin: boolean;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
  onClose: () => void;
  onUpdateGroup: (updated: GroupConfig) => void;
  onTransferHost: (targetPeerId: string) => void;
  onSwitchRoomCode: (newCode: string) => void;
  onOpenRoomSwitcher: () => void;
  onStartPrivateChat: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
  onLeaveGroup: (roomCode: string) => void;
  onDeleteGroup: (roomCode: string) => void;
}

const ACCENT_OPTIONS: { id: GroupConfig['accentColor']; label: string; swatch: string }[] = [
  { id: 'blue', label: 'Azul', swatch: 'bg-blue-600' },
  { id: 'emerald', label: 'Esmeralda', swatch: 'bg-emerald-600' },
  { id: 'indigo', label: 'Índigo', swatch: 'bg-indigo-600' },
  { id: 'rose', label: 'Rosa', swatch: 'bg-rose-600' },
  { id: 'amber', label: 'Âmbar', swatch: 'bg-amber-600' },
  { id: 'zinc', label: 'Grafite', swatch: 'bg-zinc-700' },
];

const WALLPAPER_OPTIONS: { id: GroupWallpaper; label: string }[] = [
  { id: 'minimal', label: 'Minimalista' },
  { id: 'gradient', label: 'Gradiente' },
  { id: 'grid', label: 'Grade' },
  { id: 'midnight', label: 'Noturno' },
  { id: 'warm', label: 'Papel Quente' },
];

export const GroupAdminModal: React.FC<GroupAdminModalProps> = ({
  group,
  peers,
  profiles,
  currentUserId,
  currentPeerId,
  isCurrentUserAdmin,
  connectionStatus,
  onClose,
  onUpdateGroup,
  onTransferHost,
  onSwitchRoomCode,
  onOpenRoomSwitcher,
  onStartPrivateChat,
  onOpenProfile,
  onLeaveGroup,
  onDeleteGroup,
}) => {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [avatarUrl, setAvatarUrl] = useState(group.avatarUrl);
  const [accentColor, setAccentColor] = useState<GroupConfig['accentColor']>(group.accentColor);
  const [wallpaper, setWallpaper] = useState<GroupWallpaper>(group.wallpaper);
  const [allowMedia, setAllowMedia] = useState(group.allowMedia);
  const [allowCalls, setAllowCalls] = useState(group.allowCalls);
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);
  const [confirmGroupAction, setConfirmGroupAction] = useState<'leave' | 'delete' | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const copyAccess = async (type: 'code' | 'link') => {
    const value =
      type === 'code'
        ? group.roomCode
        : `${window.location.origin}/?code=${encodeURIComponent(group.roomCode)}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedType(type);
      window.setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCurrentUserAdmin) {
      onClose();
      return;
    }
    onUpdateGroup({
      ...group,
      name: name.trim() || group.name,
      description: description.trim(),
      avatarUrl,
      accentColor,
      wallpaper,
      allowMedia,
      allowCalls,
    });
    onClose();
  };

  const isCurrentDeviceHost = peers.find((p) => p.peerId === currentPeerId)?.isHost ?? false;

  return (
    <div
      role="dialog"
      aria-label="Administração do grupo e servidor"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar src={group.avatarUrl} name={group.name} size="md" />
            <div className="min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold truncate">
                {group.kind === 'dm' ? `Conversa com ${group.name}` : `Perfil do Grupo · ${group.name}`}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {connectionStatus === 'connected'
                  ? 'Rede em tempo real ativa nos dispositivos'
                  : 'Sincronizando rede do grupo...'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar perfil do grupo"
            className="w-10 h-10 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5 scrollbar-thin">

        {/* Access Code Box */}
        <section className="rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Código de acesso ao chat
              </p>
              <p className="font-mono text-2xl font-bold tracking-wider text-blue-600 dark:text-blue-400 mt-0.5">
                {group.roomCode}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copyAccess('code')}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {copiedType === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedType === 'code' ? 'Copiado' : 'Copiar código'}</span>
              </button>
              <button
                type="button"
                onClick={() => copyAccess('link')}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {copiedType === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Link2 className="w-3.5 h-3.5" />}
                <span>{copiedType === 'link' ? 'Link copiado' : 'Copiar link'}</span>
              </button>
              {isCurrentUserAdmin && (
                <button
                  type="button"
                  onClick={() => onSwitchRoomCode(generateRoomCode('PLS'))}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Novo código</span>
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Envie este código ou link para conectar outro computador ou celular diretamente a este grupo em tempo real.
          </p>
        </section>

        {/* Group Members Directory -> Direct Private Chat & Profile Launch */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              <span>Membros no grupo ({Object.keys(profiles).length})</span>
            </h3>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Toque para puxar papo no privado
            </span>
          </div>

          <div className="space-y-2">
            {Object.values(profiles).map((member) => {
              const isMe = member.id === currentUserId;
              const livePeer = peers.find((p) => p.userId === member.id);
              const memberColor = member.accentColor || '#3b82f6';
              return (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={member.avatarUrl}
                      name={member.name}
                      size="sm"
                      isHost={Boolean(livePeer?.isHost)}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: memberColor }}
                        />
                        <span>
                          {member.name} {isMe ? '(Você)' : ''}
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        @{member.handle} · <span className="font-mono">{member.appId}</span>
                        {livePeer ? ' · Online agora' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProfile(member.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>Ver perfil</span>
                    </button>
                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => {
                          onStartPrivateChat(member.id);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Puxar papo no privado</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Active Devices & Host Election */}
        <section className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-500" />
              <span>Dispositivos na rede ({peers.length})</span>
            </h3>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Migração automática ativa
            </span>
          </div>

          <div className="space-y-2">
            {peers.map((peer, idx) => {
              const isMe = peer.peerId === currentPeerId;
              return (
                <div
                  key={peer.peerId}
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={peer.avatarUrl}
                      name={peer.name}
                      size="sm"
                      isHost={peer.isHost}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {peer.name} {isMe ? '(Este dispositivo)' : ''}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {peer.deviceLabel} ·{' '}
                        {peer.isHost
                          ? 'Servidor principal (Host)'
                          : `Reserva #${idx + 1} · WebRTC`}
                      </p>
                    </div>
                  </div>

                  {isCurrentDeviceHost && !peer.isHost && (
                    <button
                      type="button"
                      onClick={() => onTransferHost(peer.peerId)}
                      className="px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-blue-600 hover:text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>Tornar Host</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Admin Customization Form */}
        <form onSubmit={handleSave} className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              <span>Personalização do grupo (Admin)</span>
            </h3>
            {!isCurrentUserAdmin && (
              <span className="text-xs text-zinc-500">Somente o criador pode editar</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={name} size="lg" />
            {isCurrentUserAdmin && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Alterar foto do grupo</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="grp-name" className="block text-xs font-medium text-zinc-500 mb-1">
                Nome do grupo
              </label>
              <input
                id="grp-name"
                type="text"
                disabled={!isCurrentUserAdmin}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="grp-desc" className="block text-xs font-medium text-zinc-500 mb-1">
                Descrição
              </label>
              <input
                id="grp-desc"
                type="text"
                disabled={!isCurrentUserAdmin}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500 mb-2">Cor das mensagens do grupo</p>
            <div className="flex flex-wrap gap-2">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!isCurrentUserAdmin}
                  onClick={() => setAccentColor(opt.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 border transition-colors cursor-pointer disabled:opacity-60 ${
                    accentColor === opt.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${opt.swatch}`} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500 mb-2">Papel de parede do chat</p>
            <div className="flex flex-wrap gap-2">
              {WALLPAPER_OPTIONS.map((wp) => (
                <button
                  key={wp.id}
                  type="button"
                  disabled={!isCurrentUserAdmin}
                  onClick={() => setWallpaper(wp.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-60 ${
                    wallpaper === wp.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {wp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
              <span>Permitir anexos de mídia</span>
              <input
                type="checkbox"
                disabled={!isCurrentUserAdmin}
                checked={allowMedia}
                onChange={(e) => setAllowMedia(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
              <span>Permitir chamadas de áudio/vídeo</span>
              <input
                type="checkbox"
                disabled={!isCurrentUserAdmin}
                checked={allowCalls}
                onChange={(e) => setAllowCalls(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
          </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenRoomSwitcher}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 whitespace-nowrap cursor-pointer"
                >
                  Trocar ou criar grupo
                </button>

                {confirmGroupAction === 'leave' ? (
                  <button
                    type="button"
                    onClick={() => {
                      onLeaveGroup(group.roomCode);
                      onClose();
                    }}
                    className="px-3.5 py-2 rounded-full text-xs font-semibold bg-amber-600 text-white whitespace-nowrap cursor-pointer"
                  >
                    Confirmar saída
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmGroupAction('leave')}
                    className="px-3.5 py-2 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{group.kind === 'dm' ? 'Fechar conversa' : 'Sair do grupo'}</span>
                  </button>
                )}

                {isCurrentUserAdmin && (
                  confirmGroupAction === 'delete' ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteGroup(group.roomCode);
                        onClose();
                      }}
                      className="px-3.5 py-2 rounded-full text-xs font-semibold bg-rose-600 text-white whitespace-nowrap cursor-pointer"
                    >
                      Confirmar exclusão
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmGroupAction('delete')}
                      className="px-3.5 py-2 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir {group.kind === 'dm' ? 'conversa' : 'grupo'}</span>
                    </button>
                  )
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 whitespace-nowrap cursor-pointer"
                >
                  Fechar
                </button>
                {isCurrentUserAdmin && (
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-full text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap cursor-pointer"
                  >
                    Salvar
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
