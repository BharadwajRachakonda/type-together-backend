const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

const cors = require("cors");
app.use(cors({ origin: "*" }));

const port = process.env.PORT || 8000;
require("dotenv").config();

function getRoomUserCount(room) {
  const roomObj = io.sockets.adapter.rooms.get(room);
  return roomObj ? roomObj.size : 0;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const AI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function stripMarkdown(text) {
  return text
    .replace(/[*_~`>#-]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/!\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^\s*\n/gm, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function generateNewsContent() {
  try {
    const randomSeed = Math.floor(Math.random() * 100000);

    const response = await AI.models.generateContent({
      model: "gemini-2.5-flash",
      systemInstruction: {
        role: "system",
        parts: [
          {
            text:
              "You are a text generation assistant for a typing speed website. " +
              "Your task is to generate exactly 200 words of plain, engaging, natural-sounding English text of similar length. " +
              "The content should resemble something a human might write: a mix of general observations, short narratives, trivia, or random thoughts. " +
              "Use proper grammar and a balance of simple and complex sentence structures. " +
              "Avoid difficult or rare words, technical terms, poetry, or code. " +
              "Do NOT use any markdown, formatting, or line breaks. Do NOT include lists, emojis, or headings.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Generate a random block of plain English text suitable for a typing test, make sure all words are in similar length. It must be exactly 200 words. Seed=${randomSeed}`,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 250,
        temperature: 0.6,
      },
    });

    const rawText = response.text;
    const cleanedText = stripMarkdown(rawText);
    return cleanedText;
  } catch (error) {
    console.error("Error generating news content:", error.message);
    return "Failed to generate news.";
  }
}

app.get("/gemini", async (req, res) => {
  try {
    const newsContent = await generateNewsContent();
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ text: newsContent });
  } catch (error) {
    console.error("Error fetching news:", error.message);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join-room", (room, callback) => {
    if (!room || room.length != 4) {
      return callback({ error: "Name length should be 4" });
    } else if (getRoomUserCount(room) >= 2) {
      return callback({ error: "Room is full" });
    }
    if (currentRoom) {
      socket.leave(currentRoom);
      console.log(`Left room: ${currentRoom}`);
    }
    socket.join(room);
    currentRoom = room;
    console.log(`Joined room: ${room}`);
    callback({ success: "Successfully joined room" });
  });

  socket.on("send-message", (message, callback) => {
    if (!message || !currentRoom) {
      return callback({ error: "Must join a room and provide a message" });
    }
    socket.to(currentRoom).emit("receive-message", message);
    console.log(`Sent to ${currentRoom}:`, message);
    callback({ success: "Message sent successfully" });
  });

  socket.on("leave-room", (callback) => {
    if (!currentRoom) {
      return;
    }
    socket.leave(currentRoom);
    console.log(`Left room: ${currentRoom}`);
    currentRoom = null;
    callback({ success: "Successfully left room" });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });

  socket.on("start", () => {
    if (!currentRoom) {
      return;
    }
    console.log(`Game started in room: ${currentRoom}`);
    socket.to(currentRoom).emit("start");
  });

  socket.on("end", () => {
    if (!currentRoom) {
      return;
    }
    console.log(`Game ended in room: ${currentRoom}`);
    socket.to(currentRoom).emit("end");
  });

  socket.on("set-text", async (callback) => {
    if (!currentRoom) {
      return callback({ error: "Must join a room" });
    }
    try {
      console.log(process.env.GEMINI_URL);
      const req = await fetch(process.env.GEMINI_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await req.json();
      io.to(currentRoom).emit("text-update", {
        text: data.text,
        success: "Text set successfully",
      });
    } catch (error) {
      console.error("Error in set-text:", error.message);
      return callback({ error: "Failed to fetch text" });
    }
  });

  socket.on("text-update", (text) => {
    if (!currentRoom) {
      return;
    }
    console.log(`Text updated in room ${currentRoom}:`, text);
    socket.to(currentRoom).emit("text-update", text);
  });

  socket.on("done-loading", () => {
    if (!currentRoom) {
      return;
    }
    console.log(`Loading done in room: ${currentRoom}`);
    socket.to(currentRoom).emit("done-loading");
  });

  socket.on("loading", () => {
    if (!currentRoom) {
      return;
    }
    socket.to(currentRoom).emit("loading");
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
