import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ShortcutHandlers {
  onCompose?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onToggleStar?: () => void;
  onMarkUnread?: () => void;
  onNextMessage?: () => void;
  onPrevMessage?: () => void;
  onOpenMessage?: () => void;
  onSend?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
  onEscape?: () => void;
}

interface UseMailShortcutsOptions {
  handlers?: ShortcutHandlers;
  enabled?: boolean;
}

// Check if user is typing in an input field
function isTyping(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export function useMailShortcuts(options: UseMailShortcutsOptions = {}) {
  const { handlers = {}, enabled = true } = options;
  const navigate = useNavigate();
  const location = useLocation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Allow Ctrl/Cmd combinations even when typing
      const isMod = e.ctrlKey || e.metaKey;

      // Don't intercept when typing, unless it's a mod key combo
      if (isTyping(e) && !isMod) {
        // Still allow Escape when typing
        if (e.key === 'Escape') {
          handlers.onEscape?.();
        }
        return;
      }

      // Ctrl/Cmd + Enter: Send message (in compose)
      if (isMod && e.key === 'Enter') {
        e.preventDefault();
        handlers.onSend?.();
        return;
      }

      // Single key shortcuts (when not typing)
      if (!isMod && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'c':
            e.preventDefault();
            if (handlers.onCompose) {
              handlers.onCompose();
            } else {
              navigate('/compose');
            }
            break;

          case 'r':
            e.preventDefault();
            handlers.onReply?.();
            break;

          case 'a':
            e.preventDefault();
            handlers.onReplyAll?.();
            break;

          case 'f':
            e.preventDefault();
            handlers.onForward?.();
            break;

          case 'e':
            e.preventDefault();
            handlers.onArchive?.();
            break;

          case 's':
            e.preventDefault();
            handlers.onToggleStar?.();
            break;

          case 'u':
            e.preventDefault();
            handlers.onMarkUnread?.();
            break;

          case 'j':
            e.preventDefault();
            handlers.onNextMessage?.();
            break;

          case 'k':
            e.preventDefault();
            handlers.onPrevMessage?.();
            break;

          case 'o':
          case 'enter':
            if (e.key === 'Enter' || e.key === 'o') {
              e.preventDefault();
              handlers.onOpenMessage?.();
            }
            break;

          case '/':
            e.preventDefault();
            if (handlers.onFocusSearch) {
              handlers.onFocusSearch();
            } else {
              navigate('/search');
            }
            break;

          case '?':
            e.preventDefault();
            handlers.onShowHelp?.();
            break;

          case 'escape':
            e.preventDefault();
            handlers.onEscape?.();
            break;
        }
      }

      // Shift + # for delete
      if (e.shiftKey && e.key === '#') {
        e.preventDefault();
        handlers.onDelete?.();
      }
    },
    [enabled, handlers, navigate]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return {
    // Return current location for conditional logic
    isComposing: location.pathname === '/compose',
    isInbox: location.pathname === '/inbox',
    isViewing: location.pathname.startsWith('/message/'),
  };
}

// Keyboard shortcuts help modal content
export const KEYBOARD_SHORTCUTS = [
  { key: 'c', action: 'Compose new email' },
  { key: 'r', action: 'Reply' },
  { key: 'a', action: 'Reply all' },
  { key: 'f', action: 'Forward' },
  { key: 'e', action: 'Archive' },
  { key: '#', action: 'Delete' },
  { key: 's', action: 'Star/Unstar' },
  { key: 'u', action: 'Mark as unread' },
  { key: 'j', action: 'Next message' },
  { key: 'k', action: 'Previous message' },
  { key: 'o / Enter', action: 'Open message' },
  { key: 'Ctrl+Enter', action: 'Send message' },
  { key: '/', action: 'Focus search' },
  { key: '?', action: 'Show shortcuts help' },
  { key: 'Esc', action: 'Close/Cancel' },
];

export default useMailShortcuts;
