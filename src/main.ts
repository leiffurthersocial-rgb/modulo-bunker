import { DEFAULT_SEED, Game } from './app/game';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || DEFAULT_SEED;
const game = new Game(document.body, seed);
game.start();

// Test/debug hook (used by Playwright and the dev console).
(window as unknown as { __game: Game }).__game = game;
