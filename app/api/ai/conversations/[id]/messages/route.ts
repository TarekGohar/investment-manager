import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getConversationById, listMessages } from "@/lib/ai/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const conversation = await getConversationById(session.user.id, id);
  if (!conversation) return new Response("Not Found", { status: 404 });

  const messages = await listMessages(conversation.id);
  return Response.json({ messages });
}
