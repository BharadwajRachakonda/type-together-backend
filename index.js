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
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
