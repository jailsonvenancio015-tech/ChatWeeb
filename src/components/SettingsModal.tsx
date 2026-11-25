import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  Copy,
  Crop,
  Database,
  Download,
  Lock,
  LogOut,
  MessageSquare,
  Mic,
  Moon,
  Palette,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sticker,
  Sun,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type { AccountSettings, QuickReplySnippet, StickerItem, UserProfile } from '../types/app';
import { Avatar } from './Avatar';
import { AvatarCropperModal } from './AvatarCropperModal';
import { StickerMakerModal } from './StickerMakerModal';
import {
  MAX_ACCOUNTS_PER_DEVICE,
  canCreateAccountOnDevice,
  canEditHandleOnce,
  validateUniqueIdentity,
} from '../utils/meshProtocol';

const PERSONAL_COLORS = [
  { hex: '#3b82f6', label: 'Azul' },
  { hex: '#6366f1', label: 'Índigo' },
  { hex: '#10b981', label: 'Esmeralda' },
  { hex: '#f43f5e', label: 'Rosa' },
  { hex: '#f59e0b', label: 'Âmbar' },
  { hex: '#8b5cf6', label: 'Violeta' },
  { hex: '#06b6d4', label: 'Ciano' },
];

interface SettingsModalProps {
  currentUser: UserProfile;
  profiles: Record<string, UserProfile>;
  settings: AccountSettings;
  stickers: StickerItem[];
  vaultAccounts: UserProfile[];
  blockedUsers: UserProfile[];
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
  latencyMs?: number;
  initialTab?: SettingsTab;
  onClose: () => void;
  onUpdateProfile: (profile: UserProfile) => void;
  onUpdateSettings: (settings: AccountSettings) => void;
  onCreateSticker: (sticker: StickerItem) => void;
  onDeleteSticker: (stickerId: string) => void;
  onSwitchAccount: (userId: string) => void;
  onCreateAccount: (name: string, handle: string) => void;
  onDeleteAccount: (userId: string) => void;
  onSignOutToAuthGate: () => void;
  onToggleBlockUser: (userId: string) => void;
  onExportBackup: () => void;
  onResetLocalData: () => void;
}

