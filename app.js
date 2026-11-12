const API_URL = "https://script.google.com/macros/s/AKfycbzTsW0aSYEUl14dfvcXpSP5608ALn3VMh7fw_QtA5L_8ddnnhrPIb5U-mNptvutV7WQrw/exec";
const $ = id => document.getElementById(id);
let room="",team="",playerName="",regNo="",state=null,poller=null,ticker=null,answered={},renderedRound=-99;
const playerId = (crypto.randomUUID ? crypto.randomUUID() : "p"+Date.now()+"_"+Math.random().toString(36).slice(2));
function screen(id){["home","team","result"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function api(action,data={}){
 return new Promise((resolve,reject)=>{
  const cb="ikon_cb_"+Math.random().toString(36).slice(2),script=document.createElement("script");
  const timer=setTimeout(()=>{cleanup();reject(Error("Server did not respond. Please retry."));},15000);
  function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}
  window[cb]=r=>{cleanup();r?.ok?resolve(r.data):reject(Error(r?.error||"Request failed"));};
  script.onerror=()=>{cleanup();reject(Error("Could not connect to the game server."));};
  const q=new URLSearchParams({action,callback:cb,payload:JSON.stringify(data),_ :Date.now()});
  script.src=API_URL+"?"+q.toString();document.body.appendChild(script);
 });
}
async function join(){
 try{
  regNo=$("reg").value.trim().toUpperCase();
  if(!regNo)throw Error("Please enter your Registration Number.");
  $("joinBtn").disabled=true;$("loginMessage").textContent="Joining battle…";
  const d=await api("joinPlayer",{regNo,playerId});
  room=d.room;team=d.team;playerName=d.playerName;
  $("teamName").textContent=(team==="A"?"🔵 TEAM A":"🔴 TEAM B")+" • "+playerName;
  $("teamTitle").textContent="You joined successfully. Waiting for teacher to start…";
  screen("team");startPolling();
 }catch(e){$("loginMessage").textContent=e.message;$("joinBtn").disabled=false;}
}
function startPolling(){if(poller)clearInterval(poller);refresh();poller=setInterval(refresh,1800);if(ticker)clearInterval(ticker);ticker=setInterval(renderTimer,250);}
async function refresh(){
 try{state=await api("getState",{room});$("connection").textContent="● Connected";render();}
 catch(e){$("connection").textContent="● Reconnecting";console.warn(e);}
}
function render(){
 if(!state)return;
 const idx=Number(state.currentRound??-1),rounds=state.rounds||[],scores=state.scores||{A:0,B:0};
 $("teamScore").textContent=scores[team]||0;
 if(state.finished){showFinal();return;}
 if(idx<0){$("teamTitle").textContent="Waiting for teacher to start the battle…";$("tasks").innerHTML="<p class='waiting'>You are in. Please wait for the teacher.</p>";return;}
 const r=rounds[idx];$("teamTitle").textContent=`ROUND ${idx+1}: ${r.title}`;
 if(renderedRound!==idx){renderedRound=idx;answered={};renderTasks(r);}
 if(state.roundOver)$("feedback").textContent="Round complete. Waiting for next round…";
}
function renderTasks(r){
 const area=$("tasks");area.innerHTML=(r.tasks||[]).map((t,i)=>taskHTML(t,i)).join("");
 (r.tasks||[]).forEach((t,i)=>{
  if(String(t.type).toUpperCase()==="QUIZ"){
   area.querySelectorAll(`[data-q="${i}"]`).forEach(btn=>btn.addEventListener("click",()=>send(i,t.taskNo,btn.dataset.answer)));
  }else{
   const btn=area.querySelector(`[data-submit="${i}"]`);
   if(btn)btn.onclick=()=>send(i,t.taskNo,area.querySelector(`[data-input="${i}"]`).value);
  }
 });
}
function taskHTML(t,i){
 const type=String(t.type||"TEXT").toUpperCase();
 if(type==="QUIZ")return `<article class="task"><small>TASK ${i+1}</small><h3>${safe(t.prompt)}</h3><div class="answers">${(t.options||[]).map((o,n)=>`<button class="answer" data-q="${i}" data-answer="${safe(o)}">${"ABCD"[n]||n+1}. ${safe(o)}</button>`).join("")}</div></article>`;
 const hint=type==="SCRAMBLE"?"Unscramble the word":type==="MEMORY"?"Enter what you remember":"Enter your answer";
 return `<article class="task"><small>TASK ${i+1} • ${safe(type)}</small><h3>${safe(t.prompt)}</h3><input data-input="${i}" placeholder="${hint}"><button data-submit="${i}">SUBMIT ANSWER</button></article>`;
}
async function send(i,taskNo,answer){
 if(answered[i]||state.roundOver)return;answered[i]=true;
 document.querySelectorAll(`[data-q="${i}"],[data-submit="${i}"]`).forEach(x=>x.disabled=true);
 try{const r=await api("submitAnswer",{room,team,playerName,regNo,playerId,taskNo,answer:String(answer)});$("feedback").textContent=r.message||"Answer submitted.";await refresh();}
 catch(e){answered[i]=false;document.querySelectorAll(`[data-q="${i}"],[data-submit="${i}"]`).forEach(x=>x.disabled=false);$("feedback").textContent=e.message;}
}
function renderTimer(){
 if(!state||Number(state.currentRound)<0||state.finished)return;
 const r=state.rounds[state.currentRound];if(!r)return;
 const left=state.roundStartedAt?Math.max(0,Math.ceil((state.roundStartedAt+r.durationSec*1000-Date.now())/1000)):r.durationSec;
 $("teamTimer").textContent=String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
 $("teamProgress").style.width=Math.max(0,left/r.durationSec*100)+"%";
}
function showFinal(){
 const s=state.scores||{A:0,B:0};$("finalA").textContent=s.A||0;$("finalB").textContent=s.B||0;
 $("winner").textContent=s.A===s.B?"IT'S A DRAW!":s.A>s.B?"🏆 TEAM A WINS!":"🏆 TEAM B WINS!";
 screen("result");
}
$("joinBtn").addEventListener("click",join);
$("reg").addEventListener("keydown",e=>{if(e.key==="Enter")join();});
