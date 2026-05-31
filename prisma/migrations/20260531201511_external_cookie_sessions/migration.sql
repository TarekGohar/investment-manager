-- CreateTable
CREATE TABLE "external_cookie_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cookieHeader" TEXT NOT NULL,
    "userAgent" TEXT,
    "notes" TEXT,
    "expectedExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_cookie_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_cookie_session_userId_idx" ON "external_cookie_session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_cookie_session_userId_source_key" ON "external_cookie_session"("userId", "source");

-- AddForeignKey
ALTER TABLE "external_cookie_session" ADD CONSTRAINT "external_cookie_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
