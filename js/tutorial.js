// Guided first day. A small step machine driven by events from main.js.
// `api` (from main): hold(bool), allow(array|null), seekCandle(n), seekBellWindow(), coach(target, html, onNext), hideCoach()
import { TUTORIAL } from './config.js';

export function createTutorial(api) {
  let step = '';
  let timer = 0;

  const go = (name) => {
    step = name;
    clearTimeout(timer);
    STEPS[name]();
  };

  const STEPS = {
    chart() {
      api.seekCandle(TUTORIAL.startCandle);
      api.hold(true);
      api.allow([]);
      api.coach('chartWrap',
        'This is your ticker, <b>NOVA</b>. Each candle is 5 minutes. The chart fills left to right through the day, so it doubles as the clock.',
        () => go('buy'));
    },
    buy() {
      api.allow(['buy']);
      api.coach('buy', 'Tap <b>BUY</b> to go long. The size selector sets how much of your buying power each tap uses.');
    },
    pnl() {
      api.hideCoach();
      api.allow([]);
      api.hold(false);
      timer = setTimeout(() => {
        api.hold(true);
        api.coach('pos',
          'That\'s your <b>open P&amp;L</b>, always with a sign and an arrow. The three meters above are the firm\'s rules: <b>daily loss</b> used, <b>drawdown</b> used, and progress to <b>target</b>.',
          () => go('flatten'));
      }, 3000);
    },
    flatten() {
      api.allow(['flat']);
      api.coach('flat', 'Tap <b>FLATTEN</b> to close the position and bank the P&amp;L.');
    },
    newsIntro() {
      api.hold(true);
      api.allow([]);
      api.coach('chartWrap',
        'See the <b>◆</b> on the time axis? That\'s scheduled news. You know <b>when</b>, not which way. Let\'s watch it land. Trade if you like.',
        () => { api.hideCoach(); api.allow(null); api.hold(false); step = 'newsWait'; });
    },
    newsLanded() {
      timer = setTimeout(() => {
        api.hold(true);
        api.coach('chartWrap',
          'News jumps the price instantly, then it drifts. The jump is capped so a Max position survives it, but size still matters.',
          () => go('bell'));
      }, 2500);
    },
    bell() {
      api.seekBellWindow();
      api.allow(null);
      api.hold(false);
      api.coach('chartWrap', 'Last 20 seconds. <b>Be flat by the bell or you\'re fired.</b>');
      timer = setTimeout(() => api.hideCoach(), 5000);
    },
  };

  return {
    start: () => go('chart'),
    onTrade(kind) {
      if (step === 'buy' && kind === 'buy') go('pnl');
      else if (step === 'flatten' && kind === 'flat') go('newsIntro');
    },
    onNews() {
      if (step === 'newsWait') { step = 'newsLanded'; STEPS.newsLanded(); }
    },
    stop() { clearTimeout(timer); api.hideCoach(); step = ''; },
  };
}
