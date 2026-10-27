// React bindings for the controller.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createAgentClient, type AgentClientOptions } from '../logic/client';
import { AssistantController, type AssistantState } from '../logic/controller';

/** One controller for the lifetime of the component; polling stops on unmount. */
export function useAssistantController(opts: AgentClientOptions): AssistantController {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const ref = useRef<AssistantController | null>(null);
  if (!ref.current) {
    ref.current = new AssistantController({
      // The URL is fixed for the app's lifetime; the token is read per request.
      client: createAgentClient({ apiUrl: opts.apiUrl, getToken: () => optsRef.current.getToken() }),
    });
  }
  useEffect(() => () => ref.current?.dispose(), []);
  return ref.current;
}

export function useAssistantState(controller: AssistantController): AssistantState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

/** The current time, refreshed every `ms`, so expiry countdowns move. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
