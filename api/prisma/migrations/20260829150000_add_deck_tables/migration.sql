-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "sandboxId" TEXT;

-- CreateTable
CREATE TABLE "DeckVersion" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "buildCode" TEXT NOT NULL,
    "reasoning" TEXT,
    "pptxPath" TEXT,
    "pdfPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeckVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL,
    "deckVersionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "imagePath" TEXT NOT NULL,

    CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeckVersion_chatId_version_key" ON "DeckVersion"("chatId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Slide_deckVersionId_index_key" ON "Slide"("deckVersionId", "index");

-- AddForeignKey
ALTER TABLE "DeckVersion" ADD CONSTRAINT "DeckVersion_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_deckVersionId_fkey" FOREIGN KEY ("deckVersionId") REFERENCES "DeckVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

