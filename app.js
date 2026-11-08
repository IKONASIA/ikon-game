/* CONFIG: paste your deployed Google Apps Script Web App URL here */
const API_URL = "https://script.google.com/macros/s/AKfycbzTsW0aSYEUl14dfvcXpSP5608ALn3VMh7fw_QtA5L_8ddnnhrPIb5U-mNptvutV7WQrw/exec";

const $ = id => document.getElementById(id);

let role="", room="", team="", playerName="", regNo="", playerId="", state=null, poller=null, tickTimer=null, answered={}, endingRound=false;

playerId = (crypto.randomUUID ? crypto.randomUUID() : "p"+Date.now()+"_"+Math.random().toString(36).slice(2));

const screens=["home","host","team","result"];

function screen(id){
 screens.forEach(s=>{
  const el=$(s);
  if(el)el.classList.toggle("hidden",s!==id)
 });
}

function api(action,data={}) {
 return new Promise((resolve,reject)=>{
  if(API_URL.startsWith("PASTE_"))
   return reject(new Error("Apps Script URL missing. Follow SETUP-GUIDE.txt."));

  const cb="ikon_cb_"+Math.random().toString(36).slice(2);
  const script=document.createElement("script");

  const timer=setTimeout(()=>{
   cleanup();
   reject(new Error("Server did not respond. Check connection and Apps Script deployment."))
  },12000);

  function cleanup(){
   clearTimeout(timer);
   delete window[cb];
   script.remove()
  }

  window[cb]=(result)=>{
   cleanup();
   if(result&&result.ok)resolve(result.data);
   else reject(new Error(result?.error||"Request failed"))
  };

  script.onerror=()=>{
   cleanup();
   reject(new Error("Could not reach Google Apps Script."))
  };

  const params=new URLSearchParams({
   action,
   callback:cb,
   payload:JSON.stringify(data),
   _:(Date.now())
  });

  script.src=API_URL+"?"+params.toString();
  document.body.appendChild(script);
 });
}

function setConnected(text){
 $("connection").textContent=text
}

function startPolling(){
 if(poller)clearInterval(poller);
 refresh();
 poller=setInterval(refresh,1800);

 if(tickTimer)clearInterval(tickTimer);
 tickTimer=setInterval(renderTimer,250);
}

async function refresh(){
 try{
  state=await api("getState",{room});
  setConnected("● Connected");
  render()
 }catch(e){
  setConnected("● Reconnecting");
  console.warn(e)
 }
}

function render(){
 if(!state)return;

 const scores=state.scores||{A:0,B:0};
 const rounds=state.rounds||[];
 const idx=Number(state.currentRound??-1);

 if(role==="host"){
  $("scoreA").textContent=scores.A||0;
  $("scoreB").textContent=scores.B||0;

  $("teamAInfo").textContent=
   state.teams?.A?.members?.length
   ?`${state.teams.A.name} • ${state.teams.A.members.join(", ")}`
   :"Waiting to join";

  $("teamBInfo").textContent=
   state.teams?.B?.members?.length
   ?`${state.teams.B.name} • ${state.teams.B.members.join(", ")}`
   :"Waiting to join";

  $("roundPills").innerHTML=rounds.map((r,i)=>
   `<span class="roundpill ${i===idx?"active":""} ${(state.completed||[]).includes(i)?"done":""}">R${i+1} ${safe(r.title)}</span>`
  ).join("");

  $("hostRoundTitle").textContent=
   idx>=0?`ROUND ${idx+1}: ${rounds[idx]?.title||""}`:"Waiting to start";

  $("hostInstruction").textContent=
   idx>=0?(rounds[idx]?.instructions||""):"";

  $("startBtn").disabled=idx!==-1;
  $("startBtn").textContent="Start First Round";

  $("nextBtn").disabled=!state.roundOver||idx>=rounds.length-1;

  $("taskPreview").innerHTML=
   idx>=0
   ?(rounds[idx]?.tasks||[]).map((t,i)=>
     `${i+1}. ${safe(t.prompt)} <span class="muted">(${safe(t.type)})</span>`
    ).join("<br>")
   :"Tasks will appear here when a round starts.";

  if(state.finished)showFinal();
 }

 if(role==="team"){
  $("myScore").textContent=scores[team]||0;

  $("teamRoundTitle").textContent=
   idx>=0?`ROUND ${idx+1}: ${rounds[idx]?.title||""}`:"Waiting for teacher…";

  $("teamInstruction").textContent=
   idx>=0?(rounds[idx]?.instructions||""):"";

  $("teamRoomLabel").textContent="ROOM "+room;

  $("myTeamLabel").textContent=
   state.teams?.[team]?.name||"TEAM "+team;

  if(idx>=0 && window.renderedRound!==idx){
   window.renderedRound=idx;
   answered={};
   renderTask()
  }

  if(state.roundOver)
   $("teamFeedback").textContent="Round complete. Wait for the teacher.";

  if(state.finished)showFinal();
 }
}

function safe(v){
 return String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
 }[c]))
}

function renderTask(){
 const r=state.rounds[state.currentRound];
 const area=$("playArea");

 if(!r){
  area.textContent="Waiting…";
  return
 }

 area.innerHTML=(r.tasks||[]).map((t,i)=>taskHTML(t,i)).join("");

 r.tasks.forEach((t,i)=>{
  if(t.type==="QUIZ"){
   area.querySelectorAll(`[data-q="${i}"]`).forEach(b=>
    b.addEventListener("click",()=>sendAnswer(i,b.dataset.answer,b))
   );
  }else{
   const b=area.querySelector(`[data-submit="${i}"]`);

   if(b)b.onclick=()=>{
    const input=area.querySelector(`[data-input="${i}"]`);
    sendAnswer(i,input.value,b)
   }
  }
 });
}

