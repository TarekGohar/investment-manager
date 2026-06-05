import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { abortConversation } from "@/lib/ai/chat-aborters";
import { getConversationById } from "@/lib/ai/queries";

export const dynamic = "force-dynamic";

type Body = { conversationId?: string };

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  const conversationId = body?.conversationId?.trim();
  if (!conversationId) return new Response("Bad Request", { status: 400 });

  // Ownership check — don't let one user cancel another's turn.
  const conversation = await getConversationById(session.user.id, conversationId);
  if (!conversation) return new Response("Not Found", { status: 404 });

  const aborted = abortConversation(conversationId);
  return Response.json({ ok: true, aborted });
}
