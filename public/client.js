const socket = io();

const usernameModal = document.getElementById('usernameModal');
const usernameForm = document.getElementById('usernameForm');
const nameInput = document.getElementById('nameInput');
const emailInput = document.getElementById('emailInput');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const messagesList = document.getElementById('messages');
const participantsList = document.getElementById('participantsList');
const logoutButton = document.getElementById('logoutButton');
const userControls = document.getElementById('userControls');
const currentUserDisplay = document.getElementById('currentUserDisplay');
const sendButton = messageForm.querySelector('button');

const AUTH_STORAGE_KEY = 'chatUser';

let currentUser = null;
const participants = new Map();

function formatDisplayName(user) {
  if (!user) {
    return 'Unknown';
  }

  if (typeof user === 'string') {
    const [localPart] = user.split('@');
    return localPart || user;
  }

  if (user.name && user.name.trim()) {
    return user.name.trim();
  }

  if (user.email) {
    const [localPart] = user.email.split('@');
    return localPart || user.email;
  }

  return 'Unknown';
}

function enableMessaging(isEnabled) {
  messageInput.disabled = !isEnabled;
  sendButton.disabled = !isEnabled;
}

function showLoggedInState(user) {
  currentUser = user;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  userControls.classList.remove('hidden');
  currentUserDisplay.textContent = formatDisplayName(user);
  usernameModal.classList.add('hidden');
  enableMessaging(true);
  participants.set(user.email, user);
  refreshParticipantsList();
  messageInput.focus();
}

function resetToLoggedOutState() {
  currentUser = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  userControls.classList.add('hidden');
  currentUserDisplay.textContent = '';
  enableMessaging(false);
  messageInput.value = '';
  participants.clear();
  refreshParticipantsList();
  usernameModal.classList.remove('hidden');
  nameInput.value = '';
  emailInput.value = '';
  nameInput.focus();
}

function attachSocketListeners() {
  socket.off('chat-message');
  socket.off('user-joined');
  socket.off('user-left');
  socket.off('current-users');

  socket.on('chat-message', (payload) => {
    if (!currentUser) return;
    const senderEmail = payload?.sender?.email;
    const isSelf = senderEmail && senderEmail === currentUser.email;
    if (!isSelf && payload?.sender?.email) {
      participants.set(payload.sender.email, payload.sender);
      refreshParticipantsList();
    }
    addMessage(payload, isSelf);
  });

  socket.on('user-joined', (user) => {
    if (!currentUser || !user?.email) return;
    participants.set(user.email, user);
    refreshParticipantsList();
    addSystemMessage(`${formatDisplayName(user)} joined the chat`);
  });

  socket.on('user-left', (user) => {
    if (!currentUser || !user?.email) return;
    participants.delete(user.email);
    refreshParticipantsList();
    addSystemMessage(`${formatDisplayName(user)} left the chat`);
  });

  socket.on('current-users', (users) => {
    if (!currentUser) return;
    participants.clear();
    users.forEach((user) => {
      if (user?.email) {
        participants.set(user.email, user);
      }
    });
    if (currentUser.email && !participants.has(currentUser.email)) {
      participants.set(currentUser.email, currentUser);
    }
    refreshParticipantsList();
  });
}

function addMessage({ sender, message, timestamp }, isSelf = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message${isSelf ? ' self' : ''}`;

  const meta = document.createElement('div');
  meta.className = 'meta';

  const userSpan = document.createElement('span');
  userSpan.className = 'username';
  userSpan.textContent = formatDisplayName(sender);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = message;

  const timeFooter = document.createElement('div');
  timeFooter.className = 'timestamp';
  timeFooter.textContent = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  meta.appendChild(userSpan);

  messageElement.appendChild(meta);
  messageElement.appendChild(text);
  messageElement.appendChild(timeFooter);

  messagesList.appendChild(messageElement);
  messagesList.scrollTop = messagesList.scrollHeight;
}

function addSystemMessage(text) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message system-message';
  messageElement.textContent = text;
  messagesList.appendChild(messageElement);
  messagesList.scrollTop = messagesList.scrollHeight;
}

function refreshParticipantsList() {
  participantsList.innerHTML = '';
  [...participants.values()].forEach((user) => {
    const li = document.createElement('li');
    li.className = 'participant';
    li.textContent = formatDisplayName(user);
    participantsList.appendChild(li);
  });
}

usernameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name) {
    nameInput.focus();
    return;
  }

  if (!isValidEmail) {
    emailInput.focus();
    return;
  }

  const user = { name, email };

  showLoggedInState(user);
  socket.emit('join', user);
  socket.emit('request-current-users');
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || !currentUser) return;

  socket.emit('chat-message', message);
  messageInput.value = '';
});

logoutButton.addEventListener('click', () => {
  if (!currentUser) return;
  socket.emit('logout');
  resetToLoggedOutState();
});

attachSocketListeners();

function initializeState() {
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.email) {
        showLoggedInState({
          name: parsed.name || '',
          email: parsed.email,
        });
        if (socket.connected) {
          socket.emit('join', {
            name: parsed.name || '',
            email: parsed.email,
          });
          socket.emit('request-current-users');
        }
        return;
      }
    } catch (error) {
      console.error('Failed to parse stored user', error);
    }
  }

  resetToLoggedOutState();
}

socket.on('connect', () => {
  if (currentUser) {
    socket.emit('join', currentUser);
    if (socket.connected) {
      socket.emit('request-current-users');
    }
  }
});

socket.on('connect_error', (error) => {
  console.error('Connection error', error);
});

socket.on('reconnect', () => {
  if (currentUser) {
    socket.emit('request-current-users');
  }
});

initializeState();
