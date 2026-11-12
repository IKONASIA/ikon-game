const API_URL = "https://script.google.com/macros/s/AKfycbzTsW0aSYEUl14dfvcXpSP5608ALn3VMh7fw_QtA5L_8ddnnhrPIb5U-mNptvutV7WQrw/exec";

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

// Round 4 sequential memory challenge
let memoryTaskIndex = 0;
let memoryRevealTimer = null;
let memoryCountdownTimer = null;
let memorySubmitting = false;

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

    const cb = "ikon_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(Error(
        "Server response is delayed. Your answer may already be saved."
      ));
    }, 40000);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }

    window[cb] = r => {
      cleanup();

      if (r?.ok) {
        resolve(r.data);
      } else {
        reject(Error(r?.error || "Request failed"));
      }
    };

    script.onerror = () => {
      cleanup();
      reject(Error("Could not connect to the game server."));
    };

    const q = new URLSearchParams({
      action,
      callback: cb,
      payload: JSON.stringify(data),
      _: Date.now()
    });

    script.src = API_URL + "?" + q.toString();
    document.body.appendChild(script);
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
    memoryTaskIndex = 0;
    memorySubmitting = false;
    clearMemoryTimers();

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

  const isMemoryRound =
    Number(r.roundNo) === 4 ||
    String(r.type || "").toUpperCase() === "MEMORY";

  if (isMemoryRound) {
    memoryTaskIndex = 0;
    renderMemoryTask(r);
    return;
  }

  area.innerHTML = (r.tasks || [])
    .map((t, i) => taskHTML(t, i))
    .join("");

  (r.tasks || []).forEach((t, i) => {
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
    }
  });
}


/* =========================
   MEMORY TIMER CLEANUP
========================= */

function clearMemoryTimers() {
  if (memoryRevealTimer) {
    clearTimeout(memoryRevealTimer);
  }

  if (memoryCountdownTimer) {
    clearInterval(memoryCountdownTimer);
  }

  memoryRevealTimer = null;
  memoryCountdownTimer = null;
}
/* =========================
   ROUND 4 - SEQUENTIAL MEMORY
========================= */

function renderMemoryTask(r) {
  const area = $("tasks");
  const tasks = Array.isArray(r.tasks) ? r.tasks : [];

  clearMemoryTimers();
  memorySubmitting = false;

  if (memoryTaskIndex >= tasks.length) {
    area.innerHTML = `
      <article class="task task-premium memory-task">
        <small>ROUND 4 • COMPLETED</small>
        <h3>All Memory Questions Completed!</h3>
        <p class="task-hint">
          You have answered all the memory questions.
          Please wait for the next round.
        </p>
      </article>`;

    $("feedback").textContent =
      "All memory questions completed. Waiting for the next round…";

    return;
  }

  const task = tasks[memoryTaskIndex];
  const index = memoryTaskIndex;

  answered = {};

  area.innerHTML = taskHTML(task, index);

  const input = area.querySelector(`[data-input="${index}"]`);
  const button = area.querySelector(`[data-submit="${index}"]`);
  const display = area.querySelector(`[data-memory-display="${index}"]`);
  const hiddenNote = area.querySelector(`[data-memory-hidden="${index}"]`);
  const countdown = area.querySelector(".memory-countdown");

  if (input) input.disabled = true;
  if (button) button.disabled = true;
  if (display) display.hidden = false;
  if (hiddenNote) hiddenNote.hidden = true;

  let secondsLeft = 5;

  if (countdown) {
    countdown.textContent = "VISIBLE FOR 5 SECONDS";
  }

  memoryCountdownTimer = setInterval(() => {
    secondsLeft--;

    if (countdown && secondsLeft > 0) {
      countdown.textContent =
        `VISIBLE FOR ${secondsLeft} SECONDS`;
    }
  }, 1000);

  memoryRevealTimer = setTimeout(() => {
    if (memoryCountdownTimer) {
      clearInterval(memoryCountdownTimer);
    }

    memoryCountdownTimer = null;
    memoryRevealTimer = null;

    if (display) display.hidden = true;
    if (hiddenNote) hiddenNote.hidden = false;

    if (input) {
      input.disabled = false;
      input.focus();
    }

    if (button) button.disabled = false;

  }, 5000);

  if (button) {
    button.onclick = () => {
      send(
        index,
        task.taskNo,
        input ? input.value : ""
      );
    };
  }

  if (input) {
    input.addEventListener("keydown", event => {
      if (
        event.key === "Enter" &&
        !input.disabled &&
        button &&
        !button.disabled
      ) {
        button.click();
      }
    });
  }
}


