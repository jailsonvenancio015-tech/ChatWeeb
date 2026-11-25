import React, { useEffect, useRef, useState } from 'react';
import { Check, RotateCw, RotateCcw, ZoomIn, ZoomOut, X } from 'lucide-react';

interface AvatarCropperModalProps {
  imageSrc: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}

export const AvatarCropperModal: React.FC<AvatarCropperModalProps> = ({
  imageSrc,
  onCancel,
  onApply,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 400, h: 400 });

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setNaturalSize({ w: img.naturalWidth || 400, h: img.naturalHeight || 400 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: Math.max(-180, Math.min(180, dragStartRef.current.origX + dx)),
      y: Math.max(-180, Math.min(180, dragStartRef.current.origY + dy)),
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const handleExport = () => {
    const img = imgRef.current;
    if (!img) {
      onApply(imageSrc);
      return;
    }

    const OUTPUT_SIZE = 400;
    const PREVIEW_SIZE = 240;
    const ratio = OUTPUT_SIZE / PREVIEW_SIZE;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onApply(imageSrc);
      return;
    }

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2 + offset.x * ratio, OUTPUT_SIZE / 2 + offset.y * ratio);
    ctx.rotate((rotation * Math.PI) / 180);

    const coverScale = Math.max(OUTPUT_SIZE / naturalSize.w, OUTPUT_SIZE / naturalSize.h) * zoom;
    const drawW = naturalSize.w * coverScale;
    const drawH = naturalSize.h * coverScale;

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    try {
      onApply(canvas.toDataURL('image/jpeg', 0.9));
    } catch {
      onApply(imageSrc);
    }
  };

  const previewBaseScale =
    naturalSize.w && naturalSize.h
      ? Math.max(240 / naturalSize.w, 240 / naturalSize.h)
      : 1;

  return (
    <div
      role="dialog"
      aria-label="Encaixar foto de perfil na moldura"
      className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-[30px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold">Ajustar foto na moldura</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Arraste para mover e ajuste o zoom para encaixar perfeitamente
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar ajuste de foto"
            className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Circular Frame */}
        <div className="flex justify-center py-2">
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`relative w-[240px] h-[240px] rounded-full overflow-hidden bg-zinc-950 ring-4 ring-blue-500/40 shadow-2xl select-none touch-none ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <img
              src={imageSrc}
              alt="Prévia na moldura"
              draggable={false}
              style={{
                width: naturalSize.w * previewBaseScale,
                height: naturalSize.h * previewBaseScale,
                maxWidth: 'none',
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotation}deg) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            />
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/40" />
          </div>
        </div>

        {/* Zoom & Rotation Controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-zinc-400 shrink-0" />
            <input
              type="range"
              aria-label="Zoom da foto"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-blue-600 cursor-pointer"
            />
            <ZoomIn className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="font-mono text-xs text-zinc-500 w-10 text-right">
              {zoom.toFixed(1)}x
            </span>
          </div>

          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Girar 90°</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setRotation(0);
                setOffset({ x: 0, y: 0 });
              }}
              className="px-3.5 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Centralizar</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-blue-600/25 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Encaixar na moldura</span>
          </button>
        </div>
      </div>
    </div>
  );
};