function taskHTML(t,i){
 const type=String(t.type||"TEXT").toUpperCase();

 if(type==="QUIZ"){
  return `<article class="task">
   <div class="eyebrow">TASK ${i+1}</div>
   <div class="taskprompt">${safe(t.prompt)}</div>
   <div class="answers">
    ${(t.options||[]).map((o,n)=>
     `<button class="answer" data-q="${i}" data-answer="${safe(o)}">${"ABCD"[n]||n+1}. ${safe(o)}</button>`
    ).join("")}
   </div>
  </article>`;
 }

 const hint=
  type==="SCRAMBLE"?"Unscramble the word":
  type==="MATH"?"Solve the problem":
  type==="MEMORY"?"Enter the items you remember":
  "Enter your answer";

 return `<article class="task">
  <div class="eyebrow">TASK ${i+1} • ${safe(type)}</div>
  <div class="taskprompt">${safe(t.prompt)}</div>
  <input class="answerinput" data-input="${i}" placeholder="${hint}">
  <button class="gold" data-submit="${i}">Submit Answer</button>
 </article>`;
}

async function sendAnswer(taskNo,answer,button){
 if(answered[taskNo]||state.roundOver)return;

 answered[taskNo]=true;

 document.querySelectorAll(`[data-q="${taskNo}"],[data-submit="${taskNo}"]`)
  .forEach(x=>x.disabled=true);

 try{
  const res=await api("submitAnswer",{
   room,
   team,
   playerName,
   regNo,
   playerId,
   taskNo,
   answer:String(answer)
  });

  $("teamFeedback").textContent=res.message||"Answer submitted.";
  await refresh()

 }catch(e){
  answered[taskNo]=false;

  document.querySelectorAll(`[data-q="${taskNo}"],[data-submit="${taskNo}"]`)
   .forEach(x=>x.disabled=false);

  $("teamFeedback").textContent=e.message
 }
}

function renderTimer(){
 if(!state||state.currentRound<0)return;

 const r=state.rounds[state.currentRound];
 if(!r)return;

 const left=state.roundStartedAt
  ?Math.max(0,Math.ceil((state.roundStartedAt+r.durationSec*1000-Date.now())/1000))
  :r.durationSec;

 const txt=
  String(Math.floor(left/60)).padStart(2,"0")+":"+
  String(left%60).padStart(2,"0");

 const pct=Math.max(0,left/r.durationSec*100);

 if(role==="host"){
  $("hostTimer").textContent=txt;
  $("hostBar").style.width=pct+"%"
 }

 if(role==="team"){
  $("teamTimer").textContent=txt;
  $("teamBar").style.width=pct+"%"
 }

 if(left===0 && role==="host" && !state.roundOver && !endingRound){
  endingRound=true;

  api("endRound",{room})
   .then(refresh)
   .catch(console.warn)
   .finally(()=>endingRound=false)
 }
}

async function showFinal(){
 const s=state.scores||{A:0,B:0};

 $("finalScoreA").textContent=s.A||0;
 $("finalScoreB").textContent=s.B||0;

 $("finalNameA").textContent=state.teams?.A?.name||"TEAM A";
 $("finalNameB").textContent=state.teams?.B?.name||"TEAM B";

 $("winner").textContent=
  s.A===s.B
  ?"🤝 IT'S A DRAW!"
  :s.A>s.B
   ?`🏆 ${state.teams?.A?.name||"TEAM A"} WINS!`
   :`🏆 ${state.teams?.B?.name||"TEAM B"} WINS!`;

 screen("result")
}

if($("hostBtn"))
 $("hostBtn").onclick=async()=>{
  try{
   role="host";
   const d=await api("createRoom",{});
   room=d.room;
   screen("host");
   startPolling()
  }catch(e){
   alert(e.message)
  }
 };

if($("joinBtn"))
 $("joinBtn").onclick=async()=>{
  try{
   regNo=$("regNoInput").value.trim().toUpperCase();

   if(!regNo)throw Error("Enter your registration number.");

   role="team";

   const joined=await api("joinPlayer",{regNo,playerId});

   room=joined.room;
   team=joined.team;
   playerName=joined.playerName;

   $("teamRoomLabel").textContent="IKON BATTLE";

   $("myTeamLabel").textContent=
    (team==="A"?"🔵 TEAM A":"🔴 TEAM B")+" • "+playerName;

   screen("team");
   startPolling()

  }catch(e){
   alert(e.message)
  }
 };

if($("startBtn"))
 $("startBtn").onclick=async()=>{
  try{
   await api("startRound",{
    room,
    roundIndex:state.currentRound<0?0:state.currentRound+1
   });
   await refresh()
  }catch(e){
   alert(e.message)
  }
 };

if($("nextBtn"))
 $("nextBtn").onclick=async()=>{
  try{
   await api("startRound",{
    room,
    roundIndex:state.currentRound+1
   });
   await refresh()
  }catch(e){
   alert(e.message)
  }
 };

if($("endBtn"))
 $("endBtn").onclick=async()=>{
  if(confirm("Finish this battle?")){
   try{
    await api("finishBattle",{room});
    await refresh()
   }catch(e){
    alert(e.message)
   }
  }
 };
