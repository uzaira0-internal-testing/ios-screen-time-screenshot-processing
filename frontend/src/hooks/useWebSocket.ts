import { useCallback } from 'react';

type EventHandler = (data: unknown) => void;

export const useWebSocket = () => {
  const subscribe = useCallback((_eventType: string, _handler: EventHandler) => {
    return () => {};
  }, []);

  const send = useCallback((_data: string | Record<string, unknown>) => {
  }, []);

  const isConnected = useCallback(() => {
    return false;
  }, []);

  return {
    subscribe,
    send,
    isConnected,
  };
};
