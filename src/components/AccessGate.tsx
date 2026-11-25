import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import type { AccountSettings, SocialPost, StickerItem, StoryItem, UserProfile } from '../types/app';
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  validateStrongPassword,
  validateUniqueIdentity,
} from '../utils/meshProtocol';

const PERSONAL_COLORS = [
  { hex: '#3b82f6', label: 'Azul' },
  { hex: '#6366f1', label: 'Índigo' },
  { hex: '#10b981', label: 'Esmeralda' },
  { hex: '#f43f5e', label: 'Rosa' },
  { hex: '#f59e0b', label: 'Âmbar' },
  { hex: '#8b5cf6', label: 'Violeta' },
];

export interface AuthRecoveredPayload {
  token: string;
  profile: UserProfile;
  stickers: StickerItem[];
  likedPostIds: string[];
  settings?: Partial<AccountSettings>;
  posts?: SocialPost[];
  stories?: StoryItem[];
  roomCode: string;
  createGroupName?: string;
}

interface AccessGateProps {
  defaultCode: string;
  userName: string;
  userHandle: string;
  userAppId: string;
  currentUserId: string;
  profiles: Record<string, UserProfile>;
  hasSavedDeviceAccount?: boolean;
  onAuthSuccess: (payload: AuthRecoveredPayload) => void;
  onQuickContinueLocal?: (roomCode: string, displayName: string) => void;
}

