// =============================================
// VocabMaster — app.js
// =============================================

// ---- 예시 데이터 ----
const EXAMPLE_WORDS = `abandon [v] 포기하다 / [v] 버리다
ability [n] 능력
absolute [adj] 절대적인
absorb [v] 흡수하다
abstract [adj] 추상적인 / [n] 요약
abundant [adj] 풍부한
accept [v] 받아들이다
accompany [v] 동반하다
achieve [v] 달성하다
acquire [v] 습득하다
adapt [v] 적응하다
affect [v] 영향을 미치다
aggressive [adj] 공격적인
allow [v] 허락하다
analyze [v] 분석하다
announce [v] 발표하다
apply [v] 지원하다 / [v] 적용하다
approach [n] 접근법 / [v] 다가가다
appropriate [adj] 적절한
assume [v] 가정하다
benefit [n] 이익 / [v] 혜택을 받다
challenge [n] 도전 / [v] 도전하다
complex [adj] 복잡한 / [n] 복합체
consider [v] 고려하다
define [v] 정의하다`.trim();

// ---- 상태 (State) ----
const App = {
  words:      [],   // 전체 단어 객체 배열
  testPool:   [],   // 현재 라운드 테스트 풀 (오답만 남음)
  round:      1,
  phase:      'input',
  studyAbort: null, // AbortController
  paused:     false,
  resumeFn:   null,
};

// =============================================
// 파서 (Parser)
// =============================================
function parseWords(text) {
  const result = [];
  const lines = text.trim().split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const firstBracket = line.indexOf('[');
    if (firstBracket === -1) continue;

    const word = line.substring(0, firstBracket).trim();
    if (!word) continue;

    const meaningsPart = line.substring(firstBracket);

    // ' / [' 패턴으로 복수 품사 분리
    const parts = meaningsPart.split(/ \/ (?=\[)/);
    const meanings = [];

    for (const part of parts) {
      const m = part.match(/\[([^\]]+)\]\s*(.+)/);
      if (m) {
        meanings.push({ pos: m[1].trim(), meaning: m[2].trim() });
      }
    }

    if (meanings.length > 0) {
      result.push({ word, meanings, attempts: 0, passed: false });
    }
  }

  return result;
}

// =============================================
// TTS
// =============================================
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  utt.rate = 0.85;
  utt.pitch = 1.0;
  utt.volume = 1.0;
  window.speechSynthesis.speak(utt);
}

// =============================================
// 유틸리티
// =============================================
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function checkPause() {
  if (!App.paused) return Promise.resolve();
  return new Promise(resolve => { App.resumeFn = resolve; });
}

// HTML 이스케이프
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 뜻 HTML 생성
function meaningHTML(meanings) {
  return meanings.map(m =>
    `<div class="meaning-line">
       <span class="pos-badge">[${esc(m.pos)}]</span>
       <span>${esc(m.meaning)}</span>
     </div>`
  ).join('');
}

// =============================================
// ① 입력 화면
// =============================================
function initInputView() {
  const textarea  = document.getElementById('word-input');
  const countEl   = document.getElementById('word-count');

  function updateCount() {
    const n = parseWords(textarea.value).length;
    countEl.textContent = `${n}개 단어`;
    countEl.style.color = n > 0 ? 'var(--blue)' : 'var(--text2)';
  }

  textarea.addEventListener('input', updateCount);

  document.getElementById('btn-load-example').onclick = () => {
    textarea.value = EXAMPLE_WORDS;
    updateCount();
  };

  document.getElementById('btn-start').onclick = () => {
    const words = parseWords(textarea.value);
    if (words.length === 0) {
      alert('단어를 입력해주세요.');
      return;
    }
    App.words    = words;
    App.round    = 1;
    App.testPool = [];
    startStudy([...words]);
  };
}

