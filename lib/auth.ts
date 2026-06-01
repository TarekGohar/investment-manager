import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { prisma } from "@/lib/prisma";
import { sendMagicLinkEmail } from "@/lib/email";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the row at most once per day
    cookieCache: {
      // Signed cookie carries the session for 5 min, avoids DB hits on render
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  emailAndPassword: { enabled: false },

  plugins: [
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ email, url });
      },
    }),
  ],

  trustedOrigins: [appUrl],
});

export type Session = typeof auth.$Infer.Session;
