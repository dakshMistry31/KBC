import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
const socket = io(SERVER_URL, { autoConnect: true });
const LETTERS = ['A', 'B', 'C', 'D'];
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function Home() {
  return <main className="home"><div className="brand-mark">KBC</div><p className="eyebrow">FAMILY QUIZ NIGHT</p><h1>Who wants to<br /><span>play a game?</span></h1><p className="sub">A big-screen quiz. A phone-sized remote. One unforgettable family game night.</p><div className="home-actions"><a className="primary" href="/tv">Open TV screen <span>↗</span></a><a className="secondary" href="/remote">Open mobile remote <span>↗</span></a></div><p className="home-note">Open the TV screen first to create a room, then connect your phone with the room code.</p></main>;
}

function TvScreen() {
  const [code, setCode] = useState('');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [removedOptions, setRemovedOptions] = useState([]);
  const [expertHint, setExpertHint] = useState(null);
  const [created, setCreated] = useState(false);
  useEffect(() => {
    const onState = (s) => setState(s);
    const onLife = (r) => { if (r.type === 'fiftyFifty') setRemovedOptions(r.removedOptions || []); if (r.type === 'expert') setExpertHint(r.expertAnswer); };
    const onClosed = () => { setError('TV room was closed. Refresh to create a new room.'); setState(null); setCode(''); setCreated(false); };
    socket.on('game-state', onState); socket.on('lifeline-result', onLife); socket.on('room-closed', onClosed);
    return () => { socket.off('game-state', onState); socket.off('lifeline-result', onLife); socket.off('room-closed', onClosed); };
  }, []);
  const createRoom = () => { setError(''); socket.emit('create-room', (r) => { if (r?.ok) { setCode(r.code); setState(r.state); setCreated(true); } else setError(r?.error || 'Could not create room.'); }); };
  const phase = state?.phase;
  const question = state?.question;
  const answer = question?.answer;
  return <main className="tv-page"><header className="tv-top"><a href="/" className="brand">FAMILY <b>KBC</b></a><span className="live-dot">● LIVE QUIZ</span></header>
    {!created ? <section className="tv-lobby"><div className="orb">KBC</div><p className="eyebrow">WELCOME TO FAMILY KBC</p><h1>Let the game<br /><span>begin.</span></h1><p className="sub">Create a room and connect your mobile remote.</p><button className="gold-button large" onClick={createRoom}>Create game room</button>{error && <p className="error">{error}</p>}</section> : <>
      <section className="room-banner"><div><span className="eyebrow">JOIN ON YOUR PHONE</span><div className="room-code">{code}</div><p>Open <b>/remote</b> on mobile and enter this code</p></div><div className={`connection ${state?.playersConnected ? 'connected' : ''}`}><span className="pulse" />{state?.playersConnected ? 'REMOTE CONNECTED' : 'WAITING FOR REMOTE'}</div></section>
      {phase === 'lobby' && <section className="tv-lobby compact"><div className="orb">KBC</div><h1>Ready, family?</h1><p className="sub">Start the game from your connected mobile remote.</p></section>}
      {phase === 'question' || phase === 'locked' || phase === 'timeout' || phase === 'revealed' || phase === 'wrong' ? <section className={`game-layout ${phase === 'wrong' ? 'wrong-state' : ''}`}><div className="question-panel"><div className="question-meta"><span>QUESTION {state.questionIndex + 1} / {state.totalQuestions}</span><span className={`timer ${state.timeLeft <= 8 ? 'urgent' : ''}`}>◷ {String(state.timeLeft).padStart(2, '0')}s</span></div><div className="question-text">{question?.question}</div><div className="answers-tv">{question?.options.map((opt, i) => {
        const isSelected = state.selectedAnswer === i; const isCorrect = ['revealed', 'wrong'].includes(phase) && answer === i; const isWrong = ['revealed', 'wrong'].includes(phase) && isSelected && answer !== i; const removed = removedOptions.includes(i) && phase !== 'revealed';
        return <div key={i} className={`answer-tv ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''} ${removed ? 'removed' : ''}`}><span className="letter">{LETTERS[i]}</span><span>{removed ? '—' : opt}</span>{isCorrect && <span className="answer-mark">✓</span>}</div>;
      })}</div>{phase === 'locked' && <div className="status-line">ANSWER LOCKED — WAITING FOR REVEAL</div>}{phase === 'timeout' && <div className="status-line warning">TIME'S UP!</div>}{phase === 'revealed' && <div className="reveal-box"><b>🎉 CORRECT ANSWER!</b><p>{question?.explanation}</p><div className="earned">Prize for this question: {rupees(state.prize)}</div></div>}{phase === 'wrong' && <div className="red-light-box"><div className="red-light">✕</div><b>WRONG ANSWER — RED LIGHT!</b><p>The correct answer is {LETTERS[answer]}. {question?.explanation}</p>{state.rescueAvailable ? <strong>ONE RESCUE LIFE AVAILABLE — use the mobile remote to continue.</strong> : <strong>GAME OVER — restart from your mobile remote.</strong>}</div>}{state.audiencePoll && <div className="poll"><b>Audience Poll</b>{state.audiencePoll.map((v, i) => <div className="poll-row" key={i}><span>{LETTERS[i]}</span><div className="poll-bar"><i style={{ width: `${v}%` }} /></div><b>{v}%</b></div>)}</div>}{expertHint !== null && phase !== 'revealed' && <div className="expert-hint">Expert's suggestion: Option {LETTERS[expertHint]}</div>}</div><aside className="ladder"><h3>PRIZE LADDER</h3>{[70000000,5000000,2500000,1250000,640000,320000,160000,80000,40000,20000,10000,5000,3000,2000,1000].map((amount, idx) => { const questionNumber = 14 - idx; return <div key={amount} className={`ladder-row ${state.questionIndex === questionNumber ? 'active' : ''} ${state.questionIndex > questionNumber ? 'passed' : ''}`}><span>{questionNumber + 1}</span><b>{rupees(amount)}</b></div>; })}</aside></section> : null}
      {phase === 'gameover' && <section className="tv-lobby compact"><div className="orb">🏆</div><p className="eyebrow">GAME COMPLETE</p><h1>Congratulations!</h1><p className="sub">Your family quiz night is complete.</p><div className="final-prize">{rupees(state.winnings)}</div><p>Final prize achieved</p></section>}
    </>}
    <footer className="tv-footer">FAMILY KBC <span>•</span> QUIZ NIGHT EDITION</footer>
  </main>;
}

