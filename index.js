const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./trivia.db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://84.229.242.33:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
  },
  transports: ['websocket', 'polling']
});

const games = {};

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('createGame', ({ gameCode, playerName }) => {
    if (games[gameCode]) {
      socket.emit('gameCreationError', 'קוד משחק זה כבר קיים. אנא בחר קוד אחר.');
    } else {
      db.get(
        `SELECT value FROM Settings WHERE key = 'maxPlayersPerGame'`,
        (err, row) => {
          if (err) return console.error(err.message);
          const maxPlayers = parseInt(row.value, 10);
  
          games[gameCode] = {
            players: [{ id: socket.id, name: playerName, score: 0 }],
            currentPlayerIndex: 0,
            currentQuestionIndex: -1,
            state: 'waiting',
            timer: null,
            maxPlayers: maxPlayers,
            timePerQuestion: '10000',
            questionsPerGame: 10
          };
  
          db.get(
            `SELECT value FROM Settings WHERE key = 'timePerQuestion'`,
            (err, row) => {
              if (!err && row) {
                games[gameCode].timePerQuestion = row.value;
              }
            }
          );
          
          db.get(
            `SELECT value FROM Settings WHERE key = 'questionsPerGame'`,
            (err, row) => {
              if (!err && row) {
                games[gameCode].questionsPerGame = parseInt(row.value, 10);
              }
            }
          );
  
          socket.join(gameCode);
          socket.emit('gameCreated', gameCode);
          io.to(gameCode).emit('gameState', 'waiting');
          io.to(gameCode).emit('playerList', games[gameCode].players);
        }
      );
    }
  });

  socket.on('joinGame', ({ gameCode, playerName }) => {
    const game = games[gameCode];
    if (game && game.state === 'waiting') {
      if (game.players.length >= game.maxPlayers) {
        socket.emit('error', 'המשחק מלא. לא ניתן להצטרף.');
        return;
      }
  
      game.players.push({ id: socket.id, name: playerName, score: 0 });
      socket.join(gameCode);
      socket.emit('gameCreated', gameCode);
      io.to(gameCode).emit('gameState', 'waiting');
      io.to(gameCode).emit('playerList', game.players);
    } else {
      socket.emit('error', 'המשחק לא נמצא או שכבר התחיל');
    }
  });

  socket.on('startGame', () => {
    const game = Object.values(games).find(g => g.players.some(p => p.id === socket.id));
    if (game) {
      game.state = 'playing';
      const gameCode = Object.keys(games).find(key => games[key] === game);
      io.to(gameCode).emit('gameState', 'playing');
      nextQuestion(gameCode);
    }
  });

  socket.on('answer', (answerId) => {
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    const game = games[gameCode];
  
    if (game && game.state === 'playing' && game.players[game.currentPlayerIndex].id === socket.id) {
      clearTimeout(game.timer);
  
      db.get(
        `SELECT is_correct FROM Answers WHERE id = ?`,
        [answerId],  // Directly check if the provided answerId is correct
        (err, answer) => {
          if (err) {
            console.error('Error fetching the answer:', err.message);
            return;
          }
  
          if (answer && answer.is_correct) {
            game.players[game.currentPlayerIndex].score++;
            console.log('Correct answer! Score updated.');
          } else {
            console.log('Incorrect answer.');
          }
  
          io.to(gameCode).emit('playerList', game.players);
          nextQuestion(gameCode);
        }
      );
    }
  });

  socket.on('leaveGame', () => {
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    if (gameCode) {
      leaveGame(socket, gameCode);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    if (gameCode) {
      leaveGame(socket, gameCode);
    }
  });
});

function leaveGame(socket, gameCode) {
  try {
    const game = games[gameCode];
    game.players = game.players.filter(p => p.id !== socket.id);
    socket.leave(gameCode);

    if (game.players.length === 0) {
      clearTimeout(game.timer);
      delete games[gameCode];
    } else {
      io.to(gameCode).emit('playerList', game.players);
      if (game.state === 'playing' && game.players[game.currentPlayerIndex].id === socket.id) {
        nextQuestion(gameCode);
      }
    }
  } catch (e) {
    console.log(e);
  }
}

function nextQuestion(gameCode) {
  const game = games[gameCode];
  
  game.currentQuestionIndex++;

  if (game.currentQuestionIndex >= game.questionsPerGame) {
    endGame(gameCode);
    return;
  }

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

  db.get(
    `SELECT * FROM Questions ORDER BY RANDOM() LIMIT 1`,
    (err, currentQuestion) => {
      if (err) return console.error(err.message);

      if (!currentQuestion) {
        console.error('No questions found in the database');
        endGame(gameCode);
        return;
      }

      db.all(
        `SELECT id, answer_text, is_correct FROM Answers WHERE question_id = ?`,
        [currentQuestion.id],
        (err, answers) => {
          if (err) return console.error(err.message);

          const questionUpdate = {
            question: {
              text: currentQuestion.question_text,
              answers: answers.map(answer => ({
                id: answer.id,
                text: answer.answer_text
              })),
            },
            currentPlayer: game.players[game.currentPlayerIndex],
            timeLeft: parseInt(game.timePerQuestion, 10) / 1000,
            currentQuestionNumber: game.currentQuestionIndex + 1,
            totalQuestions: game.questionsPerGame
          };

          io.to(gameCode).emit('questionUpdate', questionUpdate);
          startTimer(gameCode);
        }
      );
    }
  );
}

function startTimer(gameCode) {
  const game = games[gameCode];
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    nextQuestion(gameCode);
  }, parseInt(game.timePerQuestion, 10));
}

function endGame(gameCode) {
  const game = games[gameCode];
  game.state = 'finished';
  io.to(gameCode).emit('gameState', 'finished');
  clearTimeout(game.timer);
  delete games[gameCode];
}

app.get('/', (req, res) => {
  res.send('Welcome to the Trivia Game Server');
});

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`Server running on port ${port}`));