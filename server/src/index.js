import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import { prizeLadder } from './questions.js';

// ---------------- SUPABASE CONNECTION ----------------

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.'
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const answerIndexes = {
  A: 0,
  B: 1,
  C: 2,
  D: 3
};

// Fetch all questions in batches
async function loadQuestionsFromSupabase() {
  const allRows = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('questions')
      .select(
        'id, question, option_a, option_b, option_c, option_d, correct_answer, explanation'
      )
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`Supabase question loading failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);
    offset += data.length;

    if (data.length < batchSize) {
      break;
    }
  }

  const convertedQuestions = allRows.map((row) => {
    const answerLetter = String(row.correct_answer || '')
      .trim()
      .toUpperCase();

    if (!(answerLetter in answerIndexes)) {
      throw new Error(
        `Invalid correct_answer for question ID ${row.id}: ${row.correct_answer}`
      );
    }

    return {
      question: row.question,
      options: [
        row.option_a,
        row.option_b,
        row.option_c,
        row.option_d
      ],
      answer: answerIndexes[answerLetter],
      explanation: row.explanation || ''
    };
  });

  if (convertedQuestions.length < 15) {
    throw new Error(
      `At least 15 questions are required. Found ${convertedQuestions.length}.`
    );
  }

  console.log(
    `Loaded ${convertedQuestions.length} questions from Supabase.`
  );

  return convertedQuestions;
}

const questions = await loadQuestionsFromSupabase();

// Select 15 random questions for each game
function selectGameQuestions() {
  const shuffled = [...questions];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, 15);
}

// ---------------- EXPRESS & SOCKET.IO ----------------

const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN?.split(',') || true
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'family-kbc' });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(',') || '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
const roomTimers = new Map();
const GAME_SECONDS = 30;

// ---------------- ROOM UTILITIES ----------------

const makeCode = () => {
  let code;

  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));

  return code;
};

const publicState = (room) => ({
  code: room.code,
  phase: room.phase,
  questionIndex: room.questionIndex,
  totalQuestions: room.gameQuestions.length,

  question:
    room.questionIndex >= 0 &&
    room.questionIndex < room.gameQuestions.length
      ? {
          question: room.gameQuestions[room.questionIndex].question,
          options: room.gameQuestions[room.questionIndex].options,

          explanation: ['revealed', 'wrong'].includes(room.phase)
            ? room.gameQuestions[room.questionIndex].explanation
            : null,

          answer: ['revealed', 'wrong'].includes(room.phase)
            ? room.gameQuestions[room.questionIndex].answer
            : null
        }
      : null,

  selectedAnswer: room.selectedAnswer,
  timeLeft: room.timeLeft,

  prize:
    room.questionIndex >= 0 &&
    room.questionIndex < prizeLadder.length
      ? prizeLadder[room.questionIndex]
      : 0,

  winnings: room.winnings,
  lifelines: room.lifelines,
  rescueUsed: room.rescueUsed,

  rescueAvailable:
    room.phase === 'wrong' &&
    room.questionIndex < 4 &&
    !room.rescueUsed,

  audiencePoll: room.audiencePoll,
  playersConnected: room.remoteSocketId ? 1 : 0
});

const broadcast = (room) => {
  io.to(room.code).emit('game-state', publicState(room));
};

const stopTimer = (code) => {
  if (roomTimers.has(code)) {
    clearInterval(roomTimers.get(code));
  }

  roomTimers.delete(code);
};

const startTimer = (room) => {
  stopTimer(room.code);
  room.timeLeft = GAME_SECONDS;

  const timer = setInterval(() => {
    if (room.phase !== 'question') {
      return stopTimer(room.code);
    }

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

const isRemote = (socket, room) =>
  socket.id === room.remoteSocketId;

// ---------------- GAME SOCKET EVENTS ----------------

io.on('connection', (socket) => {

  // Create room
  socket.on('create-room', (ack) => {
    const code = makeCode();

    const room = {
      code,
      tvSocketId: socket.id,
      remoteSocketId: null,
      phase: 'lobby',
      questionIndex: -1,
      gameQuestions: [],
      selectedAnswer: null,
      timeLeft: GAME_SECONDS,
      winnings: 0,
      rescueUsed: false,

      lifelines: {
        fiftyFifty: true,
        audiencePoll: true,
        expert: true
      },

      audiencePoll: null
    };

    rooms.set(code, room);
    socket.join(code);

    ack?.({
      ok: true,
      code,
      state: publicState(room)
    });
  });

  // Join room
  socket.on('join-room', ({ code } = {}, ack) => {
    const normalized = String(code || '').trim();
    const room = rooms.get(normalized);

    if (!room) {
      return ack?.({
        ok: false,
        error: 'Room code not found. Check the code shown on TV.'
      });
    }

    if (
      room.remoteSocketId &&
      room.remoteSocketId !== socket.id
    ) {
      return ack?.({
        ok: false,
        error: 'A mobile remote is already connected to this room.'
      });
    }

    room.remoteSocketId = socket.id;
    socket.join(normalized);

    broadcast(room);

    ack?.({
      ok: true,
      state: publicState(room)
    });
  });

  // Start game
  socket.on('start-game', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Only the connected mobile remote can start the game.'
      });
    }

    room.gameQuestions = selectGameQuestions();

    room.questionIndex = 0;
    room.phase = 'question';
    room.selectedAnswer = null;
    room.winnings = 0;
    room.rescueUsed = false;

    room.lifelines = {
      fiftyFifty: true,
      audiencePoll: true,
      expert: true
    };

    room.audiencePoll = null;

    startTimer(room);
    broadcast(room);

    ack?.({ ok: true });
  });

  // Select answer
  socket.on('select-answer', ({ code, answer } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (room.phase !== 'question') {
      return ack?.({
        ok: false,
        error: 'Answers can only be selected while the question is active.'
      });
    }

    if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
      return ack?.({
        ok: false,
        error: 'Invalid option.'
      });
    }

    room.selectedAnswer = answer;

    broadcast(room);
    ack?.({ ok: true });
  });

  // Lock answer
  socket.on('lock-answer', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (
      room.phase !== 'question' ||
      room.selectedAnswer === null
    ) {
      return ack?.({
        ok: false,
        error: 'Select an option before locking it.'
      });
    }

    room.phase = 'locked';

    stopTimer(room.code);
    broadcast(room);

    ack?.({ ok: true });
  });

  // Reveal answer
  socket.on('reveal-answer', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (!['locked', 'timeout'].includes(room.phase)) {
      return ack?.({
        ok: false,
        error: 'Lock an answer or wait for the timer to finish first.'
      });
    }

    const correct =
      room.gameQuestions[room.questionIndex].answer;

    if (room.selectedAnswer === correct) {
      room.winnings = prizeLadder[room.questionIndex];
      room.phase = 'revealed';
    } else {
      room.phase = 'wrong';
      stopTimer(room.code);
    }

    broadcast(room);
    ack?.({ ok: true });
  });

  // Next question
  socket.on('next-question', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (room.phase !== 'revealed') {
      return ack?.({
        ok: false,
        error: 'Only a correct answer can advance to the next question. Use the rescue life or restart after a wrong answer.'
      });
    }

    if (
      room.questionIndex + 1 >= room.gameQuestions.length
    ) {
      room.phase = 'gameover';
      room.questionIndex = room.gameQuestions.length;
      room.selectedAnswer = null;

      stopTimer(room.code);
      broadcast(room);

      return ack?.({ ok: true });
    }

    room.questionIndex += 1;
    room.phase = 'question';
    room.selectedAnswer = null;
    room.audiencePoll = null;

    startTimer(room);
    broadcast(room);

    ack?.({ ok: true });
  });

  // Rescue life
  socket.on('use-rescue-life', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (
      room.phase !== 'wrong' ||
      room.questionIndex >= 4 ||
      room.rescueUsed
    ) {
      return ack?.({
        ok: false,
        error: 'The rescue life is not available.'
      });
    }

    room.rescueUsed = true;

    if (
      room.questionIndex + 1 >= room.gameQuestions.length
    ) {
      room.phase = 'gameover';
      room.questionIndex = room.gameQuestions.length;
      room.selectedAnswer = null;

      stopTimer(room.code);
      broadcast(room);

      return ack?.({ ok: true });
    }

    room.questionIndex += 1;
    room.phase = 'question';
    room.selectedAnswer = null;
    room.audiencePoll = null;

    startTimer(room);
    broadcast(room);

    ack?.({ ok: true });
  });

  // Restart game
  socket.on('restart-game', ({ code } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    stopTimer(room.code);

    room.gameQuestions = selectGameQuestions();

    room.questionIndex = 0;
    room.phase = 'question';
    room.selectedAnswer = null;
    room.timeLeft = GAME_SECONDS;
    room.winnings = 0;
    room.rescueUsed = false;

    room.lifelines = {
      fiftyFifty: true,
      audiencePoll: true,
      expert: true
    };

    room.audiencePoll = null;

    startTimer(room);
    broadcast(room);

    ack?.({ ok: true });
  });

  // Lifelines
  socket.on('use-lifeline', ({ code, type } = {}, ack) => {
    const room = rooms.get(String(code));

    if (!room || !isRemote(socket, room)) {
      return ack?.({
        ok: false,
        error: 'Remote not authorized.'
      });
    }

    if (room.phase !== 'question') {
      return ack?.({
        ok: false,
        error: 'Lifelines are available during an active question.'
      });
    }

    if (!room.lifelines[type]) {
      return ack?.({
        ok: false,
        error: 'This lifeline has already been used or is unavailable.'
      });
    }

    const correct =
      room.gameQuestions[room.questionIndex].answer;

    if (type === 'fiftyFifty') {
      const incorrect = [0, 1, 2, 3].filter(
        (i) => i !== correct
      );

      const remove = incorrect
        .sort(() => Math.random() - 0.5)
        .slice(0, 2);

      room.lifelines.fiftyFifty = false;

      io.to(room.code).emit('lifeline-result', {
        type,
        removedOptions: remove
      });

    } else if (type === 'audiencePoll') {
      const shares = [8, 8, 8, 8];

      shares[correct] = 76;

      let remaining = 24;

      for (let i = 0; i < 4; i++) {
        if (i !== correct) {
          const val = Math.floor(
            Math.random() * (remaining + 1)
          );

          shares[i] = val;
          remaining -= val;
        }
      }

      shares[correct] += remaining;

      room.audiencePoll = shares;
      room.lifelines.audiencePoll = false;

    } else if (type === 'expert') {
      room.lifelines.expert = false;

      io.to(room.code).emit('lifeline-result', {
        type,
        expertAnswer: correct,
        message: 'The expert suggests this option.'
      });

    } else {
      return ack?.({
        ok: false,
        error: 'Unknown lifeline.'
      });
    }

    broadcast(room);
    ack?.({ ok: true });
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.remoteSocketId === socket.id) {
        room.remoteSocketId = null;
        broadcast(room);
      }

      if (room.tvSocketId === socket.id) {
        stopTimer(room.code);
        rooms.delete(room.code);

        io.to(room.code).emit('room-closed');
      }
    }
  });
});

// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(
    `Family KBC server running on http://localhost:${PORT}`
  );
});