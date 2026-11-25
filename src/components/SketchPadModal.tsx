import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Send, Undo2, X } from 'lucide-react';

interface SketchPadModalProps {
  onClose: () => void;
  onSendSketch: (dataUrl: string) => void;
}

const PEN_COLORS = ['#ffffff', '#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#18181b'];

export const SketchPadModal: React.FC<SketchPadModalProps> = ({ onClose, onSendSketch }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState('#3b82f6');
  const [brushSize, setBrushSize] = useState(4);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([canvas.toDataURL('image/png')]);
  }, []);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = getPoint(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setHistory((prev) => [...prev.slice(-10), canvas.toDataURL('image/png')]);
    }
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const nextHistory = history.slice(0, -1);
    const prevSnapshot = nextHistory[nextHistory.length - 1];
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = prevSnapshot;
    setHistory(nextHistory);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([canvas.toDataURL('image/png')]);
  };

  const handleSend = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSendSketch(canvas.toDataURL('image/png'));
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Desenho rápido no chat"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-[28px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-2xl border border-white/50 dark:border-white/15 shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold">Lousa rápida (iOS Sketch)</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar lousa"
            className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={560}
          height={360}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full aspect-[14/9] rounded-2xl border border-zinc-200 dark:border-zinc-800 touch-none cursor-crosshair bg-zinc-950"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
                style={{ backgroundColor: c }}
                className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer ${
                  color === c ? 'border-blue-500 scale-110' : 'border-zinc-400/40'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {[2, 4, 8].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setBrushSize(size)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer ${
                  brushSize === size
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {size}px
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              className="px-3 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Desfazer</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          </div>
          <button
            type="button"
            onClick={handleSend}
            className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar desenho</span>
          </button>
        </div>
      </div>
    </div>
  );
};
