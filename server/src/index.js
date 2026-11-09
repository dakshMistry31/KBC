import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { questions, prizeLadder } from './questions.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'family-kbc' }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN?.split(',') || '*', methods: ['GET', 'POST'] } });
const rooms = new Map();
const roomTimers = new Map();
const GAME_SECONDS = 30;

const makeCode = () => {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
};
const publicState = (room) => ({
  code: room.code,
  phase: room.phase,
  questionIndex: room.questionIndex,
  totalQuestions: questions.length,
  question: room.questionIndex >= 0 && room.questionIndex < questions.length ? {
    question: questions[room.questionIndex].question,
    options: questions[room.questionIndex].options,
    explanation: ['revealed', 'wrong'].includes(room.phase) ? questions[room.questionIndex].explanation : null,
    answer: ['revealed', 'wrong'].includes(room.phase) ? questions[room.questionIndex].answer : null
  } : null,
  selectedAnswer: room.selectedAnswer,
  timeLeft: room.timeLeft,
  prize: room.questionIndex >= 0 ? prizeLadder[room.questionIndex] : 0,
  winnings: room.winnings,
  lifelines: room.lifelines,
  rescueUsed: room.rescueUsed,
  rescueAvailable: room.phase === 'wrong' && room.questionIndex < 4 && !room.rescueUsed,
  audiencePoll: room.audiencePoll,
  playersConnected: room.remoteSocketId ? 1 : 0
});
const broadcast = (room) => io.to(room.code).emit('game-state', publicState(room));
const stopTimer = (code) => { if (roomTimers.has(code)) clearInterval(roomTimers.get(code)); roomTimers.delete(code); };
const startTimer = (room) => {
  stopTimer(room.code);
  room.timeLeft = GAME_SECONDS;
  const timer = setInterval(() => {
    if (room.phase !== 'question') return stopTimer(room.code);
    room.timeLeft -= 1;
    if (room.timeLeft <= 0) {
      room.timeLeft = 0;
      room.phase = 'timeout';
      stopTimer(room.code);
    }
    broadcast(room);
  }, 1000);
  roomTimers.set(room.code, timer);
};
const isRemote = (socket, room) => socket.id === room.remoteSocketId;