function advanceMemoryTask() {
  const idx = Number(state?.currentRound ?? -1);
  const round = state?.rounds?.[idx];

  if (!round || Number(round.roundNo) !== 4) return;

  memoryTaskIndex++;
  renderMemoryTask(round);
}


/* =========================
   TASK HTML
========================= */

function driveImageUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  const idMatch = raw.match(
    /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*id=)([a-zA-Z0-9_-]+)/
  );

  if (idMatch) {
    return "https://drive.google.com/uc?export=view&id=" +
      encodeURIComponent(idMatch[1]);
  }

  if (/^https:\/\//i.test(raw)) return raw;

  return "";
}


function taskHTML(t, i) {
  const type = String(t.type || "TEXT").toUpperCase();

  const taskLabel = state.tieBreaker?.active
    ? "⚡ TIE BREAKER QUESTION"
    : `TASK ${i + 1}`;

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
                onerror="this.closest('.logo-image-frame').innerHTML='<p class=logo-image-error>Logo image could not be loaded. Please check the Google Drive sharing permission.</p>'"
              >
            </div>
          `
          : `
            <p class="logo-image-error">
              Logo not found. Check the filename in Tasks → Prompt
              and ensure the image is uploaded to the shared logo folder.
            </p>
          `
        }

        <p class="task-hint">
          Look carefully and enter the brand name.
        </p>

        <input
          data-input="${i}"
          autocomplete="off"
          placeholder="Enter brand / company name"
        >

        <button class="primary-submit" data-submit="${i}">
          SUBMIT ANSWER
        </button>
      </article>`;
  }

  if (type === "MEMORY") {
    return `
      <article class="task task-premium memory-task">
        <small>
          TASK ${i + 1} • 5 SECOND MEMORY CHALLENGE
        </small>

        <h3>Memorise the word before it disappears</h3>

        <div class="memory-display" data-memory-display="${i}">
          <span class="memory-caption">REMEMBER THIS</span>
          <strong class="memory-word">${safe(t.prompt)}</strong>
          <span class="memory-countdown">
            VISIBLE FOR 5 SECONDS
          </span>
        </div>

        <p
          class="memory-hidden-note"
          data-memory-hidden="${i}"
          hidden
        >
          Time's up! The word is hidden. Type what you remember.
        </p>

        <input
          data-input="${i}"
          autocomplete="off"
          placeholder="Type the word you remember"
          disabled
        >

        <button
          class="primary-submit"
          data-submit="${i}"
          disabled
        >
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

  if (answered[i] || state.roundOver || memorySubmitting) return;

  answer = String(answer ?? "").trim();

  if (!answer) {
    $("feedback").textContent = "Please enter an answer.";
    return;
  }

  const idx = Number(state.currentRound ?? -1);
  const currentRound = state.rounds?.[idx];
  const isMemoryRound =
    currentRound && Number(currentRound.roundNo) === 4;

  answered[i] = true;

  if (isMemoryRound) {
    memorySubmitting = true;
  }

  const buttons = document.querySelectorAll(
    `[data-q="${i}"], [data-submit="${i}"]`
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

      if (isMemoryRound) {
        // Do not wait for the next 5-second polling cycle.
        // Move to the next memory question after successful submission.
        clearMemoryTimers();
        memorySubmitting = false;
        advanceMemoryTask();
      } else {
        await refresh();
      }

      return;

    } catch (e) {
      lastError = e;

      if (attempt < 3) {
        $("feedback").textContent =
          "Connection delayed. Checking saved answer… Attempt " +
          (attempt + 1) + " of 3.";

        await new Promise(resolve =>
          setTimeout(resolve, 1500)
        );
      }
    }
  }

  if (isMemoryRound) {
    memorySubmitting = false;
    answered[i] = false;

    document.querySelectorAll(
      `[data-submit="${i}"], [data-input="${i}"]`
    ).forEach(el => {
      el.disabled = false;
    });
  }

  $("feedback").textContent =
    "Submission status could not be confirmed. " +
    "Please wait and check with your teacher.";

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
