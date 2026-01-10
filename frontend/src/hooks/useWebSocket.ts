import { useCallback } from 'react';

type EventHandler = (data: any) => void;

export const useWebSocket = () => {
  const subscribe = useCallback((_eventType: string, _handler: EventHandler) => {
    return () => {};
  }, []);

  const send = useCallback((_data: any) => {
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
