import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "./db.js";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Public file URLs — the only place they're defined. They carry ids, never filesystem paths;
// the routes below look the file up in the database.
export const deckFileUrl = (chatId: string, version: number, file: "deck.pptx" | "deck.pdf") =>
  `/api/chats/${chatId}/decks/${version}/${file}`;
export const slideImageUrl = (chatId: string, version: number, index: number) =>
  `/api/chats/${chatId}/decks/${version}/slides/${index + 1}.png`; // 1-based in the URL

/** "Make a 3-slide deck about otters!" → "make-a-3-slide-deck-about-otters" (for download names). */
function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "deck"
  );
}

async function sendFile(
  reply: FastifyReply,
  path: string | null | undefined,
  type: string,
  filename?: string,
) {
  if (!path) return reply.code(404).send({ error: "not found" });
  try {
    await stat(path);
  } catch {
    return reply.code(404).send({ error: "not found" });
  }
  reply.type(type);
  if (filename) reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  return reply.send(createReadStream(path));
}

const parseVersion = (v: string) => (/^\d{1,6}$/.test(v) && Number(v) >= 1 ? Number(v) : null);

export function registerFileRoutes(app: FastifyInstance) {
  type DeckParams = { chatId: string; version: string };

  const download = (file: "pptx" | "pdf") => async (req: { params: unknown }, reply: FastifyReply) => {
    const { chatId, version } = req.params as DeckParams;
    const v = parseVersion(version);
    if (v === null) return reply.code(404).send({ error: "not found" });
    const deck = await prisma.deckVersion.findUnique({
      where: { chatId_version: { chatId, version: v } },
      select: { pptxPath: true, pdfPath: true, chat: { select: { title: true } } },
    });
    if (!deck) return reply.code(404).send({ error: "not found" });
    const name = `${slug(deck.chat.title)}-v${v}.${file}`;
    return file === "pptx"
      ? sendFile(reply, deck.pptxPath, PPTX, name)
      : sendFile(reply, deck.pdfPath, "application/pdf", name);
  };

  app.get("/api/chats/:chatId/decks/:version/deck.pptx", download("pptx"));
  app.get("/api/chats/:chatId/decks/:version/deck.pdf", download("pdf"));

  app.get("/api/chats/:chatId/decks/:version/slides/:file", async (req, reply) => {
    const { chatId, version, file } = req.params as DeckParams & { file: string };
    const v = parseVersion(version);
    const m = /^(\d{1,4})\.png$/.exec(file);
    if (v === null || !m || Number(m[1]) < 1) return reply.code(404).send({ error: "not found" });
    const slide = await prisma.slide.findFirst({
      where: { index: Number(m[1]) - 1, deckVersion: { chatId, version: v } },
      select: { imagePath: true },
    });
    return sendFile(reply, slide?.imagePath, "image/png");
  });
}