export type SettingsTab = 'profile' | 'appearance' | 'privacy' | 'chat' | 'stickers' | 'accounts';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  currentUser,
  profiles,
  settings,
  stickers,
  vaultAccounts,
  blockedUsers,
  connectionStatus,
  latencyMs,
  initialTab = 'profile',
  onClose,
  onUpdateProfile,
  onUpdateSettings,
  onCreateSticker,
  onDeleteSticker,
  onSwitchAccount,
  onCreateAccount,
  onDeleteAccount,
  onSignOutToAuthGate,
  onToggleBlockUser,
  onExportBackup,
  onResetLocalData,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [name, setName] = useState(currentUser.name);
  const [handle, setHandle] = useState(currentUser.handle);
  const [bio, setBio] = useState(currentUser.bio);
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl);
  const [accentColor, setAccentColor] = useState(currentUser.accentColor || '#3b82f6');
  const [isPrivate, setIsPrivate] = useState(currentUser.isPrivate);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [showStickerMaker, setShowStickerMaker] = useState(false);

  const [newShortcut, setNewShortcut] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  // Multi-account creation & deletion
  const [newAccName, setNewAccName] = useState('');
  const [newAccHandle, setNewAccHandle] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);

  // Browser permissions status
  const [mediaPermState, setMediaPermState] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [notifPermState, setNotifPermState] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [persistPermState, setPersistPermState] = useState<'unknown' | 'granted' | 'standard'>('unknown');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleIsEditable = canEditHandleOnce(currentUser);
  const canAddAccount = canCreateAccountOnDevice(vaultAccounts.length);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (status.state === 'granted') setMediaPermState('granted');
          else if (status.state === 'denied') setMediaPermState('denied');
        })
        .catch(() => {});
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      navigator.storage
        .persisted()
        .then((persisted) => setPersistPermState(persisted ? 'granted' : 'standard'))
        .catch(() => {});
    }
  }, []);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl) setCropSource(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateUniqueIdentity(
      name,
      handle,
      currentUser.id,
      profiles,
      currentUser.handle,
      currentUser.handleEditedCount ?? 0
    );
    if (!check.ok) {
      setIdentityError(check.error);
      return;
    }

    const handleChanged = check.cleanHandle !== currentUser.handle.trim().toLowerCase();
    const nextEditCount = handleChanged
      ? (currentUser.handleEditedCount ?? 0) + 1
      : currentUser.handleEditedCount ?? 0;

    setIdentityError(null);
    onUpdateProfile({
      ...currentUser,
      name: check.cleanName,
      handle: check.cleanHandle,
      handleEditedCount: nextEditCount,
      bio: bio.trim(),
      avatarUrl,
      accentColor,
      isPrivate,
    });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleCreateNewAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddAccount) {
      setAccountError(`Limite de ${MAX_ACCOUNTS_PER_DEVICE} contas neste dispositivo atingido.`);
      return;
    }

    const allProfilesForCheck: Record<string, UserProfile> = { ...profiles };
    for (const acc of vaultAccounts) {
      allProfilesForCheck[acc.id] = acc;
    }

    const check = validateUniqueIdentity(
      newAccName,
      newAccHandle,
      `new-acc-${Date.now()}`,
      allProfilesForCheck
    );
    if (!check.ok) {
      setAccountError(check.error);
      return;
    }

    setAccountError(null);
    setNewAccName('');
    setNewAccHandle('');
    onCreateAccount(check.cleanName, check.cleanHandle);
    onClose();
  };

  const requestMediaPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      setMediaPermState('granted');
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioOnly.getTracks().forEach((t) => t.stop());
        setMediaPermState('granted');
      } catch {
        setMediaPermState('denied');
      }
    }
  };

  const requestNotifPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotifPermState('unsupported');
      return;
    }
    try {
      const res = await Notification.requestPermission();
      setNotifPermState(res);
    } catch {
      setNotifPermState('denied');
    }
  };

  const requestPersistentStorage = async () => {
    if (!navigator.storage?.persist) return;
    try {
      const ok = await navigator.storage.persist();
      setPersistPermState(ok ? 'granted' : 'standard');
    } catch {
      // ignore
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(currentUser.appId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // ignore
    }
  };

  const addQuickReply = () => {
    if (!newLabel.trim() || !newText.trim()) return;
    const shortcut = newShortcut.trim() || `/${newLabel.trim().toLowerCase().slice(0, 5)}`;
    const item: QuickReplySnippet = {
      id: `qr-${Date.now()}`,
      shortcut: shortcut.startsWith('/') ? shortcut : `/${shortcut}`,
      label: newLabel.trim(),
      text: newText.trim(),
    };
    onUpdateSettings({
      ...settings,
      quickReplies: [...settings.quickReplies, item],
    });
    setNewShortcut('');
    setNewLabel('');
    setNewText('');
  };

  const removeQuickReply = (id: string) => {
    onUpdateSettings({
      ...settings,
      quickReplies: settings.quickReplies.filter((q) => q.id !== id),
    });
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Perfil & ID', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: 'Aparência', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'privacy', label: 'Privacidade', icon: <Lock className="w-3.5 h-3.5" /> },
    { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'stickers', label: 'Figurinhas', icon: <Sticker className="w-3.5 h-3.5" /> },
    { id: 'accounts', label: 'Contas & Rede', icon: <Users className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      role="dialog"
      aria-label="Configurações da conta e sistema"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-[30px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl overflow-hidden">
        <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-zinc-200/80 dark:border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold">Ajustes do Sistema</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Identidade única, contas no dispositivo, privacidade e conectividade web
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Floating Tab Bar */}
        <div className="shrink-0 px-5 sm:px-6 pt-3 pb-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                activeTab === t.id
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5 scrollbar-thin">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-zinc-500">
                    Seu ID de identificação exclusivo no app
                  </p>
                  <p className="font-mono text-base font-bold text-blue-600 dark:text-blue-400">
                    {currentUser.appId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyId}
                  className="px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedId ? 'Copiado' : 'Copiar ID'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div
                  className="rounded-full p-0.5"
                  style={{ boxShadow: `0 0 0 2px ${accentColor}` }}
                >
                  <Avatar src={avatarUrl} name={name} size="lg" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    className="px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Trocar e encaixar foto</span>
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setCropSource(avatarUrl)}
                      className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      <span>Ajustar moldura</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Personal accent color for chat sender identification */}
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-2">
                  Sua cor pessoal (identifica suas mensagens nos grupos)
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  {PERSONAL_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setAccentColor(c.hex)}
                      aria-label={`Cor ${c.label}`}
                      title={c.label}
                      className={`w-8 h-8 rounded-full transition-transform cursor-pointer flex items-center justify-center ${
                        accentColor === c.hex
                          ? 'scale-110 ring-2 ring-offset-2 ring-zinc-900 dark:ring-white dark:ring-offset-zinc-900'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    >
                      {accentColor === c.hex && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="prof-name" className="block text-xs font-medium text-zinc-500 mb-1">
                    Nome único de exibição
                  </label>
                  <input
                    id="prof-name"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setIdentityError(null);
                    }}
                    className="w-full min-h-[42px] px-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="prof-handle" className="block text-xs font-medium text-zinc-500">
                      @usuário único
                    </label>
                    <span
                      className={`text-[10px] font-semibold flex items-center gap-1 ${
                        handleIsEditable ? 'text-blue-500' : 'text-amber-500'
                      }`}
                    >
                      {!handleIsEditable && <Lock className="w-2.5 h-2.5" />}
                      {handleIsEditable ? 'Editável 1 única vez' : 'Bloqueado (já alterado 1x)'}
                    </span>
                  </div>
                  <input
                    id="prof-handle"
                    type="text"
                    value={handle}
                    disabled={!handleIsEditable}
                    onChange={(e) => {
                      setHandle(e.target.value);
                      setIdentityError(null);
                    }}
                    className={`w-full min-h-[42px] px-3.5 py-2 rounded-2xl border text-sm font-mono ${
                      handleIsEditable
                        ? 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800'
                        : 'bg-zinc-200/70 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  />
                </div>
              </div>

              {!handleIsEditable && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Seu @ já foi alterado uma vez e permanece exclusivo desta conta.
                </p>
              )}

              {identityError && (
                <p className="text-xs font-medium text-rose-500 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-xl">
                  {identityError}
                </p>
              )}

              <div>
                <label htmlFor="prof-bio" className="block text-xs font-medium text-zinc-500 mb-1">
                  Biografia curta
                </label>
                <textarea
                  id="prof-bio"
                  rows={2}
                  maxLength={160}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                {savedNotice && (
                  <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Identidade salva
                  </span>
                )}
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Salvar identidade
                </button>
              </div>
            </form>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-2">Tema do aplicativo</p>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: 'dark' })}
                    className={`min-h-[42px] px-4 py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      settings.theme === 'dark'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Escuro (Padrão)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: 'light' })}
                    className={`min-h-[42px] px-4 py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      settings.theme === 'light'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>Claro</span>
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-2">Escala de texto</p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['compact', 'Compacta'],
                      ['standard', 'Padrão'],
                      ['comfortable', 'Confortável'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, fontScale: id })}
                      className={`py-2.5 rounded-full text-xs font-semibold cursor-pointer ${
                        settings.fontScale === id
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-2">Superfície flutuante iOS 27</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, glassIntensity: 'liquid' })}
                    className={`py-2.5 rounded-full text-xs font-semibold cursor-pointer ${
                      settings.glassIntensity === 'liquid'
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    Vidro Líquido (Translúcido)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, glassIntensity: 'subtle' })}
                    className={`py-2.5 rounded-full text-xs font-semibold cursor-pointer ${
                      settings.glassIntensity === 'subtle'
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    Fosco Sólido
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                <span>Mensagens compactas no chat</span>
                <input
                  type="checkbox"
                  checked={settings.compactMessages}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, compactMessages: e.target.checked })
                  }
                  className="w-4 h-4 accent-blue-600"
                />
              </label>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Perfil privado (exigir aprovação para seguir)</span>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setIsPrivate(next);
                      onUpdateProfile({ ...currentUser, isPrivate: next });
                    }}
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Mostrar indicador de digitação em tempo real</span>
                  <input
                    type="checkbox"
                    checked={settings.showTypingStatus}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, showTypingStatus: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Enviar confirmações de leitura</span>
                  <input
                    type="checkbox"
                    checked={settings.showReadReceipts}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, showReadReceipts: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Revelar Tinta Invisível automaticamente</span>
                  <input
                    type="checkbox"
                    checked={settings.autoRevealInvisibleInk}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        autoRevealInvisibleInk: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>

                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <p className="text-xs font-medium">Quem pode iniciar conversa privada (1-a-1)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, allowPrivateMessagesFrom: 'everyone' })
                      }
                      className={`py-2 rounded-full text-xs font-semibold cursor-pointer ${
                        settings.allowPrivateMessagesFrom === 'everyone'
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-200 dark:bg-zinc-800'
                      }`}
                    >
                      Membros do grupo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, allowPrivateMessagesFrom: 'followers' })
                      }
                      className={`py-2 rounded-full text-xs font-semibold cursor-pointer ${
                        settings.allowPrivateMessagesFrom === 'followers'
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-200 dark:bg-zinc-800'
                      }`}
                    >
                      Apenas seguidores
                    </button>
                  </div>
                </div>
              </div>

              {/* Blocked Users Management */}
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Ban className="w-3.5 h-3.5 text-rose-500" />
                    <span>Usuários Bloqueados ({blockedUsers.length})</span>
                  </h3>
                </div>
                {blockedUsers.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                    Nenhum usuário bloqueado. Você pode bloquear ou desbloquear contatos pelo chat ou pela busca de perfis.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {blockedUsers.map((bu) => (
                      <div
                        key={bu.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar src={bu.avatarUrl} name={bu.name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{bu.name}</p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              @{bu.handle} · {bu.appId}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleBlockUser(bu.id)}
                          className="px-3.5 py-1.5 rounded-full bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-600 dark:text-emerald-400 text-xs font-semibold cursor-pointer shrink-0"
                        >
                          Desbloquear
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Sons sutis de envio/recebimento</span>
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, soundEnabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer">
                  <span>Não perturbe (silenciar avisos)</span>
                  <input
                    type="checkbox"
                    checked={settings.dndMode}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, dndMode: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-semibold">Conversas rápidas (Atalhos)</h3>
                <div className="space-y-2">
                  {settings.quickReplies.map((qr) => (
                    <div
                      key={qr.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-blue-500 mr-2">
                          {qr.shortcut}
                        </span>
                        <span className="font-semibold mr-2">{qr.label}:</span>
                        <span className="text-zinc-500 dark:text-zinc-400">{qr.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQuickReply(qr.id)}
                        aria-label={`Remover atalho ${qr.label}`}
                        className="p-1.5 text-zinc-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={newShortcut}
                    onChange={(e) => setNewShortcut(e.target.value)}
                    placeholder="/atalho"
                    className="sm:col-span-3 px-3 py-2 rounded-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Título"
                    className="sm:col-span-3 px-3 py-2 rounded-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                  />
                  <input
                    type="text"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="Texto da resposta rápida..."
                    className="sm:col-span-4 px-3 py-2 rounded-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                  />
                  <button
                    type="button"
                    onClick={addQuickReply}
                    className="sm:col-span-2 px-3 py-2 rounded-full bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Criar</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'stickers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span>Minhas Figurinhas ({stickers.length})</span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Transforme fotos em figurinhas para enviar nas conversas ou exclua quando quiser.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStickerMaker(true)}
                  className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Transformar imagem em figurinha</span>
                </button>
              </div>

              {stickers.length === 0 ? (
                <div className="py-10 text-center space-y-2 rounded-2xl bg-zinc-50/70 dark:bg-zinc-950/60 border border-dashed border-zinc-300 dark:border-zinc-800">
                  <Sticker className="w-8 h-8 mx-auto text-zinc-400" />
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Você ainda não criou figurinhas personalizadas.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {stickers.map((stk) => (
                    <div
                      key={stk.id}
                      className="relative group rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-2.5 flex flex-col items-center gap-1.5"
                    >
                      <img
                        src={stk.dataUrl}
                        alt={stk.name}
                        className="w-20 h-20 object-contain"
                      />
                      <p className="text-[11px] font-medium truncate w-full text-center">
                        {stk.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => onDeleteSticker(stk.id)}
                        aria-label={`Excluir figurinha ${stk.name}`}
                        title="Excluir figurinha"
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-rose-600/90 hover:bg-rose-600 text-white flex items-center justify-center shadow-sm cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="space-y-5">
              {/* Multi-Account Device Vault (Max 5) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Contas neste dispositivo ({vaultAccounts.length}/{MAX_ACCOUNTS_PER_DEVICE})
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Cada dispositivo pode gerenciar até {MAX_ACCOUNTS_PER_DEVICE} perfis individuais com dados salvos localmente.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {vaultAccounts.map((acc) => {
                    const isActive = acc.id === currentUser.id;
                    const confirmingDel = confirmDeleteAccountId === acc.id;
                    return (
                      <div
                        key={acc.id}
                        className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-500/40'
                            : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar src={acc.avatarUrl} name={acc.name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                              <span>{acc.name}</span>
                              {isActive && (
                                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px]">
                                  Ativa
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                              @{acc.handle} · <span className="font-mono">{acc.appId}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                onSwitchAccount(acc.id);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                            >
                              Entrar
                            </button>
                          )}

                          {confirmingDel ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteAccount(acc.id);
                                  setConfirmDeleteAccountId(null);
                                }}
                                className="px-3 py-1.5 rounded-full bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Confirmar exclusão
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteAccountId(null)}
                                className="px-2.5 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-[11px] cursor-pointer"
                              >
                                Não
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAccountId(acc.id)}
                              aria-label={`Apagar conta ${acc.name}`}
                              className="px-3 py-1.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 hover:bg-rose-500/15 hover:text-rose-500 text-xs font-medium flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Apagar conta</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Create New Account on Device */}
                {canAddAccount ? (
                  <form
                    onSubmit={handleCreateNewAccount}
                    className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3"
                  >
                    <p className="text-xs font-semibold flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-blue-500" />
                      <span>Criar nova conta neste dispositivo</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newAccName}
                        onChange={(e) => {
                          setNewAccName(e.target.value);
                          setAccountError(null);
                        }}
                        placeholder="Nome único (ex: Lucas Lima)"
                        className="px-3.5 py-2 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                      />
                      <input
                        type="text"
                        value={newAccHandle}
                        onChange={(e) => {
                          setNewAccHandle(e.target.value);
                          setAccountError(null);
                        }}
                        placeholder="@usuário único (ex: lucaslima)"
                        className="px-3.5 py-2 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                      />
                    </div>
                    {accountError && (
                      <p className="text-xs text-rose-500 font-medium">{accountError}</p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Criar e entrar</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Limite máximo de {MAX_ACCOUNTS_PER_DEVICE} contas por dispositivo atingido. Apague uma conta existente para criar outra.
                    </span>
                  </p>
                )}
              </div>

              {/* Browser Permissions & Connectivity */}
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Wifi className="w-4 h-4 text-blue-500" />
                    <span>Conectividade & Permissões do Navegador</span>
                  </h3>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 ${
                      connectionStatus === 'connected'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    <Radio className="w-3 h-3" />
                    <span>
                      {connectionStatus === 'connected'
                        ? `WebSocket + P2P Ativo${typeof latencyMs === 'number' ? ` · ${latencyMs} ms` : ''}`
                        : connectionStatus === 'connecting'
                        ? 'Conectando...'
                        : 'Reconectando...'}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={requestMediaPermissions}
                    className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 text-left space-y-1 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <Camera className="w-3.5 h-3.5 text-blue-500" />
                        <Mic className="w-3.5 h-3.5 text-blue-500" />
                      </span>
                      <span className="text-[10px] font-semibold text-zinc-500">
                        {mediaPermState === 'granted'
                          ? 'Liberado'
                          : mediaPermState === 'denied'
                          ? 'Bloqueado'
                          : 'Testar'}
                      </span>
                    </div>
                    <p className="text-xs font-medium">Câmera e Microfone</p>
                  </button>

                  <button
                    type="button"
                    onClick={requestNotifPermission}
                    className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 text-left space-y-1 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      <span className="text-[10px] font-semibold text-zinc-500">
                        {notifPermState === 'granted'
                          ? 'Ativas'
                          : notifPermState === 'denied'
                          ? 'Bloqueadas'
                          : notifPermState === 'unsupported'
                          ? 'Web Padrão'
                          : 'Permitir'}
                      </span>
                    </div>
                    <p className="text-xs font-medium">Notificações Web</p>
                  </button>

                  <button
                    type="button"
                    onClick={requestPersistentStorage}
                    className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 text-left space-y-1 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <Database className="w-4 h-4 text-blue-500" />
                      <span className="text-[10px] font-semibold text-zinc-500">
                        {persistPermState === 'granted' ? 'Persistente' : 'Ativar'}
                      </span>
                    </div>
                    <p className="text-xs font-medium">Banco Local Offline</p>
                  </button>
                </div>
              </div>

              {/* Backup & Factory Reset & Sign Out */}
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSignOutToAuthGate();
                  }}
                  className="px-4 py-2.5 rounded-full bg-blue-600/15 hover:bg-blue-600/25 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair / Entrar com outra conta</span>
                </button>
                <button
                  type="button"
                  onClick={onExportBackup}
                  className="px-4 py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar Backup JSON</span>
                </button>
                {confirmReset ? (
                  <button
                    type="button"
                    onClick={() => {
                      onResetLocalData();
                      setConfirmReset(false);
                    }}
                    className="px-4 py-2.5 rounded-full bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Confirmar limpeza total do dispositivo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="px-4 py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:text-rose-500 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar padrão de fábrica</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {cropSource && (
        <AvatarCropperModal
          imageSrc={cropSource}
          onCancel={() => setCropSource(null)}
          onApply={(cropped) => {
            setAvatarUrl(cropped);
            setCropSource(null);
            onUpdateProfile({
              ...currentUser,
              avatarUrl: cropped,
            });
          }}
        />
      )}

      {showStickerMaker && (
        <StickerMakerModal
          ownerId={currentUser.id}
          onClose={() => setShowStickerMaker(false)}
          onSaveSticker={(stk) => {
            onCreateSticker(stk);
            setShowStickerMaker(false);
          }}
        />
      )}
    </div>
  );
};