export const AccessGate: React.FC<AccessGateProps> = ({
  defaultCode,
  userName,
  userHandle,
  userAppId,
  currentUserId,
  profiles,
  hasSavedDeviceAccount = false,
  onAuthSuccess,
  onQuickContinueLocal,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accentColor, setAccentColor] = useState('#3b82f6');

  const [roomAction, setRoomAction] = useState<'join' | 'create'>('join');
  const [codeInput, setCodeInput] = useState(defaultCode);
  const [groupName, setGroupName] = useState('');
  const [generatedCode, setGeneratedCode] = useState(() => generateRoomCode('PLS'));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwdStrength = useMemo(() => validateStrongPassword(password), [password]);

  const resolveRoomCode = (): { ok: true; roomCode: string; createGroupName?: string } | { ok: false; error: string } => {
    if (roomAction === 'join') {
      const normalized = normalizeRoomCode(codeInput);
      if (!isValidRoomCode(normalized)) {
        return { ok: false, error: 'Código de acesso inválido. Exemplo: PLS-2026-AR' };
      }
      return { ok: true, roomCode: normalized };
    }
    const cleanGroup = groupName.trim();
    if (!cleanGroup) {
      return { ok: false, error: 'Escolha um nome para o novo grupo.' };
    }
    return { ok: true, roomCode: generatedCode, createGroupName: cleanGroup };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const roomCheck = resolveRoomCode();
    if (!roomCheck.ok) {
      setError(roomCheck.error);
      return;
    }

    if (mode === 'login') {
      const cleanUser = username.trim().toLowerCase().replace(/^@/, '');
      if (!cleanUser || !password) {
        setError('Informe seu @usuário e sua senha para recuperar seu perfil.');
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          token?: string;
          account?: {
            profile: UserProfile;
            stickers: StickerItem[];
            likedPostIds: string[];
            settings?: Partial<AccountSettings>;
            posts?: SocialPost[];
            stories?: StoryItem[];
          };
        };
        if (!res.ok || !data.ok || !data.token || !data.account) {
          setError(data.error || 'Usuário ou senha inválidos.');
          setSubmitting(false);
          return;
        }
        onAuthSuccess({
          token: data.token,
          profile: data.account.profile,
          stickers: data.account.stickers || [],
          likedPostIds: data.account.likedPostIds || [],
          settings: data.account.settings,
          posts: data.account.posts || [],
          stories: data.account.stories || [],
          roomCode: roomCheck.roomCode,
          createGroupName: roomCheck.createGroupName,
        });
      } catch {
        setError('Falha ao conectar com o servidor do aplicativo.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Registration mode
    const identityCheck = validateUniqueIdentity(
      displayName,
      username,
      `reg-${Date.now()}`,
      profiles
    );
    if (!identityCheck.ok) {
      setError(identityCheck.error);
      return;
    }
    if (!pwdStrength.ok) {
      setError(`Crie uma senha forte. Falta: ${pwdStrength.unmet.join(', ')}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: identityCheck.cleanName,
          username: identityCheck.cleanHandle,
          password,
          accentColor,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        token?: string;
        account?: {
          profile: UserProfile;
          stickers: StickerItem[];
          likedPostIds: string[];
          settings?: Partial<AccountSettings>;
          posts?: SocialPost[];
          stories?: StoryItem[];
        };
      };
      if (!res.ok || !data.ok || !data.token || !data.account) {
        setError(data.error || 'Não foi possível criar sua conta.');
        setSubmitting(false);
        return;
      }
      onAuthSuccess({
        token: data.token,
        profile: data.account.profile,
        stickers: data.account.stickers || [],
        likedPostIds: data.account.likedPostIds || [],
        settings: data.account.settings,
        posts: data.account.posts || [],
        stories: data.account.stories || [],
        roomCode: roomCheck.roomCode,
        createGroupName: roomCheck.createGroupName,
      });
    } catch {
      setError('Falha ao conectar com o servidor do aplicativo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-4 sm:p-8 relative overflow-y-auto">
      {/* Subtle iOS 27 liquid ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-500/15 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch my-4">
        {/* Editorial Left Column */}
        <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-8 rounded-[32px] bg-white/80 dark:bg-zinc-900/75 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.1] shadow-xl">
          <div>
            <div className="flex items-center justify-between gap-3 mb-7">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-display font-bold text-lg shadow-lg shadow-blue-500/25">
                  P
                </div>
                <div>
                  <span className="font-display text-xl font-bold tracking-tight block leading-none">
                    Pulso
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    iOS 27 Liquid Design · P2P
                  </span>
                </div>
              </div>
              <span className="font-mono text-[11px] px-3 py-1 rounded-full bg-zinc-100/90 dark:bg-zinc-800/80 border border-black/[0.05] dark:border-white/[0.08] text-zinc-600 dark:text-zinc-300 whitespace-nowrap shrink-0">
                {userAppId && userAppId !== 'USR-0000-0' ? userAppId : 'Mesh P2P'}
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-balance leading-tight mb-3">
              Sua conta individual, suas figurinhas e seu chat em tempo real.
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
              Crie seu perfil com @usuário único e senha forte para recuperar suas conversas, publicações e personalizações quando quiser.
            </p>
          </div>

          <div className="space-y-3.5 pt-5 border-t border-black/[0.06] dark:border-white/[0.08]">
            <div className="flex items-start gap-3">
              <Server className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-semibold">Servidor nos dispositivos</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Comunicação fluida com migração automática se o criador sair do grupo.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-semibold">Conta recuperável com senha forte</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Suas postagens, cor do chat e curtidas pertencem exclusivamente ao seu perfil.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Auth Form Right Column */}
        <div className="lg:col-span-7 p-6 sm:p-8 rounded-[32px] bg-white/85 dark:bg-zinc-900/80 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.1] shadow-xl flex flex-col justify-center">
          <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-zinc-100/90 dark:bg-zinc-800/70 rounded-full mb-5 border border-black/[0.04] dark:border-white/[0.06]">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`min-h-[42px] px-3 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Criar conta</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`min-h-[42px] px-3 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'login'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>Entrar no seu perfil</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'register' && (
              <div>
                <label
                  htmlFor="access-display-name"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1"
                >
                  Seu nome único de exibição
                </label>
                <input
                  id="access-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex: Marina Duarte"
                  className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="access-username"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1"
                >
                  @usuário único
                </label>
                <input
                  id="access-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@marina.duarte"
                  autoCapitalize="none"
                  className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="access-password"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1"
                >
                  {mode === 'register' ? 'Crie uma senha forte' : 'Sua senha'}
                </label>
                <div className="relative">
                  <input
                    id="access-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] pl-4 pr-10 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {mode === 'register' && (
              <div className="p-3 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.05] dark:border-white/[0.07] space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-zinc-500">Força da senha</span>
                  <span
                    className={`font-semibold ${
                      pwdStrength.ok
                        ? 'text-emerald-500'
                        : pwdStrength.score >= 3
                        ? 'text-amber-500'
                        : 'text-rose-500'
                    }`}
                  >
                    {pwdStrength.label}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <div
                      key={lvl}
                      className={`h-1.5 rounded-full transition-colors ${
                        pwdStrength.score >= lvl
                          ? pwdStrength.ok
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                          : 'bg-zinc-200 dark:bg-zinc-800'
                      }`}
                    />
                  ))}
                </div>
                {pwdStrength.unmet.length > 0 && (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Falta: {pwdStrength.unmet.join(' · ')}
                  </p>
                )}

                <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-zinc-500">Sua cor no chat:</span>
                  <div className="flex items-center gap-1.5">
                    {PERSONAL_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setAccentColor(c.hex)}
                        aria-label={`Cor ${c.label}`}
                        style={{ backgroundColor: c.hex }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                          accentColor === c.hex
                            ? 'scale-110 ring-2 ring-offset-2 ring-zinc-900 dark:ring-white dark:ring-offset-zinc-950'
                            : ''
                        }`}
                      >
                        {accentColor === c.hex && <Check className="w-3 h-3 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Room Connection Selector */}
            <div className="pt-1 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Sala inicial no servidor
                </span>
                <div className="inline-flex p-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setRoomAction('join')}
                    className={`px-3 py-1 rounded-full font-semibold cursor-pointer ${
                      roomAction === 'join'
                        ? 'bg-white dark:bg-zinc-900 shadow-sm'
                        : 'text-zinc-500'
                    }`}
                  >
                    Por código
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomAction('create')}
                    className={`px-3 py-1 rounded-full font-semibold cursor-pointer ${
                      roomAction === 'create'
                        ? 'bg-white dark:bg-zinc-900 shadow-sm'
                        : 'text-zinc-500'
                    }`}
                  >
                    Criar grupo
                  </button>
                </div>
              </div>

              {roomAction === 'join' ? (
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="access-room-code"
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    placeholder="PLS-2026-AR"
                    className="w-full min-h-[42px] pl-10 pr-4 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] font-mono text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Users className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="create-group-name"
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Nome do novo grupo"
                      className="w-full min-h-[42px] pl-10 pr-3 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] text-sm"
                    />
                  </div>
                  <div className="px-3 py-2 rounded-2xl bg-zinc-50/90 dark:bg-zinc-950/70 border border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                      {generatedCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGeneratedCode(generateRoomCode('PLS'))}
                      className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      Outro
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 rounded-2xl">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] px-5 py-3 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
            >
              {mode === 'login' ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{submitting ? 'Recuperando perfil...' : 'Entrar e recuperar conta'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>{submitting ? 'Criando perfil...' : 'Criar conta e entrar em Meu Perfil'}</span>
                </>
              )}
            </button>

            {hasSavedDeviceAccount && onQuickContinueLocal && (
              <button
                type="button"
                onClick={() => {
                  const clean = normalizeRoomCode(codeInput) || defaultCode;
                  onQuickContinueLocal(clean, userName || `@${userHandle}` || currentUserId);
                }}
                className="w-full py-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Continuar com perfil salvo neste dispositivo ({userName})
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
