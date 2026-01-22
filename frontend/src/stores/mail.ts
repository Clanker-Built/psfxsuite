import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mailApi, MailFolder, MailMessageSummary, MailMessage, MailConversation } from '@/lib/api';

interface MailAuthState {
  isAuthenticated: boolean;
  email: string | null;
}

interface MailState extends MailAuthState {
  folders: MailFolder[];
  currentFolder: string;
  messages: MailMessageSummary[];
  conversations: MailConversation[];
  viewMode: 'messages' | 'conversations';
  currentMessage: MailMessage | null;
  expandedConversationId: string | null;
  isLoading: boolean;
  error: string | null;

  // Auth actions
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;

  // Folder actions
  loadFolders: () => Promise<void>;
  selectFolder: (folder: string) => void;

  // Message actions
  loadMessages: (folder?: string, offset?: number, limit?: number) => Promise<void>;
  loadConversations: (folder?: string, offset?: number, limit?: number) => Promise<void>;
  loadMessage: (uid: number) => Promise<void>;
  markRead: (uid: number, read?: boolean) => Promise<void>;
  markStarred: (uid: number, starred?: boolean) => Promise<void>;
  deleteMessage: (uid: number) => Promise<void>;
  moveMessage: (uid: number, toFolder: string) => Promise<void>;

  // View mode actions
  setViewMode: (mode: 'messages' | 'conversations') => void;
  expandConversation: (id: string | null) => void;

  // State
  clearError: () => void;
}

export const useMailStore = create<MailState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      email: null,
      folders: [],
      currentFolder: 'INBOX',
      messages: [],
      conversations: [],
      viewMode: 'conversations',
      currentMessage: null,
      expandedConversationId: null,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const result = await mailApi.login(email, password);
          if (result.success) {
            set({ isAuthenticated: true, email: result.email });
            // Load folders after login
            await get().loadFolders();
            return true;
          }
          set({ error: 'Login failed' });
          return false;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Login failed' });
          return false;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try {
          await mailApi.logout();
        } catch {
          // Ignore errors
        }
        set({
          isAuthenticated: false,
          email: null,
          folders: [],
          messages: [],
          conversations: [],
          currentMessage: null,
          currentFolder: 'INBOX',
          expandedConversationId: null,
        });
      },

      loadFolders: async () => {
        set({ isLoading: true, error: null });
        try {
          const folders = await mailApi.getFolders();
          set({ folders });
        } catch (error) {
          set({ error: 'Failed to load folders' });
        } finally {
          set({ isLoading: false });
        }
      },

      selectFolder: (folder) => {
        set({ currentFolder: folder, messages: [], conversations: [], currentMessage: null, expandedConversationId: null });
      },

      loadMessages: async (folder, offset = 0, limit = 50) => {
        const targetFolder = folder || get().currentFolder;
        set({ isLoading: true, error: null });
        try {
          const result = await mailApi.getMessages(targetFolder, offset, limit);
          set({ messages: result.messages, currentFolder: targetFolder });
        } catch (error) {
          // Check if session expired
          if (error instanceof Error && error.message.includes('session expired')) {
            set({
              isAuthenticated: false,
              email: null,
              conversations: [],
              messages: [],
              error: 'Session expired. Please log in again.',
            });
          } else {
            set({ error: 'Failed to load messages' });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      loadConversations: async (folder, offset = 0, limit = 50) => {
        const targetFolder = folder || get().currentFolder;
        set({ isLoading: true, error: null });
        try {
          const result = await mailApi.getConversations(targetFolder, offset, limit);
          set({ conversations: result.conversations, currentFolder: targetFolder });
        } catch (error) {
          // Check if session expired
          if (error instanceof Error && error.message.includes('session expired')) {
            set({
              isAuthenticated: false,
              email: null,
              conversations: [],
              messages: [],
              error: 'Session expired. Please log in again.',
            });
          } else {
            set({ error: 'Failed to load conversations' });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      setViewMode: (mode) => {
        set({ viewMode: mode, expandedConversationId: null });
        // Reload content based on mode
        const folder = get().currentFolder;
        if (mode === 'conversations') {
          get().loadConversations(folder);
        } else {
          get().loadMessages(folder);
        }
      },

      expandConversation: (id) => {
        set({ expandedConversationId: id });
      },

      loadMessage: async (uid) => {
        set({ isLoading: true, error: null });
        try {
          const message = await mailApi.getMessage(uid, get().currentFolder);
          set({ currentMessage: message });

          // Mark as read if not already
          if (!message.read) {
            await get().markRead(uid, true);
          }
        } catch (error) {
          set({ error: 'Failed to load message' });
        } finally {
          set({ isLoading: false });
        }
      },

      markRead: async (uid, read = true) => {
        try {
          await mailApi.markRead(uid, get().currentFolder, read);
          // Update local state
          set((state) => ({
            messages: state.messages.map((m) =>
              m.uid === uid ? { ...m, read } : m
            ),
            currentMessage:
              state.currentMessage?.uid === uid
                ? { ...state.currentMessage, read }
                : state.currentMessage,
          }));
        } catch (error) {
          console.error('Failed to mark read:', error);
        }
      },

      markStarred: async (uid, starred = true) => {
        try {
          await mailApi.markStarred(uid, get().currentFolder, starred);
          // Update local state
          set((state) => ({
            messages: state.messages.map((m) =>
              m.uid === uid ? { ...m, starred } : m
            ),
            currentMessage:
              state.currentMessage?.uid === uid
                ? { ...state.currentMessage, starred }
                : state.currentMessage,
          }));
        } catch (error) {
          console.error('Failed to mark starred:', error);
        }
      },

      deleteMessage: async (uid) => {
        try {
          await mailApi.deleteMessage(uid, get().currentFolder);
          // Remove from local state
          set((state) => ({
            messages: state.messages.filter((m) => m.uid !== uid),
            currentMessage:
              state.currentMessage?.uid === uid ? null : state.currentMessage,
          }));
        } catch (error) {
          set({ error: 'Failed to delete message' });
        }
      },

      moveMessage: async (uid, toFolder) => {
        try {
          await mailApi.moveMessages([uid], get().currentFolder, toFolder);
          // Remove from local state
          set((state) => ({
            messages: state.messages.filter((m) => m.uid !== uid),
            currentMessage:
              state.currentMessage?.uid === uid ? null : state.currentMessage,
          }));
        } catch (error) {
          set({ error: 'Failed to move message' });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'psfx-mail',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        email: state.email,
      }),
    }
  )
);
