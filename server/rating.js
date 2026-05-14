'use strict';

// Standard Elo calculation. K=32 below 30 games, K=20 otherwise.
function expectedScore(r1, r2) {
  return 1 / (1 + Math.pow(10, (r2 - r1) / 400));
}

function kFactor(gamesPlayed) {
  return gamesPlayed < 30 ? 32 : 20;
}

// score: 1 for white win, 0 for black win, 0.5 for draw
function computeRatings(whiteBefore, blackBefore, whiteGames, blackGames, score) {
  const eW = expectedScore(whiteBefore, blackBefore);
  const eB = 1 - eW;
  const sW = score;
  const sB = 1 - score;
  const kW = kFactor(whiteGames);
  const kB = kFactor(blackGames);
  return {
    whiteAfter: Math.round(whiteBefore + kW * (sW - eW)),
    blackAfter: Math.round(blackBefore + kB * (sB - eB)),
  };
}

module.exports = { computeRatings, expectedScore };
