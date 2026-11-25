import type { ImageFilterId } from '../types/app';

export interface ImageFilterPreset {
  id: ImageFilterId;
  label: string;
  cssFilter: string;
}

export const IMAGE_FILTERS: ImageFilterPreset[] = [
  { id: 'original', label: 'Original', cssFilter: 'none' },
  {
    id: 'noir',
    label: 'Noir P&B',
    cssFilter: 'grayscale(100%) contrast(118%) brightness(96%)',
  },
  {
    id: 'sepia',
    label: 'Editorial',
    cssFilter: 'sepia(35%) contrast(106%) saturate(92%) brightness(102%)',
  },
  {
    id: 'cinema',
    label: 'Cinema',
    cssFilter: 'contrast(115%) saturate(112%) brightness(94%) hue-rotate(-6deg)',
  },
  {
    id: 'vivid',
    label: 'Vibrante',
    cssFilter: 'saturate(138%) contrast(108%) brightness(104%)',
  },
  {
    id: 'cool',
    label: 'Polaroid',
    cssFilter: 'contrast(96%) brightness(105%) saturate(88%) hue-rotate(8deg)',
  },
  {
    id: 'matte',
    label: 'Fosco',
    cssFilter: 'contrast(88%) brightness(106%) saturate(85%)',
  },
];

export function getCssFilter(filterId: ImageFilterId): string {
  return IMAGE_FILTERS.find((f) => f.id === filterId)?.cssFilter ?? 'none';
}

/**
 * Renders an image dataUrl with the selected CSS filter + brightness/contrast adjustments onto a canvas
 * and returns a compressed JPEG dataUrl for sharing.
 */
export async function applyFilterToImageDataUrl(
  srcUrl: string,
  filterId: ImageFilterId,
  brightness = 100,
  contrast = 100
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 1280;
      let width = img.naturalWidth || 800;
      let height = img.naturalHeight || 800;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(srcUrl);
        return;
      }

      const preset = getCssFilter(filterId);
      const custom = `brightness(${brightness}%) contrast(${contrast}%)`;
      ctx.filter = preset === 'none' ? custom : `${preset} ${custom}`;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(srcUrl);
    img.src = srcUrl;
  });
}