function Remote() {
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [removedOptions, setRemovedOptions] = useState([]);
  const [expertHint, setExpertHint] = useState(null);
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    const onState = (s) => setState(s);
    const onLife = (r) => { if (r.type === 'fiftyFifty') setRemovedOptions(r.removedOptions || []); if (r.type === 'expert') setExpertHint(r.expertAnswer); };
    const onClosed = () => { setJoined(false); setState(null); setCode(''); setError('TV room closed.'); };
    socket.on('game-state', onState); socket.on('lifeline-result', onLife); socket.on('room-closed', onClosed);
    return () => { socket.off('game-state', onState); socket.off('lifeline-result', onLife); socket.off('room-closed', onClosed); };
  }, []);
  const emitAction = (event, payload = {}) => { setError(''); socket.emit(event, { code, ...payload }, (r) => { if (!r?.ok) setError(r?.error || 'Action failed.'); }); };
  const join = () => { setError(''); const clean = codeInput.trim(); if (!/^\d{6}$/.test(clean)) return setError('Enter the 6-digit room code shown on TV.'); socket.emit('join-room', { code: clean }, (r) => { if (r?.ok) { setCode(clean); setState(r.state); setJoined(true); } else setError(r?.error || 'Could not join room.'); }); };
  const phase = state?.phase;
  const selected = state?.selectedAnswer;
  const question = state?.question;
  return <main className="remote-page"><header className="remote-head"><a href="/" className="brand">FAMILY <b>KBC</b></a><span className="remote-badge">MOBILE REMOTE</span></header>
    {!joined ? <section className="remote-join"><div className="remote-icon">⌁</div><p className="eyebrow">CONNECT TO THE BIG SCREEN</p><h1>Join the<br /><span>hot seat.</span></h1><p className="sub">Enter the six-digit code displayed on your TV.</p><label htmlFor="roomcode">GAME ROOM CODE</label><input id="roomcode" inputMode="numeric" maxLength={6} value={codeInput} onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))} placeholder="000000" /><button className="gold-button" onClick={join}>Connect remote</button>{error && <p className="error">{error}</p>}<p className="tiny">Make sure your TV game is open before connecting.</p></section> : <>
      <div className="remote-roomline"><span><i className="pulse" /> CONNECTED</span><b>ROOM {code}</b></div>
      {phase === 'lobby' && <section className="remote-control"><p className="eyebrow">YOU'RE CONNECTED</p><h1>Ready to<br /><span>play?</span></h1><p className="sub">Start the quiz when everyone is ready.</p><button className="gold-button big" onClick={() => emitAction('start-game')}>START GAME</button></section>}
      {['question','locked','timeout','revealed','wrong'].includes(phase) && <section className="remote-control"><div className="remote-progress"><span>QUESTION {state.questionIndex + 1} / {state.totalQuestions}</span><b>◷ {state.timeLeft}s</b></div><h2>{question?.question}</h2><p className="remote-hint">{phase === 'question' ? 'Tap your answer below.' : phase === 'locked' ? 'Your answer is locked. Reveal it when ready.' : phase === 'timeout' ? "Time's up! Reveal the answer." : phase === 'wrong' ? 'Wrong answer. The red light is on.' : state.selectedAnswer === question?.answer ? 'Correct! Well played.' : 'Answer revealed. Keep going!'}</p><div className="answer-grid">{question?.options.map((opt, i) => { const isSelected = selected === i; const isCorrect = ['revealed','wrong'].includes(phase) && question.answer === i; const isWrong = ['revealed','wrong'].includes(phase) && isSelected && question.answer !== i; const removed = removedOptions.includes(i) && phase !== 'revealed'; return <button key={i} disabled={phase !== 'question' || removed} onClick={() => emitAction('select-answer', { answer: i })} className={`remote-option ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''} ${removed ? 'removed' : ''}`}><span>{LETTERS[i]}</span><b>{removed ? '—' : opt}</b></button>; })}</div>
        {phase === 'question' && <button className="gold-button big" disabled={selected === null} onClick={() => emitAction('lock-answer')}>LOCK ANSWER</button>}
        {(phase === 'locked' || phase === 'timeout') && <button className="gold-button big" onClick={() => emitAction('reveal-answer')}>REVEAL ANSWER</button>}
        {phase === 'revealed' && <><div className="remote-result"><b>✓ Correct answer!</b><p>{question?.explanation}</p><strong>{rupees(state.prize)}</strong></div>{state.questionIndex + 1 < state.totalQuestions ? <button className="gold-button big" onClick={() => { setRemovedOptions([]); setExpertHint(null); emitAction('next-question'); }}>NEXT QUESTION →</button> : <button className="gold-button big" onClick={() => emitAction('next-question')}>FINISH GAME</button>}</>}{phase === 'wrong' && <div className="wrong-remote"><div className="red-light">✕</div><p className="eyebrow">WRONG ANSWER — RED LIGHT</p><h3>Oh no! The correct answer was {LETTERS[question?.answer]}.</h3><p>{question?.explanation}</p>{state.rescueAvailable ? <><div className="rescue-card"><b>🛟 ONE RESCUE LIFE</b><p>You're out before Question 5. Use your one life to skip this question and continue to the next one.</p></div><button className="gold-button big rescue-button" onClick={() => { setRemovedOptions([]); setExpertHint(null); emitAction('use-rescue-life'); }}>USE RESCUE LIFE — CONTINUE</button></> : <p className="final-out">{state.rescueUsed ? 'Your rescue life has already been used.' : 'The rescue life is available only before Question 5.'} Game over.</p>}<button className="restart-button" onClick={() => { setRemovedOptions([]); setExpertHint(null); emitAction('restart-game'); }}>↻ RESTART GAME</button></div>}
        {phase === 'question' && <div className="lifelines"><p className="eyebrow">LIFELINES</p><div className="life-buttons"><button disabled={!state.lifelines.fiftyFifty} onClick={() => emitAction('use-lifeline', { type: 'fiftyFifty' })}>50:50</button><button disabled={!state.lifelines.audiencePoll} onClick={() => emitAction('use-lifeline', { type: 'audiencePoll' })}>AUDIENCE</button><button disabled={!state.lifelines.expert} onClick={() => emitAction('use-lifeline', { type: 'expert' })}>EXPERT</button></div>{state.audiencePoll && <div className="remote-poll">{state.audiencePoll.map((v, i) => <span key={i}>{LETTERS[i]}: {v}%</span>)}</div>}{expertHint !== null && <p className="expert-hint">Expert suggests: {LETTERS[expertHint]}</p>}</div>}
      </section>}
      {phase === 'gameover' && <section className="remote-control finish"><div className="remote-icon">🏆</div><p className="eyebrow">QUIZ COMPLETE</p><h1>Well<br /><span>played!</span></h1><div className="final-prize">{rupees(state.winnings)}</div><p className="sub">Final prize achieved</p><button className="gold-button big" onClick={() => emitAction('restart-game')}>↻ RESTART GAME</button></section>}
    </>}
    {error && <p className="remote-error">{error}</p>}<footer className="remote-footer">FAMILY KBC • YOUR PHONE, YOUR GAME</footer>
  </main>;
}

export default function App() {
  const path = window.location.pathname.toLowerCase();
  if (path === '/tv') return <TvScreen />;
  if (path === '/remote') return <Remote />;
  return <Home />;
}
