const API_URL = "https://script.google.com/macros/s/AKfycbzMoP6MZ8MOpgAusiIbLuKSEabCmQv-PhZ3k7P_FCxljNRez0pRR678YcXeQJj2tXce0g/exec";
const $ = id => document.getElementById(id);

let room = "";
let team = "";
let playerName = "";
let regNo = "";
let state = null;

let serverTimeOffset = 0;

let poller = null;
let ticker = null;

let answered = {};
let renderedRound = "";

// Round 4 riddle challenge: one option can be selected, then submitted.
let riddleSelections = {};

const playerId = (
  crypto.randomUUID
    ? crypto.randomUUID()
    : "p" + Date.now() + "_" + Math.random().toString(36).slice(2)
);


/* =========================
   SCREEN MANAGEMENT
========================= */

function screen(id) {
  ["home", "team", "result"].forEach(x => {
    const el = $(x);
    if (el) el.classList.toggle("hidden", x !== id);
  });
}


/* =========================
   SAFE HTML
========================= */

function safe(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


/* =========================
   API CONNECTION
========================= */
function api(action, data = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "ikon_cb_" + Date.now() + "_" +
      Math.random().toString(36).slice(2);

    const script = document.createElement("script");
    let completed = false;

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    function finish(error, result) {
      if (completed) return;
      completed = true;
      cleanup();

      if (error) reject(error);
      else resolve(result);
    }

    window[callbackName] = response => {
      if (!response || response.ok !== true) {
        finish(Error(response?.error || "Invalid server response"));
        return;
      }

      finish(null, response.data);
    };

    script.onerror = () => {
      finish(Error(
        "Game server connection failed. Check Apps Script deployment."
      ));
    };

    const timer = setTimeout(() => {
      finish(Error("Game server response timeout."));
    }, 30000);

    const query = new URLSearchParams({
      action: String(action),
      callback: callbackName,
      payload: JSON.stringify(data),
      _: String(Date.now())
    });

    script.src = API_URL + "?" + query.toString();
    document.head.appendChild(script);
  });
}

/* =========================
   STUDENT LOGIN
========================= */

async function join() {
  try {
    regNo = $("reg").value.trim().toUpperCase();

    if (!regNo) {
      throw Error("Please enter your Registration Number.");
    }

    $("joinBtn").disabled = true;
    $("loginMessage").textContent = "Joining battle…";

    const d = await api("joinPlayer", {
      regNo,
      playerId
    });

    room = d.room;
    team = d.team;
    playerName = d.playerName;

    $("teamName").textContent =
      (team === "A" ? "🔵 TEAM A" : "🔴 TEAM B") +
      " • " + playerName;

    $("teamTitle").textContent =
      "You joined successfully. Waiting for teacher to start…";

    screen("team");
    startPolling();

  } catch (e) {
    $("loginMessage").textContent = e.message;
    $("joinBtn").disabled = false;
  }
}


/* =========================
   POLLING
========================= */

function startPolling() {
  if (poller) clearInterval(poller);

  refresh();
  poller = setInterval(refresh, 5000);

  if (ticker) clearInterval(ticker);
  ticker = setInterval(renderTimer, 250);
}


async function refresh() {
  try {
    const requestStartedAt = Date.now();

    state = await api("getState", { room });

    const responseReceivedAt = Date.now();

    if (
      state.serverNow !== undefined &&
      Number.isFinite(Number(state.serverNow))
    ) {
      const clientMidpoint =
        (requestStartedAt + responseReceivedAt) / 2;

      serverTimeOffset =
        Number(state.serverNow) - clientMidpoint;
    }

    $("connection").textContent = "● Connected";

    render();
    renderTimer();

  } catch (e) {
    $("connection").textContent = "● Reconnecting";
    console.warn(e);
  }
}


/* =========================
   CURRENT ROUND IDENTIFIER
========================= */

function getRoundKey() {
  if (state?.tieBreaker?.active) {
    return "TIE_BREAKER_" +
      Number(state.tieBreaker.questionIndex || 0);
  }

  return "NORMAL_" + Number(state?.currentRound ?? -1);
}


/* =========================
   MAIN RENDER
========================= */

