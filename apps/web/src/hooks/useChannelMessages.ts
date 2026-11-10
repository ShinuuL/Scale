'use client';

import { useEffect, useReducer } from 'react';
import type { ChannelMessageDeleteEvent, ChannelMessageEditEvent } from '@scale/shared';
import { api, type ChannelMessage } from '@/lib/api';

export type ChannelMessagesState = {
  channelId: string | null;
  messages: ChannelMessage[];
  cursor: string | null;
  loading: boolean;
  error: string;
};
export type ChannelMessagesAction =
  | { type: 'reset'; channelId: string | null }
  | { type: 'loading'; channelId: string }
  | {
      type: 'loaded';
      channelId: string;
      messages: ChannelMessage[];
      cursor: string | null;
      older?: boolean;
    }
  | { type: 'error'; channelId: string; error: string }
  | { type: 'message'; message: ChannelMessage }
  | { type: 'edit'; event: ChannelMessageEditEvent }
  | { type: 'delete'; event: ChannelMessageDeleteEvent };

export function channelMessagesReducer(
  state: ChannelMessagesState,
  action: ChannelMessagesAction,
): ChannelMessagesState {
  if (action.type === 'reset')
    return {
      channelId: action.channelId,
      messages: [],
      cursor: null,
      loading: !!action.channelId,
      error: '',
    };
  const channelId =
    action.type === 'message'
      ? action.message.channelId
      : action.type === 'edit' || action.type === 'delete'
        ? action.event.channelId
        : action.channelId;
  if (channelId !== state.channelId) return state;
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: '' };
    case 'error':
      return { ...state, loading: false, error: action.error };
    case 'loaded': {
      const known = new Set(state.messages.map((message) => message.id));
      const fetched = action.messages.filter((message) => !known.has(message.id));
      return {
        ...state,
        messages: [...fetched, ...state.messages],
        cursor: action.cursor,
        loading: false,
        error: '',
      };
    }
    case 'message':
      return state.messages.some((message) => message.id === action.message.id)
        ? state
        : { ...state, messages: [...state.messages, action.message] };
    case 'edit':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.event.messageId
            ? { ...message, content: action.event.content, editedAt: action.event.editedAt }
            : message,
        ),
      };
    case 'delete':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.event.messageId
            ? { ...message, deletedAt: action.event.deletedAt }
            : message,
        ),
      };
  }
}

export function useChannelMessages(channelId: string | null, refreshVersion = 0) {
  const [state, dispatch] = useReducer(channelMessagesReducer, {
    channelId,
    messages: [],
    cursor: null,
    loading: !!channelId,
    error: '',
  });
  useEffect(() => {
    dispatch({ type: 'reset', channelId });
  }, [channelId]);
  useEffect(() => {
    if (!channelId) return;
    let active = true;
    dispatch({ type: 'loading', channelId });
    api
      .getChannelMessages(channelId)
      .then((result) => {
        if (active)
          dispatch({
            type: 'loaded',
            channelId,
            messages: result.messages,
            cursor: result.nextCursor,
          });
      })
      .catch(() => {
        if (active)
          dispatch({ type: 'error', channelId, error: 'Não foi possível carregar as mensagens.' });
      });
    return () => {
      active = false;
    };
  }, [channelId, refreshVersion]);
  return { state, dispatch };
}