io.on('connection', (socket) => {
  socket.on('create-room', (ack) => {
    const code = makeCode();
    const room = { code, tvSocketId: socket.id, remoteSocketId: null, phase: 'lobby', questionIndex: -1, selectedAnswer: null, timeLeft: GAME_SECONDS, winnings: 0, rescueUsed: false, lifelines: { fiftyFifty: true, audiencePoll: true, expert: true }, audiencePoll: null };
    rooms.set(code, room);
    socket.join(code);
    ack?.({ ok: true, code, state: publicState(room) });
  });

  socket.on('join-room', ({ code } = {}, ack) => {
    const normalized = String(code || '').trim();
    const room = rooms.get(normalized);
    if (!room) return ack?.({ ok: false, error: 'Room code not found. Check the code shown on TV.' });
    if (room.remoteSocketId && room.remoteSocketId !== socket.id) return ack?.({ ok: false, error: 'A mobile remote is already connected to this room.' });
    room.remoteSocketId = socket.id;
    socket.join(normalized);
    broadcast(room);
    ack?.({ ok: true, state: publicState(room) });
  });

  socket.on('start-game', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Only the connected mobile remote can start the game.' });
    room.questionIndex = 0; room.phase = 'question'; room.selectedAnswer = null; room.winnings = 0; room.rescueUsed = false; room.lifelines = { fiftyFifty: true, audiencePoll: true, expert: true }; room.audiencePoll = null;
    startTimer(room); broadcast(room); ack?.({ ok: true });
  });

  socket.on('select-answer', ({ code, answer } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (room.phase !== 'question') return ack?.({ ok: false, error: 'Answers can only be selected while the question is active.' });
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return ack?.({ ok: false, error: 'Invalid option.' });
    room.selectedAnswer = answer; broadcast(room); ack?.({ ok: true });
  });

  socket.on('lock-answer', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (room.phase !== 'question' || room.selectedAnswer === null) return ack?.({ ok: false, error: 'Select an option before locking it.' });
    room.phase = 'locked'; stopTimer(room.code); broadcast(room); ack?.({ ok: true });
  });

  socket.on('reveal-answer', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (!['locked', 'timeout'].includes(room.phase)) return ack?.({ ok: false, error: 'Lock an answer or wait for the timer to finish first.' });
    const correct = questions[room.questionIndex].answer;
    if (room.selectedAnswer === correct) { room.winnings = prizeLadder[room.questionIndex]; room.phase = 'revealed'; }
    else { room.phase = 'wrong'; stopTimer(room.code); }
    broadcast(room); ack?.({ ok: true });
  });

  socket.on('next-question', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (room.phase !== 'revealed') return ack?.({ ok: false, error: 'Only a correct answer can advance to the next question. Use the rescue life or restart after a wrong answer.' });
    if (room.questionIndex + 1 >= questions.length) {
      room.phase = 'gameover'; room.questionIndex = questions.length; room.selectedAnswer = null; stopTimer(room.code); broadcast(room); return ack?.({ ok: true });
    }
    room.questionIndex += 1; room.phase = 'question'; room.selectedAnswer = null; room.audiencePoll = null;
    startTimer(room); broadcast(room); ack?.({ ok: true });
  });


  socket.on('use-rescue-life', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (room.phase !== 'wrong' || room.questionIndex >= 4 || room.rescueUsed) return ack?.({ ok: false, error: 'The rescue life is not available.' });
    room.rescueUsed = true;
    if (room.questionIndex + 1 >= questions.length) {
      room.phase = 'gameover'; room.questionIndex = questions.length; room.selectedAnswer = null; stopTimer(room.code); broadcast(room); return ack?.({ ok: true });
    }
    room.questionIndex += 1; room.phase = 'question'; room.selectedAnswer = null; room.audiencePoll = null;
    startTimer(room); broadcast(room); ack?.({ ok: true });
  });

  socket.on('restart-game', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    stopTimer(room.code);
    room.questionIndex = 0; room.phase = 'question'; room.selectedAnswer = null; room.timeLeft = GAME_SECONDS; room.winnings = 0; room.rescueUsed = false;
    room.lifelines = { fiftyFifty: true, audiencePoll: true, expert: true }; room.audiencePoll = null;
    startTimer(room); broadcast(room); ack?.({ ok: true });
  });

  socket.on('use-lifeline', ({ code, type } = {}, ack) => {
    const room = rooms.get(String(code));
    if (!room || !isRemote(socket, room)) return ack?.({ ok: false, error: 'Remote not authorized.' });
    if (room.phase !== 'question') return ack?.({ ok: false, error: 'Lifelines are available during an active question.' });
    if (!room.lifelines[type]) return ack?.({ ok: false, error: 'This lifeline has already been used or is unavailable.' });
    const correct = questions[room.questionIndex].answer;
    if (type === 'fiftyFifty') {
      const incorrect = [0, 1, 2, 3].filter((i) => i !== correct);
      const remove = incorrect.sort(() => Math.random() - 0.5).slice(0, 2);
      room.lifelines.fiftyFifty = false;
      io.to(room.code).emit('lifeline-result', { type, removedOptions: remove });
    } else if (type === 'audiencePoll') {
      const shares = [8, 8, 8, 8]; shares[correct] = 76;
      let remaining = 24;
      for (let i = 0; i < 4; i++) if (i !== correct) { const val = Math.floor(Math.random() * (remaining + 1)); shares[i] = val; remaining -= val; }
      shares[correct] += remaining;
      room.audiencePoll = shares; room.lifelines.audiencePoll = false;
    } else if (type === 'expert') {
      room.lifelines.expert = false;
      io.to(room.code).emit('lifeline-result', { type, expertAnswer: correct, message: 'The expert suggests this option.' });
    } else return ack?.({ ok: false, error: 'Unknown lifeline.' });
    broadcast(room); ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.remoteSocketId === socket.id) { room.remoteSocketId = null; broadcast(room); }
      if (room.tvSocketId === socket.id) { stopTimer(room.code); rooms.delete(room.code); io.to(room.code).emit('room-closed'); }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Family KBC server running on http://localhost:${PORT}`));
