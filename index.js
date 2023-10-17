import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import { randomBytes } from "node:crypto";
import createInMemorySessionStore from "./sessionStore.js";
import createInMemoryMessageStore from "./messageStore.js";
import { instrument } from "@socket.io/admin-ui";

const sessionStore = createInMemorySessionStore();
const messageStore = createInMemoryMessageStore();
const app = express();

app.use(cors());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://10.13.1.215:3000", "https://admin.socket.io"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

instrument(io, {
  auth: false,
  mode: "development",
});

io.use((socket, next) => {
  const sessionID = socket.handshake.auth.sessionID;
  if (sessionID) {
    const session = sessionStore.findSession(sessionID);
    if (session) {
      socket.sessionID = sessionID;
      socket.userID = session.userID;
      socket.username = session.username;
      return next();
    }
  }
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error("invalid username"));
  }
  // create new session
  socket.sessionID = randomBytes(8).toString("hex");
  socket.userID = randomBytes(8).toString("hex");
  socket.username = username;

  next();
});

io.on("connection", (socket) => {
  // persist session
  sessionStore.saveSession(socket.sessionID, {
    userID: socket.userID,
    username: socket.username,
    connected: true,
  });

  // emit session details
  socket.emit("session", {
    sessionID: socket.sessionID,
    userID: socket.userID,
  });

  // join the "userID" room
  socket.join(socket.userID);

  // fetch existing users
  const users = [];
  const messagesPerUser = new Map();
  messageStore.findMessagesForUser(socket.userID).forEach((message) => {
    console.log("message ", message);
    const { to, from } = message;
    const otherUser = socket.userID === from ? to : from;
    if (messagesPerUser.has(otherUser)) {
      messagesPerUser.get(otherUser).push(message);
    } else {
      messagesPerUser.set(otherUser, [message]);
    }
    console.log("messagesPerUser ", messagesPerUser);
  });
  sessionStore.findAllSessions().forEach((session) => {
    const myMessages = messagesPerUser.get(session.userID);
    console.log(
      "got these messages: ",
      myMessages,
      " With userID",
      session.userID
    );
    users.push({
      userID: session.userID,
      username: session.username,
      connected: session.connected,
      messages: myMessages || [],
    });
  });
  console.log("users got some messages", users);
  socket.emit("users", users);

  // notify existing users
  socket.broadcast.emit("user connected", {
    userID: socket.userID,
    username: socket.username,
    connected: true,
  });

  // forward the private message to the right recipient
  socket.on("private message", ({ content, to }) => {
    const message = {
      content,
      from: socket.userID,
      to,
    };
    socket.to(to).to(socket.userID).emit("private message", message);
    messageStore.saveMessage(message);
  });

  // notify users upon disconnection
  socket.on("disconnect", async () => {
    const matchingSockets = await io.in(socket.userID).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // notify other users
      socket.broadcast.emit("user disconnected", socket.userID);
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionID, {
        userID: socket.userID,
        username: socket.username,
        connected: false,
      });
    }
  });
});

const PORT = 3001;

server.listen(PORT, () =>
  console.log(`server listening at http://localhost:${PORT}`)
);
