
const API_URL = "https://script.google.com/macros/s/AKfycbzTsW0aSYEUl14dfvcXpSP5608ALn3VMh7fw_QtA5L_8ddnnhrPIb5U-mNptvutV7WQrw/exec";

const $ = id => document.getElementById(id);

let room = "";
let team = "";
let playerName = "";
let regNo = "";
let state = null;

let poller = null;
let ticker = null;

let answered = {};
let renderedRound = "";

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

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
  else console.warn("Missing HTML element: #" + id);
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

    state = await api("getState", { room });

    $("connection").textContent = "● Connected";

    render();

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


  /* FINAL RESULT */

  if (state.finished) {

    showFinal();

    return;
  }


  /* WAITING SCREEN */

  if (idx < 0) {

    $("teamTitle").textContent =
      "Waiting for teacher to start the battle…";

    $("tasks").innerHTML =
      "<p class='waiting'>You are in. Please wait for the teacher.</p>";

    return;
  }


  /* TIE BREAKER */

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


  /* RENDER NEW QUESTION / ROUND */

  const currentKey = getRoundKey();

  if (renderedRound !== currentKey) {

    renderedRound = currentKey;

    answered = {};

    renderTasks(r);

  }


  /* ALREADY ANSWERED TIE BREAKER */

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


  /* ROUND COMPLETED */

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

  area.innerHTML = (r.tasks || [])
    .map((t, i) => taskHTML(t, i))
    .join("");


  (r.tasks || []).forEach((t, i) => {

    if (String(t.type).toUpperCase() === "QUIZ") {

      area.querySelectorAll(`[data-q="${i}"]`)
        .forEach(btn => {

          btn.addEventListener("click", () => {

            send(
              i,
              t.taskNo,
              btn.dataset.answer
            );

          });

        });

    } else {

      const btn = area.querySelector(
        `[data-submit="${i}"]`
      );

      if (btn) {

        btn.onclick = () => {

          const input = area.querySelector(
            `[data-input="${i}"]`
          );

          send(
            i,
            t.taskNo,
            input.value
          );

        };

      }

    }

  });

}


/* =========================
   TASK HTML
========================= */

function taskHTML(t, i) {

  const type = String(
    t.type || "TEXT"
  ).toUpperCase();


  if (type === "QUIZ") {

    return `
      <article class="task">

        <small>
          ${state.tieBreaker?.active
            ? "⚡ TIE BREAKER QUESTION"
            : "TASK " + (i + 1)
          }
        </small>

        <h3>${safe(t.prompt)}</h3>

        <div class="answers">

          ${(t.options || []).map((o, n) => `

            <button
              class="answer"
              data-q="${i}"
              data-answer="${safe(o)}">

              ${"ABCD"[n] || n + 1}.
              ${safe(o)}

            </button>

          `).join("")}

        </div>

      </article>
    `;

  }


  const hint =
    type === "SCRAMBLE"
      ? "Unscramble the word"
      : type === "MEMORY"
        ? "Enter what you remember"
        : "Enter your answer";


  return `
    <article class="task">

      <small>
        TASK ${i + 1} • ${safe(type)}
      </small>

      <h3>${safe(t.prompt)}</h3>

      <input
        data-input="${i}"
        placeholder="${hint}">

      <button data-submit="${i}">
        SUBMIT ANSWER
      </button>

    </article>
  `;

}


/* =========================
   SUBMIT ANSWER
========================= */

async function send(i, taskNo, answer) {

  if (answered[i] || state.roundOver) return;

  answer = String(answer ?? "").trim();

  if (!answer) {

    $("feedback").textContent =
      "Please enter an answer.";

    return;
  }


  answered[i] = true;


  const buttons = document.querySelectorAll(
    `[data-q="${i}"], [data-submit="${i}"]`
  );

  buttons.forEach(b => b.disabled = true);


  $("feedback").textContent =
    "Saving your answer…";


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

      const result = await api(
        "submitAnswer",
        payload
      );


      // Successful API response confirms submission.

      $("feedback").textContent =
        result?.message || "Answer submitted successfully.";


      if (
        result?.teamScore !== undefined
      ) {

        $("teamScore").textContent =
          result.teamScore;

      }


      await refresh();

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


  // Do not unlock after an uncertain timeout.

  $("feedback").textContent =
    "Submission status could not be confirmed. " +
    "Please wait and check with your teacher.";

  console.error(
    "Answer submission status:",
    lastError
  );

}


/* =========================
   TIMER
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

  const left = startedAt
    ? Math.max(
        0,
        Math.ceil(
          (startedAt + duration * 1000 - Date.now()) / 1000
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

function showFinal() {
  const s = state.scores || { A: 0, B: 0 };

  setText("finalScoreA", s.A || 0);
  setText("finalScoreB", s.B || 0);

  setText(
    "finalNameA",
    state.teams?.A?.name || "TEAM A"
  );

  setText(
    "finalNameB",
    state.teams?.B?.name || "TEAM B"
  );

  const tbWinner = state.tieBreaker?.winner || "";
  let winnerText = "";

  if (tbWinner === "A") {
    winnerText = "🏆 " + (state.teams?.A?.name || "TEAM A") +
      " WINS THE TIE BREAKER!";
  } else if (tbWinner === "B") {
    winnerText = "🏆 " + (state.teams?.B?.name || "TEAM B") +
      " WINS THE TIE BREAKER!";
  } else if (state.tieBreaker) {
    winnerText = "🤝 MATCH DRAW — TIE BREAKER QUESTIONS EXHAUSTED";
  } else {
    const scoreA = Number(s.A || 0);
    const scoreB = Number(s.B || 0);

    winnerText = scoreA === scoreB
      ? "🤝 IT'S A DRAW!"
      : scoreA > scoreB
        ? "🏆 " + (state.teams?.A?.name || "TEAM A") + " WINS!"
        : "🏆 " + (state.teams?.B?.name || "TEAM B") + " WINS!";
  }

  setText("winner", winnerText);
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