function render() {
  if (!state) return;

  const idx = Number(state.currentRound ?? -1);
  const rounds = state.rounds || [];

  const scores = state.scores || {
    A: 0,
    B: 0
  };

  $("teamScore").textContent = scores[team] || 0;

  if (state.finished) {
    showFinal();
    return;
  }

  if (idx < 0) {
    $("teamTitle").textContent =
      "Waiting for teacher to start the battle…";

    $("tasks").innerHTML =
      "<p class='waiting'>You are in. Please wait for the teacher.</p>";

    return;
  }

  const isTieBreaker =
    state.tieBreaker?.active === true;

  const r = rounds[idx];

  if (!r) {
    $("teamTitle").textContent =
      "Waiting for next question…";
    return;
  }

  if (isTieBreaker) {
    const questionNumber =
      Number(state.tieBreaker.questionIndex || 0) + 1;

    $("teamTitle").textContent =
      "⚡ SUDDEN DEATH • TIE BREAKER QUESTION " +
      questionNumber;
  } else {
    $("teamTitle").textContent =
      `ROUND ${idx + 1}: ${r.title}`;
  }

  const currentKey = getRoundKey();

  if (renderedRound !== currentKey) {
    renderedRound = currentKey;
    answered = {};
    riddleSelections = {};

    renderTasks(r);
  }

  if (
    isTieBreaker &&
    Array.isArray(state.tieBreaker.answeredTeams) &&
    state.tieBreaker.answeredTeams.includes(team)
  ) {
    $("feedback").textContent =
      "Your team has submitted its answer. Waiting for the other team…";

    document.querySelectorAll(
      "#tasks button, #tasks input"
    ).forEach(x => x.disabled = true);
  }

  if (state.roundOver) {
    $("feedback").textContent =
      "Round complete. Waiting for next round…";
  }
}


/* =========================
   RENDER TASKS
========================= */

function renderTasks(r) {
  const area = $("tasks");
  const isRiddleRound =
    Number(r.roundNo) === 4 ||
    String(r.type || "").toUpperCase() === "RIDDLE";

  area.innerHTML = (r.tasks || [])
    .map((t, i) => taskHTML(t, i, isRiddleRound))
    .join("");

  (r.tasks || []).forEach((t, i) => {
    if (isRiddleRound) {
      const optionButtons = area.querySelectorAll(
        `[data-riddle-option="${i}"]`
      );
      const submitButton = area.querySelector(`[data-riddle-submit="${i}"]`);

      optionButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          if (riddleSelections[i] !== undefined || answered[i]) return;

          riddleSelections[i] = btn.dataset.answer;

          optionButtons.forEach(option => {
            option.disabled = true;
            option.classList.toggle("selected", option === btn);
            option.setAttribute("aria-pressed", option === btn ? "true" : "false");
          });

          if (submitButton) submitButton.disabled = false;
          $("feedback").textContent =
            "Option selected. Press SUBMIT ANSWER to lock your response.";
        });
      });

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.addEventListener("click", () => {
          if (riddleSelections[i] === undefined) {
            $("feedback").textContent = "Please select one option first.";
            return;
          }
          send(i, t.taskNo, riddleSelections[i]);
        });
      }
      return;
    }

    if (String(t.type).toUpperCase() === "QUIZ") {
      area.querySelectorAll(`[data-q="${i}"]`).forEach(btn => {
        btn.addEventListener("click", () => {
          send(i, t.taskNo, btn.dataset.answer);
        });
      });
    } else {
      const btn = area.querySelector(`[data-submit="${i}"]`);
      if (btn) {
        btn.onclick = () => {
          const input = area.querySelector(`[data-input="${i}"]`);
          send(i, t.taskNo, input ? input.value : "");
        };
      }

      const input = area.querySelector(`[data-input="${i}"]`);
      if (input && Number(r.roundNo) === 5) {
        input.addEventListener("keydown", event => {
          if (event.key === "Enter" && btn && !btn.disabled) {
            btn.click();
          }
        });
      }
    }
  });
}


/* =========================
   TASK HTML
========================= */


function driveImageUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  // Extract Google Drive file ID from different Drive URL formats.
  const idMatch = raw.match(
    /(?:drive\.google\.com\/thumbnail\?id=|drive\.google\.com\/uc\?[^#]*id=|drive\.google\.com\/file\/d\/|drive\.google\.com\/open\?id=)([a-zA-Z0-9_-]+)/
  );

  if (idMatch) {
    return "https://drive.google.com/thumbnail?id=" +
      encodeURIComponent(idMatch[1]) + "&sz=w1000";
  }

  if (/^https:\/\//i.test(raw)) {
    return raw;
  }

  return "";
}



function taskHTML(t, i, isRiddleRound = false) {
  const type = String(t.type || "TEXT").toUpperCase();

  const taskLabel = state.tieBreaker?.active
    ? "⚡ TIE BREAKER QUESTION"
    : `TASK ${i + 1}`;

  if (isRiddleRound || type === "RIDDLE") {
    return `
      <article class="task task-premium riddle-task">
        <small>${taskLabel} • RIDDLE CHALLENGE</small>
        <h3>${safe(t.prompt)}</h3>
        <p class="task-hint">Select one answer. Once selected, it cannot be changed.</p>
        <div class="answers riddle-answers">
          ${(t.options || []).map((o, n) => `
            <button
              type="button"
              class="answer riddle-option"
              data-riddle-option="${i}"
              data-answer="${safe(o)}"
              aria-pressed="false"
            >
              <span class="answer-letter">${"ABCD"[n] || n + 1}</span>
              <span>${safe(o)}</span>
            </button>
          `).join("")}
        </div>
        <button
          type="button"
          class="primary-submit"
          data-riddle-submit="${i}"
          disabled
        >SUBMIT ANSWER</button>
      </article>`;
  }

  const currentRoundNo = Number(
    state?.rounds?.[Number(state?.currentRound ?? -1)]?.roundNo || 0
  );

  // ROUND 5: GUESS THE BOLLYWOOD MOVIE FROM ITS DIALOGUE
  if (currentRoundNo === 5) {
    return `
      <article class="task task-premium dialogue-task">
        <small>${taskLabel} • GUESS THE BOLLYWOOD MOVIE</small>
        <div class="dialogue-icon" aria-hidden="true">🎬</div>
        <h3 class="dialogue-heading">Which Bollywood movie is this dialogue from?</h3>
        <div class="dialogue-quote">
          <span class="dialogue-quote-mark">“</span>
          <p>${safe(t.prompt)}</p>
          <span class="dialogue-quote-mark closing">”</span>
        </div>
        <label class="dialogue-label" for="dialogue-answer-${i}">ENTER MOVIE NAME</label>
        <input
          id="dialogue-answer-${i}"
          class="dialogue-input"
          data-input="${i}"
          autocomplete="off"
          autocapitalize="words"
          placeholder="Type the Bollywood movie name"
        >
        <button class="primary-submit" data-submit="${i}">
          SUBMIT ANSWER
        </button>
        <p class="task-hint">Your answer cannot be changed after submission.</p>
      </article>`;
  }

  if (type === "QUIZ") {
    return `
      <article class="task task-premium">
        <small>${taskLabel}</small>
        <h3>${safe(t.prompt)}</h3>

        <div class="answers">
          ${(t.options || []).map((o, n) => `
            <button
              class="answer"
              data-q="${i}"
              data-answer="${safe(o)}"
            >
              <span class="answer-letter">
                ${"ABCD"[n] || n + 1}
              </span>
              <span>${safe(o)}</span>
            </button>
          `).join("")}
        </div>
      </article>`;
  }

 
if (type === "LOGO") {
  const imageUrl = driveImageUrl(t.prompt);

  return `
    <article class="task task-premium logo-task">
      <small>${taskLabel} • GUESS THE LOGO</small>
      <h3>Which brand does this logo belong to?</h3>

      ${imageUrl
        ? `
          <div class="logo-image-frame">
            <img
              class="guess-logo-image"
              src="${safe(imageUrl)}"
              alt="Guess the brand logo"
              referrerpolicy="no-referrer"
              onerror="this.onerror=null;this.parentElement.innerHTML='<p class=logo-image-error>Logo could not load. Please contact your teacher.</p>';"
            >
          </div>
        `
        : `
          <p class="logo-image-error">
            Logo file not found. Please check the Tasks sheet filename.
          </p>
        `
      }

      <p class="task-hint">
        Look carefully and enter the brand name.
      </p>

      <input data-input="${i}" autocomplete="off"
        placeholder="Enter brand / company name">

      <button class="primary-submit" data-submit="${i}">
        SUBMIT ANSWER
      </button>
    </article>`;
}


  const hint = type === "SCRAMBLE"
    ? "Unscramble the word"
    : "Enter your answer";

  return `
    <article class="task task-premium">
      <small>${taskLabel} • ${safe(type)}</small>
      <h3>${safe(t.prompt)}</h3>

      <input
        data-input="${i}"
        autocomplete="off"
        placeholder="${hint}"
      >

      <button class="primary-submit" data-submit="${i}">
        SUBMIT ANSWER
      </button>
    </article>`;
}
/* =========================
   SUBMIT ANSWER
========================= */

async function send(i, taskNo, answer) {
  if (answered[i] || state.roundOver) return;

  answer = String(answer ?? "").trim();
  if (!answer) {
    $("feedback").textContent = "Please select or enter an answer.";
    return;
  }

  answered[i] = true;

  const buttons = document.querySelectorAll(
    `[data-q="${i}"], [data-submit="${i}"], ` +
    `[data-riddle-option="${i}"], [data-riddle-submit="${i}"]`
  );
  buttons.forEach(b => b.disabled = true);

  $("feedback").textContent = "Saving your answer…";

  const payload = {
    room,
    team,
    playerName,
    regNo,
    playerId,
    taskNo: Number(taskNo),
    answer
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await api("submitAnswer", payload);
      $("feedback").textContent =
        result?.message || "Answer submitted successfully.";

      if (result?.teamScore !== undefined) {
        $("teamScore").textContent = result.teamScore;
      }

      await refresh();
      return;
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        $("feedback").textContent =
          "Connection delayed. Checking saved answer… Attempt " +
          (attempt + 1) + " of 3.";
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  answered[i] = false;
  const retryButton = document.querySelector(`[data-riddle-submit="${i}"]`);
  if (retryButton && riddleSelections[i] !== undefined) {
    retryButton.disabled = false;
  }

  $("feedback").textContent =
    "Submission status could not be confirmed. Please wait and check with your teacher.";
  console.error("Answer submission status:", lastError);
}


/* =========================
   SERVER-SYNCHRONIZED TIMER
========================= */

function renderTimer() {
  if (!state || state.finished) return;

  const idx = Number(state.currentRound ?? -1);

  if (idx < 0) return;

  const isTieBreaker =
    state.tieBreaker?.active === true;

  let duration;

  if (isTieBreaker) {
    duration = 45;
  } else {
    const r = state.rounds?.[idx];

    if (!r) return;

    duration = Number(r.durationSec) || 60;
  }

  const startedAt =
    Number(state.roundStartedAt || 0);

  const synchronizedNow =
    Date.now() + serverTimeOffset;

  const left = startedAt
    ? Math.max(
        0,
        Math.ceil(
          (startedAt + duration * 1000 - synchronizedNow) / 1000
        )
      )
    : duration;

  $("teamTimer").textContent =
    String(Math.floor(left / 60)).padStart(2, "0") +
    ":" +
    String(left % 60).padStart(2, "0");

  $("teamProgress").style.width =
    Math.max(0, left / duration * 100) + "%";
}


/* =========================
   FINAL RESULT
========================= */

function setText(id, value) {
  const el = $(id);

  if (el) {
    el.textContent = value;
  } else {
    console.warn("Missing HTML element: #" + id);
  }
}


function showFinal() {
  const s = state.scores || { A: 0, B: 0 };

  const scoreA = Number(s.A || 0);
  const scoreB = Number(s.B || 0);

  setText("finalScoreA", scoreA);
  setText("finalScoreB", scoreB);

  setText(
    "finalNameA",
    state.teams?.A?.name || "TEAM A"
  );

  setText(
    "finalNameB",
    state.teams?.B?.name || "TEAM B"
  );

  setText(
    "membersTitleA",
    state.teams?.A?.name || "TEAM A"
  );

  setText(
    "membersTitleB",
    state.teams?.B?.name || "TEAM B"
  );

  const tbWinner = state.tieBreaker?.winner || "";
  let winnerText;

  if (tbWinner === "A") {
    winnerText =
      "🏆 " + (state.teams?.A?.name || "TEAM A") +
      " WINS THE TIE BREAKER!";

  } else if (tbWinner === "B") {
    winnerText =
      "🏆 " + (state.teams?.B?.name || "TEAM B") +
      " WINS THE TIE BREAKER!";

  } else if (state.tieBreaker) {
    winnerText =
      "🤝 MATCH DRAW — TIE BREAKER QUESTIONS EXHAUSTED";

  } else {
    winnerText = scoreA === scoreB
      ? "🤝 IT'S A DRAW!"
      : scoreA > scoreB
        ? "🏆 " + (state.teams?.A?.name || "TEAM A") + " WINS!"
        : "🏆 " + (state.teams?.B?.name || "TEAM B") + " WINS!";
  }

  setText("winner", winnerText);

  const individual = state.individualScores || {
    A: [],
    B: []
  };

  const allMembers = [
    ...(individual.A || []),
    ...(individual.B || [])
  ].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0)
  );

  const topA = (individual.A || [])[0];
  const topB = (individual.B || [])[0];

  const topHTML = (member, teamLabel, teamClass) => member ? `
    <article class="mvp-card ${teamClass}">
      <div class="mvp-crown">♛</div>
      <span class="mvp-label">
        ${safe(teamLabel)} • TOP SCORER
      </span>
      <strong>${safe(member.name)}</strong>
      <span class="mvp-reg">${safe(member.regNo)}</span>
      <b>${Number(member.score || 0)} <small>PTS</small></b>
    </article>
  ` : `
    <article class="mvp-card ${teamClass}">
      <span class="mvp-label">${safe(teamLabel)}</span>
      <strong>No player data</strong>
      <b>0 <small>PTS</small></b>
    </article>
  `;

  const mvpArea = $("topPerformers");

  if (mvpArea) {
    mvpArea.innerHTML =
      topHTML(
        topA,
        state.teams?.A?.name || "TEAM A",
        "mvp-a"
      ) +
      topHTML(
        topB,
        state.teams?.B?.name || "TEAM B",
        "mvp-b"
      );
  }

  const makeTable = teamKey => {
    const list = individual[teamKey] || [];

    if (!list.length) {
      return `
        <div class="empty-members">
          No joined member records found.
        </div>`;
    }

    return `
      <div class="member-table-wrap">
        <table class="member-table">
          <thead>
            <tr>
              <th>RANK</th>
              <th>TEAM MEMBER</th>
              <th>REG. NO.</th>
              <th>ATTEMPTS</th>
              <th>SCORE</th>
            </tr>
          </thead>

          <tbody>
            ${list.map(m => `
              <tr class="${Number(m.rank) === 1 ? "rank-first" : ""}">
                <td>
                  <span class="rank-pill">
                    ${Number(m.rank) === 1
                      ? "🥇"
                      : "#" + Number(m.rank)}
                  </span>
                </td>

                <td><strong>${safe(m.name)}</strong></td>
                <td>${safe(m.regNo)}</td>
                <td>${Number(m.attempts || 0)}</td>
                <td>
                  <strong class="member-points">
                    ${Number(m.score || 0)}
                  </strong>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  };

  const memberA = $("membersA");
  const memberB = $("membersB");

  if (memberA) {
    memberA.innerHTML = makeTable("A");
  }

  if (memberB) {
    memberB.innerHTML = makeTable("B");
  }

  const totalMembers = $("totalMembers");

  if (totalMembers) {
    totalMembers.textContent = allMembers.length;
  }

  const totalAttempts = $("totalAttempts");

  if (totalAttempts) {
    totalAttempts.textContent = allMembers.reduce(
      (n, m) => n + Number(m.attempts || 0),
      0
    );
  }

  screen("result");
}


/* =========================
   EVENTS
========================= */

$("joinBtn").addEventListener(
  "click",
  join
);

$("reg").addEventListener(
  "keydown",
  e => {
    if (e.key === "Enter") {
      join();
    }
  }
);
