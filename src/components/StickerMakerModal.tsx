import React, { useEffect, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Sparkles, Upload, X, ZoomIn } from 'lucide-react';
import type { StickerItem } from '../types/app';

type StickerFrameStyle = 'rounded' | 'circle' | 'diecut' | 'original';

interface StickerMakerModalProps {
  ownerId: string;
  onClose: () => void;
  onSaveSticker: (sticker: StickerItem) => void;
}

export const StickerMakerModal: React.FC<StickerMakerModalProps> = ({
  ownerId,
  onClose,
  onSaveSticker,
}) => {
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [name, setName] = useState('Minha figurinha');
  const [frameStyle, setFrameStyle] = useState<StickerFrameStyle>('diecut');
  const [zoom, setZoom] = useState(1.1);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!sourceUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      ctx.clearRect(0, 0, size, size);

      const padding = frameStyle === 'diecut' ? 28 : 16;
      const innerSize = size - padding * 2;
      const scale = Math.max(innerSize / img.width, innerSize / img.height) * zoom;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const dx = (size - drawW) / 2;
      const dy = (size - drawH) / 2;

      ctx.save();
      if (frameStyle === 'circle') {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, innerSize / 2, 0, Math.PI * 2);
        ctx.clip();
      } else if (frameStyle === 'rounded' || frameStyle === 'diecut') {
        const radius = frameStyle === 'diecut' ? 96 : 76;
        ctx.beginPath();
        ctx.roundRect(padding, padding, innerSize, innerSize, radius);
        ctx.clip();
      }

      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();

      if (frameStyle === 'diecut') {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 18;
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.roundRect(padding, padding, innerSize, innerSize, 96);
        ctx.stroke();
        ctx.restore();
      }

      setPreviewDataUrl(canvas.toDataURL('image/png'));
    };
    img.src = sourceUrl;
  }, [sourceUrl, frameStyle, zoom]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 24);
    if (baseName) setName(baseName);
    const reader = new FileReader();
    reader.onload = () => setSourceUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewDataUrl) return;
    onSaveSticker({
      id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ownerId,
      name: name.trim() || 'Figurinha',
      dataUrl: previewDataUrl,
      createdAt: Date.now(),
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Criar figurinha personalizada"
      className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleConfirm}
        className="w-full max-w-md rounded-[30px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span>Criar Figurinha</span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Transforme qualquer imagem em figurinha pronta para o chat
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar criador de figurinhas"
            className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />

        <div className="rounded-3xl bg-[radial-gradient(circle,rgba(148,163,184,0.22)_1px,transparent_1px)] [background-size:14px_14px] bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 min-h-[220px] flex flex-col items-center justify-center p-4 relative overflow-hidden">
          {previewDataUrl ? (
            <img
              src={previewDataUrl}
              alt="Prévia da figurinha"
              className="w-44 h-44 object-contain drop-shadow-xl"
            />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2.5 text-zinc-500 dark:text-zinc-400 hover:text-blue-500 cursor-pointer transition-colors"
            >
              <div className="w-14 h-14 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shadow-sm">
                <ImageIcon className="w-6 h-6" />
              </div>
              <span className="text-xs font-semibold">Escolher foto ou imagem</span>
            </button>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {sourceUrl && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Trocar imagem</span>
              </button>
              <div className="flex items-center gap-2 flex-1 max-w-[180px]">
                <ZoomIn className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <input
                  type="range"
                  min={0.8}
                  max={2.4}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-zinc-500 mb-1.5">Formato da figurinha</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ['diecut', 'Adesivo'],
                    ['rounded', 'Suave'],
                    ['circle', 'Redonda'],
                    ['original', 'Inteira'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFrameStyle(id)}
                    className={`py-2 rounded-full text-xs font-semibold cursor-pointer ${
                      frameStyle === id
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
              <label htmlFor="sticker-name" className="block text-[11px] font-medium text-zinc-500 mb-1">
                Nome da figurinha
              </label>
              <input
                id="sticker-name"
                type="text"
                maxLength={28}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[40px] px-3.5 py-1.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!previewDataUrl}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Salvar figurinha</span>
          </button>
        </div>
      </form>
    </div>
  );
};
