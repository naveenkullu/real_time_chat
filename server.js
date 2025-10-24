const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const connectedUsers = new Map();
const disconnectTimers = new Map();
const DISCONNECT_GRACE_MS = 10000;

function sanitizeUser(input, fallbackEmail) {
  if (!input) return null;

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : fallbackEmail;
  if (!email) return null;

  const name = typeof input.name === 'string' ? input.name.trim() : '';

  return {
    name,
    email,
  };
}

function getUniqueUsers() {
  const uniqueByEmail = new Map();
  connectedUsers.forEach((user) => {
    if (!uniqueByEmail.has(user.email)) {
      uniqueByEmail.set(user.email, user);
    }
  });
  return Array.from(uniqueByEmail.values());
}

function broadcastCurrentUsers() {
  io.emit('current-users', getUniqueUsers());
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join', (userPayload) => {
    const user = sanitizeUser(userPayload, socket.data?.user?.email || null);
    if (!user) return;

    const existingTimer = disconnectTimers.get(user.email);
    if (existingTimer) {
      clearTimeout(existingTimer);
      disconnectTimers.delete(user.email);
    }

    const wasConnected = Array.from(connectedUsers.values()).some((u) => u.email === user.email);

    socket.data.user = user;
    connectedUsers.set(socket.id, user);

    if (!wasConnected) {
      socket.broadcast.emit('user-joined', user);
    }

    socket.emit('current-users', getUniqueUsers());
    broadcastCurrentUsers();
  });

  socket.on('chat-message', (message) => {
    if (!message || !socket.data.user) return;

    io.emit('chat-message', {
      sender: socket.data.user,
      message,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('request-current-users', () => {
    if (!socket.data.user) return;
    socket.emit('current-users', getUniqueUsers());
  });

  socket.on('disconnect', () => {
    if (!socket.data.user) return;
    const user = socket.data.user;
    connectedUsers.delete(socket.id);

    const timer = setTimeout(() => {
      disconnectTimers.delete(user.email);

      const stillConnected = Array.from(connectedUsers.values()).some((u) => u.email === user.email);
      if (stillConnected) {
        return;
      }

      socket.broadcast.emit('user-left', user);
      broadcastCurrentUsers();
    }, DISCONNECT_GRACE_MS);

    disconnectTimers.set(user.email, timer);
  });

  socket.on('logout', () => {
    if (!socket.data.user) return;
    const user = socket.data.user;
    socket.data.user = null;
    connectedUsers.delete(socket.id);
    const timer = disconnectTimers.get(user.email);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(user.email);
    }
    socket.broadcast.emit('user-left', user);
    broadcastCurrentUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
