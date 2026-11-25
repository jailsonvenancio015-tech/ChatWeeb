import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  MessageCircle,
  Search,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type { FollowRelation, PeerNode, UserProfile } from '../types/app';
import { Avatar } from './Avatar';
import {
  getFollowStatus,
  isThoughtActive,
  isUserBlocked,
  searchProfiles,
} from '../utils/meshProtocol';

interface UserSearchModalProps {
  currentUser: UserProfile;
  profiles: Record<string, UserProfile>;
  peers: PeerNode[];
  followRelations: FollowRelation[];
  blockedUserIds: string[];
  onClose: () => void;
  onMergeDirectoryProfiles: (incoming: UserProfile[]) => void;
  onOpenProfile: (userId: string) => void;
  onStartPrivateChat: (userId: string) => void;
  onRequestFollow: (userId: string) => void;
  onToggleBlockUser: (userId: string) => void;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  currentUser,
  profiles,
  peers,
  followRelations,
  blockedUserIds,
  onClose,
  onMergeDirectoryProfiles,
  onOpenProfile,
  onStartPrivateChat,
  onRequestFollow,
  onToggleBlockUser,
}) => {
  const [query, setQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'online' | 'blocked'>('all');

  useEffect(() => {
    fetch('/api/directory')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.profiles)) {
          onMergeDirectoryProfiles(data.profiles as UserProfile[]);
        }
      })
      .catch(() => {});
  }, [onMergeDirectoryProfiles]);

  const onlineUserIds = useMemo(
    () => new Set(peers.map((p) => p.userId)),
    [peers]
  );

  const results = useMemo(() => {
    const matched = searchProfiles(profiles, query, currentUser.id);
    if (filterTab === 'online') {
      return matched.filter((p) => onlineUserIds.has(p.id));
    }
    if (filterTab === 'blocked') {
      return matched.filter((p) => isUserBlocked(p.id, blockedUserIds));
    }
    return matched;
  }, [profiles, query, currentUser.id, filterTab, onlineUserIds, blockedUserIds]);

  return (
    <div
      role="dialog"
      aria-label="Buscar pessoas e perfis"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-[30px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-5 sm:px-6 pt-5 pb-3 border-b border-zinc-200/80 dark:border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Buscar Pessoas</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Encontre perfis por nome, @usuário ou ID exclusivo
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar busca de pessoas"
              className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, @handle ou USR-XXXX..."
              autoFocus
              className="w-full min-h-[42px] pl-10 pr-9 py-2 rounded-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 rounded-full bg-zinc-100 dark:bg-zinc-800/80">
            {(
              [
                ['all', 'Todos'],
                ['online', 'Online agora'],
                ['blocked', `Bloqueados (${blockedUserIds.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterTab(id)}
                className={`py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  filterTab === id
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-2.5 scrollbar-thin">
          {results.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {filterTab === 'blocked'
                ? 'Nenhum usuário bloqueado.'
                : 'Nenhum perfil encontrado para esta busca.'}
            </div>
          ) : (
            results.map((prof) => {
              const isOnline = onlineUserIds.has(prof.id);
              const blocked = isUserBlocked(prof.id, blockedUserIds);
              const followStatus = getFollowStatus(currentUser.id, prof.id, followRelations);
              const thought = isThoughtActive(prof.thoughtBubble) ? prof.thoughtBubble : null;

              return (
                <div
                  key={prof.id}
                  className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onOpenProfile(prof.id);
                      onClose();
                    }}
                    className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                  >
                    <div className="relative shrink-0">
                      <Avatar src={prof.avatarUrl} name={prof.name} size="md" />
                      {isOnline && (
                        <span
                          title="Online agora"
                          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: prof.accentColor || '#3b82f6' }}
                        />
                        <p className="text-sm font-semibold truncate">{prof.name}</p>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        @{prof.handle} · <span className="font-mono">{prof.appId}</span>
                      </p>
                      {thought && (
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate mt-0.5 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>
                            {thought.emoji} {thought.text}
                          </span>
                        </p>
                      )}
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {blocked ? (
                      <button
                        type="button"
                        onClick={() => onToggleBlockUser(prof.id)}
                        className="px-3.5 py-2 rounded-full bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Desbloquear</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onStartPrivateChat(prof.id);
                            onClose();
                          }}
                          className="px-3.5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>Conversar</span>
                        </button>

                        {followStatus === 'accepted' ? (
                          <span className="px-3 py-2 rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-medium flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Seguindo</span>
                          </span>
                        ) : followStatus === 'pending' ? (
                          <span className="px-3 py-2 rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-medium text-zinc-500">
                            Solicitado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRequestFollow(prof.id)}
                            className="px-3 py-2 rounded-full bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Seguir</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onToggleBlockUser(prof.id)}
                          aria-label={`Bloquear ${prof.name}`}
                          title={`Bloquear ${prof.name}`}
                          className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-500/15 text-zinc-400 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
