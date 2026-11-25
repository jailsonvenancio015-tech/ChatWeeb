import React, { useState } from 'react';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  hasStory?: boolean;
  storyViewed?: boolean;
  isHost?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  hasStory = false,
  storyViewed = false,
  isHost = false,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = (name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const ringClass = hasStory
    ? storyViewed
      ? 'p-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-full'
      : 'p-[2.5px] bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-500 rounded-full'
    : '';

  const inner = (
    <div
      className={`relative rounded-full overflow-hidden shrink-0 flex items-center justify-center font-semibold select-none bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 ${SIZE_CLASSES[size]} ${
        hasStory ? 'ring-2 ring-white dark:ring-zinc-950' : ''
      } ${className}`}
    >
      {src && !imgFailed ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{initials || 'U'}</span>
      )}
    </div>
  );

  return (
    <div className={`relative inline-flex shrink-0 ${ringClass}`}>
      {inner}
      {isHost && (
        <span
          title="Dispositivo Servidor (Host)"
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-600 text-white border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[8px] font-bold"
        >
          H
        </span>
      )}
    </div>
  );
};
