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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await AI.models.generateContent(
      {
        model: "gemini-2.5-flash",
        systemInstruction: {
          role: "system",
          parts: [
            {
              text: "You are a factual news assistant. Generate exactly 200 words of plain-text, objective news content in a single paragraph. Do not use markdown, bullet points, headings, emojis, or any special formatting. Do not include line breaks or introductions.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Give the latest global news in exactly 200 words. Use plain text only, no markdown, no formatting, no lists or punctuation other than standard periods and commas. Do not add titles or labels.",
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.2,
        },
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    const rawText = response.text;
    const cleanedText = stripMarkdown(rawText);
    return cleanedText;
  } catch (error) {
    console.error("Error generating news content:", error.message);
  }
}

app.get("/gemini", async (req, res) => {
  try {
    const newsContent = await generateNewsContent();
    res.json({ text: newsContent });
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

  socket.on("set-text", async (text, callback) => {
    if (!currentRoom) {
      return callback({ error: "Must join a room" });
    }
    console.log(`Text set in room ${currentRoom}:`, text);
    const req = await fetch(process.env.GEMINI_URL, {
      method: "GET",
    });
    const data = await req.json();
    callback({ text: data.text, success: "Text set successfully" });
    socket.to(currentRoom).emit("text-updated");
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
