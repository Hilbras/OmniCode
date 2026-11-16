import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { seedSessions } from './seed';
import { Action, AppState, initialState, reducer } from './state';
import { Settings, defaultSettings } from './types';

const STORAGE_KEY = 'omnicode-state-v1';

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

interface PersistedShape {
  sessions: AppState['sessions'];
  activeSessionId: AppState['activeSessionId'];
  settings: Settings;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedShape;
          dispatch({
            type: 'hydrate',
            sessions: parsed.sessions ?? [],
            activeSessionId: parsed.activeSessionId ?? parsed.sessions?.[0]?.id ?? null,
            settings: { ...defaultSettings, ...parsed.settings },
          });
        } else {
          const sessions = seedSessions();
          dispatch({
            type: 'hydrate',
            sessions,
            activeSessionId: sessions[0]?.id ?? null,
            settings: defaultSettings,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        const sessions = seedSessions();
        dispatch({
          type: 'hydrate',
          sessions,
          activeSessionId: sessions[0]?.id ?? null,
          settings: defaultSettings,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: PersistedShape = {
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        settings: state.settings,
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}
