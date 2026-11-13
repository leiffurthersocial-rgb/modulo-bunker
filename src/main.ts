import './ui/styles.css';
import { DEFAULT_SEED, Game } from './app/game';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || DEFAULT_SEED;

Game.create(document.body, seed).then((game) => {
  game.start();
  // Test/debug hook (used by Playwright and the dev console).
  (window as unknown as { __game: Game }).__game = game;
  if (params.get('view') === 'overview') game.setMode('overview');
});
