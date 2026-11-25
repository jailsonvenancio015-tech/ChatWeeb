import React from 'react';
import type { UserProfile } from '../types/app';

interface MentionTextProps {
  text: string;
  profiles: Record<string, UserProfile>;
  onMentionClick: (userId: string) => void;
  mentionClassName?: string;
}

export const MentionText: React.FC<MentionTextProps> = ({
  text,
  profiles,
  onMentionClick,
  mentionClassName = 'font-semibold underline decoration-current/40 underline-offset-2 hover:opacity-80 cursor-pointer',
}) => {
  const parts = text.split(/(@[a-zA-Z0-9._]{2,30})/g);
  const byHandle = new Map<string, UserProfile>();
  for (const prof of Object.values(profiles)) {
    byHandle.set(prof.handle.toLowerCase(), prof);
  }

  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('@')) {
          const handleKey = part.slice(1).toLowerCase();
          const matched = byHandle.get(handleKey);
          if (matched) {
            return (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMentionClick(matched.id);
                }}
                className={mentionClassName}
              >
                {part}
              </button>
            );
          }
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};
