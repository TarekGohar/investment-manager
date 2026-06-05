import "server-only";

// In-flight chat-turn aborters, keyed by conversationId. Used to let the
// client explicitly cancel a server-side turn (Stop button) without
// confusing that with an incidental client disconnect (e.g. mobile tab
// backgrounded), which we deliberately let run to completion.
//
// Caveat: this is module-level state in a serverless runtime. It works
// when the /chat and /chat/stop requests land on the same instance —
// the common case for low-traffic single-user apps. If they land on
// different instances, Stop is a no-op (best-effort).
const aborters = new Map<string, AbortController>();

export function registerAborter(conversationId: string, controller: AbortController) {
  aborters.set(conversationId, controller);
}

export function clearAborter(conversationId: string, controller: AbortController) {
  // Only clear if we're still the registered controller — a subsequent turn
  // for the same conversation may have replaced us.
  if (aborters.get(conversationId) === controller) {
    aborters.delete(conversationId);
  }
}

export function abortConversation(conversationId: string): boolean {
  const controller = aborters.get(conversationId);
  if (!controller) return false;
  controller.abort();
  aborters.delete(conversationId);
  return true;
}