// =============================================
// ② 학습 화면 (자동재생)
// =============================================
async function startStudy(queue) {
  App.phase  = 'study';
  App.paused = false;

  // AbortController (건너뛰기 버튼용)
  App.studyAbort = new AbortController();
  const { signal } = App.studyAbort;

  showView('view-study');
  document.getElementById('study-round').textContent = App.round;
  document.getElementById('study-total').textContent = queue.length;

  // 일시정지 버튼
  const btnPause = document.getElementById('btn-study-pause');
  const iconEl   = document.getElementById('pause-icon');
  const labelEl  = document.getElementById('pause-label');

  btnPause.onclick = () => {
    if (App.paused) {
      App.paused = false;
      iconEl.textContent  = '⏸';
      labelEl.textContent = '일시정지';
      if (App.resumeFn) { App.resumeFn(); App.resumeFn = null; }
    } else {
      App.paused = true;
      iconEl.textContent  = '▶';
      labelEl.textContent = '계속하기';
    }
  };

  // 건너뛰기 버튼
  document.getElementById('btn-study-skip').onclick = () => {
    App.studyAbort.abort();
  };

  // 자동재생 루프
  try {
    for (let i = 0; i < queue.length; i++) {
      if (signal.aborted) break;
      await checkPause();

      document.getElementById('study-current').textContent = i + 1;
      const pct = ((i + 1) / queue.length * 100).toFixed(1);
      document.getElementById('study-progress-fill').style.width = pct + '%';

      await playWordStudy(queue[i], signal);

      // 단어 간 짧은 공백
      if (!signal.aborted) {
        clearStudyCard();
        await sleep(220, signal);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  window.speechSynthesis.cancel();
  clearStudyCard();
  startTest();
}

async function playWordStudy(wordObj, signal) {
  clearStudyCard();

  // ─ Phase 1: 단서 — TTS + 스펠링 동시 노옶 (~1.0s) ─
  speak(wordObj.word);
  document.getElementById('study-listening').classList.remove('hidden');
  const wordEl = document.getElementById('study-word');
  wordEl.textContent = wordObj.word;
  wordEl.classList.add('visible');
  await sleep(1000, signal);

  // ─ Phase 2: 회상 — 스펠링 유지, 뜻 가림 (1.5~2.0s → 1.75s) ─
  document.getElementById('study-listening').classList.add('hidden');
  document.getElementById('study-recall-hint').classList.remove('hidden');
  await sleep(1750, signal);

  // ─ Phase 3: 확인 — 스펠링 + 품사/뜻 동시 노칠, 클릭 대기 ─
  document.getElementById('study-recall-hint').classList.add('hidden');
  const meaningsEl = document.getElementById('study-meanings');
  meaningsEl.innerHTML = meaningHTML(wordObj.meanings);
  meaningsEl.classList.add('visible');
  document.getElementById('study-next-wrap').classList.remove('hidden');
  await waitForClickOrAbort('btn-study-next', signal);
  document.getElementById('study-next-wrap').classList.add('hidden');
}

function clearStudyCard() {
  document.getElementById('study-listening').classList.add('hidden');
  document.getElementById('study-recall-hint').classList.add('hidden');
  document.getElementById('study-next-wrap').classList.add('hidden');
  const w = document.getElementById('study-word');
  w.classList.remove('visible');
  w.textContent = '';
  const m = document.getElementById('study-meanings');
  m.classList.remove('visible');
  m.innerHTML = '';
}

// =============================================
// ③ 테스트 화면
// =============================================
function startTest() {
  App.phase = 'test';

  // 첫 라운드: 전체 단어 셔플 / 이후 라운드: 오답 단어 셔플
  if (App.round === 1) {
    App.testPool = shuffle([...App.words]);
  } else {
    App.testPool = shuffle(App.testPool);
  }

  showView('view-test');
  document.getElementById('test-round').textContent = App.round;

  runTestRound();
}

async function runTestRound() {
  const pool = App.testPool;
  const wrongThisRound = [];
  let correctThisRound = 0;

  for (let i = 0; i < pool.length; i++) {
    const wordObj = pool[i];

    // 진행 상태 업데이트
    document.getElementById('test-current').textContent = i + 1;
    document.getElementById('test-total').textContent   = pool.length;
    const pct = ((i + 1) / pool.length * 100).toFixed(1);
    document.getElementById('test-progress-fill').style.width = pct + '%';

    // 단어 표시
    document.getElementById('test-word').textContent = wordObj.word;

    // 뜻 숨김, 확인 버튼 표시
    document.getElementById('reveal-zone').classList.remove('hidden');
    document.getElementById('answer-zone').classList.add('hidden');

    // 뜻 확인 버튼 대기
    await waitForClick('btn-reveal');

    // 뜻 공개
    document.getElementById('reveal-zone').classList.add('hidden');
    document.getElementById('test-meanings').innerHTML = meaningHTML(wordObj.meanings);
    document.getElementById('answer-zone').classList.remove('hidden');

    // O / X 버튼 활성화
    setOXDisabled(false);

    // O 또는 X 클릭 대기
    const result = await waitForOX();

    // 클릭 후 버튼 비활성화 (더블클릭 방지)
    setOXDisabled(true);

    if (result === 'O') {
      wordObj.passed = true;
      correctThisRound++;
    } else {
      wordObj.attempts++;
      wrongThisRound.push(wordObj);
    }

    await sleep(180);
  }

  // 라운드 완료
  App.testPool = wrongThisRound;
  showRoundResult(correctThisRound, wrongThisRound.length);
}

function setOXDisabled(disabled) {
  document.getElementById('btn-correct').disabled = disabled;
  document.getElementById('btn-wrong').disabled   = disabled;
}

function waitForClick(btnId) {
  return new Promise(resolve => {
    const btn = document.getElementById(btnId);
    function handler() { btn.removeEventListener('click', handler); resolve(); }
    btn.addEventListener('click', handler);
  });
}

// 클릭 또는 abort 중 먹저 발생하는 것을 기다림 (Phase 3 확인 단계용)
function waitForClickOrAbort(btnId, signal) {
  return new Promise((resolve, reject) => {
    const btn = document.getElementById(btnId);
    function onAbort() { cleanup(); reject(new DOMException('Aborted', 'AbortError')); }
    function onClick()  { cleanup(); resolve(); }
    function cleanup() {
      btn.removeEventListener('click', onClick);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    btn.addEventListener('click', onClick);
    if (signal) signal.addEventListener('abort', onAbort);
  });
}

function waitForOX() {
  return new Promise(resolve => {
    const btnO = document.getElementById('btn-correct');
    const btnX = document.getElementById('btn-wrong');

    function cleanup() {
      btnO.removeEventListener('click', handleO);
      btnX.removeEventListener('click', handleX);
    }
    function handleO() { cleanup(); resolve('O'); }
    function handleX() { cleanup(); resolve('X'); }

    btnO.addEventListener('click', handleO);
    btnX.addEventListener('click', handleX);
  });
}

// =============================================
// ④ 라운드 결과 화면
// =============================================
function showRoundResult(correct, wrong) {
  showView('view-round-result');

  document.getElementById('round-num').textContent     = App.round;
  document.getElementById('round-correct').textContent = correct;
  document.getElementById('round-wrong').textContent   = wrong;

  const emoji = wrong === 0
    ? '🎉'
    : correct >= wrong ? '💪' : '📖';
  document.getElementById('round-result-emoji').textContent = emoji;

  const msg = wrong === 0
    ? '완벽합니다! 모든 단어를 암기했습니다. 최종 성적표를 확인하세요.'
    : `${wrong}개 단어를 다시 학습하고 테스트합니다. 화이팅!`;
  document.getElementById('round-message').textContent = msg;

  const btnNext = document.getElementById('btn-next-round');

  if (wrong === 0) {
    btnNext.textContent = '🏆 성적표 보기';
    btnNext.onclick = showFinalResult;
  } else {
    App.round++;
    btnNext.innerHTML = `Round ${App.round} 시작 →`;
    btnNext.onclick = () => startStudy([...App.testPool]);
  }
}

// =============================================
// ⑤ 최종 결과 화면
// =============================================
function showFinalResult() {
  showView('view-final');

  const all       = App.words;
  const hardWords = all.filter(w => w.attempts >= 3);

  document.getElementById('final-total').textContent  = all.length;
  document.getElementById('final-rounds').textContent = App.round;
  document.getElementById('final-hard').textContent   = hardWords.length;

  // 성적표 토글
  const tableSection = document.getElementById('table-section');
  document.getElementById('btn-toggle-table').onclick = () => {
    tableSection.classList.toggle('hidden');
  };

  // 오답 노트 재시험 버튼 (3회 이상 X)
  const btnRetry = document.getElementById('btn-retry-hard');
  if (hardWords.length > 0) {
    btnRetry.classList.remove('hidden');
    btnRetry.onclick = () => {
      // 오답 단어 초기화 후 재시험
      App.words    = hardWords.map(w => ({ ...w, attempts: 0, passed: false }));
      App.testPool = [];
      App.round    = 1;
      startStudy([...App.words]);
    };
  } else {
    btnRetry.classList.add('hidden');
  }

  // 성적표 테이블 생성 (시도 횟수 내림차순)
  const sorted = [...all].sort((a, b) => b.attempts - a.attempts);
  const tbody  = document.getElementById('result-tbody');

  tbody.innerHTML = sorted.map((w, i) => {
    const tries   = w.attempts + 1; // O를 누르기까지 걸린 총 시도 횟수
    const attCls  = tries >= 4 ? 'att-hard' : tries >= 2 ? 'att-mid' : 'att-easy';
    const meanTxt = w.meanings.map(m => `[${m.pos}] ${m.meaning}`).join(' / ');
    return `<tr>
      <td class="num-cell">${i + 1}</td>
      <td class="word-cell">${esc(w.word)}</td>
      <td>${esc(meanTxt)}</td>
      <td class="att-cell ${attCls}">${tries}회</td>
    </tr>`;
  }).join('');

  // CSV 다운로드
  document.getElementById('btn-download-csv').onclick = () => {
    const rows = [
      ['순위', '단어', '뜻', '시도횟수'],
      ...sorted.map((w, i) => [
        i + 1,
        w.word,
        w.meanings.map(m => `[${m.pos}] ${m.meaning}`).join(' / '),
        w.attempts + 1,
      ])
    ];
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'vocab_results.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 처음부터 다시
  document.getElementById('btn-restart').onclick = () => {
    App.words    = [];
    App.testPool = [];
    App.round    = 1;
    // 입력창 초기화
    document.getElementById('word-input').value = '';
    document.getElementById('word-count').textContent = '0개 단어';
    document.getElementById('word-count').style.color = 'var(--text2)';
    showView('view-input');
  };
}

// =============================================
// 초기화
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initInputView();
});
