import OBR from "@owlbear-rodeo/sdk";
import {COMMAND,STATE,VERSION,initialState,defaultSettings,normalizedSettings,durationMs,type PauseEffect,type Command,type GroupView,type State,type StatePacket,type Settings} from "./shared";
import {effectCycleMs} from "./effects";
import "./style.css";

const paths={add:"M12 5v14M5 12h14",line:"M5 18V9a4 4 0 0 1 4-4h10m-4-4 4 4-4 4M5 18h.01",loop:"M5 7h13l-4-4m4 4-4 4M19 17H6l4 4m-4-4 4-4",flip:"M12 3v18M8 7l-5 5 5 5V7Zm8 0 5 5-5 5V7Z",play:"m8 4 12 8-12 8V4Z",stop:"M6 6h12v12H6Z",more:"M5 12h.01M12 12h.01M19 12h.01",pin:"M12 21S5 13 5 9a7 7 0 1 1 14 0c0 4-7 12-7 12ZM12 6v6M9 9h6",eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",undo:"M9 5 3 11l6 6M3 11h10a7 7 0 0 1 7 7",check:"m5 12 4 4L20 5",close:"m6 6 12 12M6 18 18 6",help:"M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4h.01"};
const icon=(name:keyof typeof paths)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
document.querySelector("#app")!.innerHTML=`
<header class="topbar"><h1>Token Move <span>LINE · FX</span></h1><div class="global-controls"><button id="start-all" class="icon-button" title="เริ่มทุกกลุ่ม" aria-label="เริ่มทุกกลุ่ม">${icon("play")}</button><button id="stop-all" class="icon-button" title="หยุดทุกกลุ่ม" aria-label="หยุดทุกกลุ่ม">${icon("stop")}</button></div></header>
<div id="demo-banner" hidden>ตัวอย่างหน้าตา · ใช้งานจริงผ่าน Owlbear</div>
<div class="toolbar"><button id="create" class="add-button">${icon("add")}<span>เพิ่มกลุ่มจาก Token ที่เลือก</span></button><button id="help" class="icon-button help-button" title="วิธีใช้งาน" aria-label="วิธีใช้งาน" aria-expanded="false">${icon("help")}</button></div>
<section id="help-panel" class="help-panel" hidden><strong>เลือก Token → เพิ่มกลุ่ม → เลือกการเคลื่อนที่ → กดเริ่ม</strong><p>เดิน LINE: คลิกช่องเริ่มและช่องถัดไป คลิกช่องล่าสุดซ้ำหรือ Enter เพื่อบันทึก</p><p>เอฟเฟกต์อิสระ: เลือกสั่นหรือดุ๊กดิ๊กแล้วกด ▶ ได้เลย ไม่ต้องวาด LINE และยังลากย้าย/หมุนด้วยเครื่องมืออื่นได้<br>เลือกวนซ้ำ หรือครั้งเดียวเพื่อหยุดและกลับเป็นปุ่ม Play อัตโนมัติ<br>สั่นขยับตำแหน่งเล็กน้อย · ดุ๊กดิ๊กหมุนซ้าย–ขวารอบองศาเดิม ใช้พร้อม LINE ได้</p><p>⋯ ตั้งจุดพักระหว่างทาง หรือปรับระยะสั่น องศาดุ๊กดิ๊ก และจังหวะ · เมื่อหยุดจะคืนองศาเดิม<br>Backspace ย้อนจุด · Esc ยกเลิก · หยุดกลุ่มก่อนแก้ค่า</p></section>
<div class="list-heading"><span id="group-count">0 กลุ่ม</span><span id="running-count"></span></div>
<div id="column-headings" class="column-headings" aria-hidden="true"><span>LINE</span><span>ช่อง/วิ</span><span>วนกลับ</span><span>Flip</span><span>เดิน</span><span>ตั้งค่า</span></div>
<section id="group-list" aria-label="กลุ่มการเดิน"></section>
<section id="empty" class="empty"><span aria-hidden="true">⌁</span><h2>เพิ่มกลุ่มแรก</h2><p>เลือก Token บนแผนที่ แล้วกดเพิ่มกลุ่ม<br>เลือกเดิน LINE หรือสั่น/ดุ๊กดิ๊กเอฟเฟกต์อิสระได้เลย</p></section>
<section id="picking" class="picking" hidden><div class="picking-title"><span class="pulse"></span><strong id="picking-title"></strong></div><p id="picking-message"></p><div class="pick-buttons"><button id="finish-line" class="primary">${icon("check")}บันทึก LINE</button><button id="undo-line" class="secondary" title="ย้อนจุดล่าสุด" aria-label="ย้อนจุดล่าสุด">${icon("undo")}</button><button id="cancel-pick" class="secondary">ยกเลิก</button></div></section>
<p id="error" class="error" role="alert" hidden></p><footer><span id="status" role="status" aria-live="polite"></span><span id="connection"></span></footer>`;

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(id:string)=>el<HTMLButtonElement>(id);
type Draft={name:string;settings:Settings};
type Action="line"|"loop"|"flip"|"play"|"more"|"pickStart"|"showRoute"|"capture"|"reset"|"remove";
type Row={element:HTMLElement;name:HTMLElement;meta:HTMLElement;phase:HTMLElement;bar:HTMLElement;warning:HTMLElement;details:HTMLElement;points:HTMLElement;pointToggle:HTMLDetailsElement;fields:Record<string,HTMLInputElement|HTMLSelectElement>;buttons:Record<Action,HTMLButtonElement>;pointsKey:string};
let state:State={...initialState},online=false,expandedId:string|undefined;
const drafts=new Map<string,Draft>(),rows=new Map<string,Row>();
let pending:{id:string;command:Command;timer:ReturnType<typeof setTimeout>;resolve:(ok:boolean)=>void}|undefined;
type Job={id?:string;kind:string;run:()=>Promise<void>};
let jobs:Job[]=[],activeJob:Job|undefined,working=false,localError="";
const group=(id:string)=>state.groups.find(g=>g.id===id);
const editing=(g:GroupView)=>drafts.get(g.id)??{name:g.name,settings:normalizedSettings(g.settings)};
function changed(id:string,patch:Partial<Draft>,settingsPatch:Partial<Settings>={}){
  const g=group(id);if(!g)return;const old=editing(g);
  drafts.set(id,{name:patch.name??old.name,settings:{...old.settings,...settingsPatch}});render();
}
function enqueue(job:Job,urgent=false){
  if(urgent){if(job.kind==="stopAll")jobs=[];else jobs=jobs.filter(j=>!(j.id===job.id&&j.kind==="start"));jobs.unshift(job);}else jobs.push(job);
  void pump();
}
async function pump(){
  if(working)return;working=true;
  try{while(jobs.length){activeJob=jobs.shift()!;render();try{await activeJob.run();}catch(error){localError=error instanceof Error?error.message:"ทำรายการไม่สำเร็จ";}activeJob=undefined;render();}}
  finally{working=false;activeJob=undefined;render();}
}
function finishRequest(ok:boolean){if(!pending)return;clearTimeout(pending.timer);const resolve=pending.resolve;pending=undefined;resolve(ok);}
async function send(command:Command):Promise<boolean>{
  if(pending||!online)return false;localError="";
  const request=crypto.randomUUID();const done=new Promise<boolean>(resolve=>{
    const timer=setTimeout(()=>{if(pending?.id!==request)return;localError="ไม่ได้รับคำตอบ กรุณาลองใหม่หรือรีโหลดห้อง";finishRequest(false);render();},10000);
    pending={id:request,command,timer,resolve};
  });render();
  // Command completion comes from the state reply. A slow broadcast acknowledgement
  // must not hold the next operation after its actual reply has already arrived.
  void OBR.broadcast.sendMessage(COMMAND,{request,command},{destination:"LOCAL"}).catch(()=>{
    if(pending?.id!==request)return;localError="ส่งคำสั่งไม่สำเร็จ กรุณาลองใหม่";finishRequest(false);render();
  });return done;
}
async function saveDraft(id:string){
  const draft=drafts.get(id);if(!draft)return true;
  const row=rows.get(id);if(row&&Object.values(row.fields).some(field=>!field.disabled&&!field.reportValidity()))return false;
  if(row&&Array.from(row.points.querySelectorAll<HTMLInputElement>("input")).some(f=>!f.disabled&&!f.reportValidity()))return false;
  const ok=await send({type:"update",id,name:draft.name.trim()||"กลุ่มไม่มีชื่อ",settings:{...draft.settings}});
  if(ok&&drafts.get(id)===draft)drafts.delete(id);render();return ok;
}
function saveLater(id:string){enqueue({id,kind:"update",run:async()=>{await saveDraft(id);}});}
function action(id:string,type:Command["type"]){
  const urgent=type==="stop";
  enqueue({id,kind:type,run:async()=>{
    if(!group(id))return;
    if(type==="remove")drafts.delete(id);else if(type!=="stop"&&!await saveDraft(id))return;
    await send({type,id} as Command);
  }},urgent);
}
function toggle(id:string,key:"mode"|"flip"){
  const g=group(id);if(!g||g.running)return;const s=editing(g).settings;
  changed(id,{},key==="mode"?{mode:s.mode==="patrol"?"once":"patrol"}:{flip:!s.flip});saveLater(id);
}
function showDetails(id:string){
  expandedId=expandedId===id?undefined:id;render();
  if(expandedId&&state.selectedId!==id)enqueue({id,kind:"select",run:async()=>{await send({type:"select",id});}});
}
function routeVisibility(id:string){enqueue({id,kind:"showRoute",run:async()=>{
  const wasVisible=state.selectedId===id&&state.routeVisible!==false;
  if(state.selectedId!==id&&!await send({type:"select",id}))return;
  if(wasVisible||state.routeVisible===false)await send({type:"showRoute",id});
}});}
function makeRow(id:string):Row{
  const element=document.createElement("article");element.className="group-row";element.dataset.group=id;
  element.innerHTML=`<div class="row-heading"><button class="row-name" data-action="more"><span class="dot"></span><strong></strong></button><small class="row-meta"></small><span class="row-phase"></span></div>
  <div class="effect-controls"><label><span class="sr-only">การเคลื่อนที่</span><select data-field="movement"><option value="line">เดิน LINE</option><option value="stationary">เอฟเฟกต์อิสระ</option></select></label><label><span class="sr-only">เอฟเฟกต์</span><select data-field="effect"><option value="none">ปกติ · ไม่ใส่เอฟเฟกต์</option><option value="shake">สั่น</option><option value="wiggle">ดุ๊กดิ๊ก · หมุนซ้าย–ขวา</option></select></label></div>
  <label class="repeat-control" hidden>การเล่นเอฟเฟกต์<select data-field="repeat"><option value="patrol">วนซ้ำ (Loop)</option><option value="once">ครั้งเดียว · จบแล้วกลับเป็น Play</option></select><small class="effect-cycle"></small></label>
  <div class="row-controls"><button data-action="line" class="round route-button">${icon("line")}</button><label class="speed-wrap"><span class="sr-only">ความเร็ว</span><input data-field="speed" class="round speed" type="number" min="0.1" max="20" step="0.1" inputmode="decimal"></label><button data-action="loop" class="round" aria-pressed="true">${icon("loop")}</button><button data-action="flip" class="round" aria-pressed="true">${icon("flip")}</button><button data-action="play" class="round play-button">${icon("play")}</button><button data-action="more" class="round more-button" aria-expanded="false">${icon("more")}</button></div>
  <div class="row-progress" aria-hidden="true"><span></span></div><p class="row-warning" hidden></p>
  <section class="row-details" hidden><label class="detail-name">ชื่อกลุ่ม<input data-field="name" maxlength="80"></label><div class="detail-actions"><button data-action="pickStart" class="secondary">${icon("pin")}เลือกจุดเริ่ม</button><button data-action="showRoute" class="secondary">${icon("eye")}<span>แสดงเส้นทาง</span></button></div>
  <label class="detail-toggle"><span>ค่อย ๆ ออกตัวและหยุด</span><input data-field="smooth" type="checkbox"></label><label class="detail-facing">ภาพต้นฉบับหัน<select data-field="facing"><option value="right">ขวา →</option><option value="left">ซ้าย ←</option></select></label>
  <div class="effect-options"><label data-option="shakeDistance">ระยะสั่น ± (ช่อง)<input data-field="shakeDistance" type="number" min="0.005" max="0.25" step="0.005"></label><label data-option="wiggleAngle">หมุนซ้าย–ขวา ± (องศา)<input data-field="wiggleAngle" type="number" min="1" max="30" step="1"></label><label data-option="effectSpeed">จังหวะเอฟเฟกต์ (เท่า)<input data-field="effectSpeed" type="number" min="0.25" max="3" step="0.25"></label><p>กดหยุดเพื่อคืนท่าเดิม • ระหว่างเดินจะหยุดที่ตำแหน่งล่าสุดบน LINE</p></div>
  <details class="point-details"><summary>เวลาเดิน · จุดพัก · เอฟเฟกต์รายจุด</summary><p>เวลาเดินคำนวณจากระยะทาง ÷ ความเร็ว ไม่รวมเวลาพัก<br>ตั้งเวลาพักและเอฟเฟกต์แยกแต่ละจุด · 0 = ผ่านเลย<br>วนไปกลับจะพักทั้งสองขา · วาด LINE ใหม่จะล้างเวลาพัก</p><ol></ol></details><div class="member-actions"><button data-action="capture" class="quiet">เปลี่ยน Token</button><button data-action="reset" class="quiet">กลับจุดเริ่ม</button><button data-action="remove" class="quiet danger">ลบกลุ่ม</button></div></section>`;
  const q=<T extends Element=HTMLElement>(selector:string)=>element.querySelector(selector) as T;
  const buttons={} as Record<Action,HTMLButtonElement>;
  for(const b of Array.from(element.querySelectorAll<HTMLButtonElement>("[data-action]"))){
    const key=b.dataset.action as Action;if(!buttons[key])buttons[key]=b;
    b.onclick=()=>{
      if(key==="more")showDetails(id);else if(key==="line")action(id,"pickLine");else if(key==="loop")toggle(id,"mode");else if(key==="flip")toggle(id,"flip");else if(key==="play")action(id,group(id)?.running?"stop":"start");else if(key==="showRoute")routeVisibility(id);else action(id,key);
    };
  }
  // There are two entry points for details (name and ⋯); retain the circular button.
  buttons.more=q<HTMLButtonElement>(".more-button");
  const fields:Row["fields"]={};
  for(const field of Array.from(element.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-field]"))){
    const key=field.dataset.field!;fields[key]=field;
    field.addEventListener("input",()=>{
      if(key==="name")changed(id,{name:field.value});
      else if(key==="movement"){const fixed=field.value==="stationary",s=normalizedSettings(editing(group(id)!).settings);changed(id,{},{movement:fixed?"stationary":"line",...(fixed&&s.effect==="none"?{effect:"wiggle" as const}:{})});}
      else if(key==="repeat")changed(id,{},{mode:field.value==="once"?"once":"patrol"});
      else if(key==="effect")changed(id,{},{effect:field.value==="shake"?"shake":field.value==="wiggle"?"wiggle":"none"});
      else if(["speed","shakeDistance","wiggleAngle","effectSpeed"].includes(key))changed(id,{},{[key]:(field as HTMLInputElement).valueAsNumber});
      else if(key==="smooth")changed(id,{},{smooth:(field as HTMLInputElement).checked});else changed(id,{},{facing:field.value==="left"?"left":"right"});
    });
    field.addEventListener("change",()=>saveLater(id));field.addEventListener("keydown",event=>{if((event as KeyboardEvent).key==="Enter"){event.preventDefault();saveLater(id);}});
  }
  return {element,name:q(".row-name strong"),meta:q(".row-meta"),phase:q(".row-phase"),bar:q(".row-progress span"),warning:q(".row-warning"),details:q(".row-details"),points:q(".point-details ol"),pointToggle:q<HTMLDetailsElement>(".point-details"),fields,buttons,pointsKey:""};
}
function text(node:Element,value:string){if(node.textContent!==value)node.textContent=value;}
function label(button:HTMLButtonElement,value:string){button.title=value;button.setAttribute("aria-label",value);}
function render(){
  const unavailable=!online||!state.gm||!state.ready;
  const selecting=activeJob?.kind==="pickLine"||activeJob?.kind==="pickStart";
  const picking=!!state.pickingId||selecting;
  const list=el("group-list"),ids=new Set(state.groups.map(g=>g.id));
  for(const [id,row]of rows)if(!ids.has(id)){row.element.remove();rows.delete(id);drafts.delete(id);}
  for(const g of state.groups){
    let row=rows.get(g.id);if(!row){row=makeRow(g.id);rows.set(g.id,row);list.append(row.element);}
    const d=editing(g),s=normalizedSettings(d.settings),fixed=s.movement==="stationary",hasRoute=!!g.route,ready=fixed?s.effect!=="none":hasRoute,expanded=expandedId===g.id,locked=unavailable||g.running||picking;
    const busy=pending&&"id"in pending.command&&pending.command.id===g.id;
    row.element.classList.toggle("selected",state.selectedId===g.id);row.element.classList.toggle("running",g.running);row.element.classList.toggle("busy",!!busy);row.element.classList.toggle("dirty",drafts.has(g.id));
    row.element.setAttribute("aria-busy",String(!!busy));
    text(row.name,d.name||g.name);text(row.meta,`${g.count} Token · ${fixed?"เอฟเฟกต์อิสระ":g.route?`${g.route.length} จุด`:"ยังไม่มี LINE"}`);
    text(row.phase,g.running?(g.pauseRemaining?`จุด ${(g.waypointIndex??0)+1} · พัก ${Math.ceil(g.pauseRemaining)} วิ`:fixed?(s.effect==="shake"?"กำลังสั่น":"ดุ๊กดิ๊ก"):`${g.direction==="return"?(g.waypointIndex??0)+2:(g.waypointIndex??1)} → ${(g.waypointIndex??1)+1} · ${Math.round(g.progress*100)}%`):ready?(!fixed&&g.progress>0&&g.progress<1?"พัก":g.settings.mode==="once"&&g.progress>=1?"จบรอบ":"พร้อม"):"วาด LINE");
    row.bar.style.width=`${g.running?Math.max(0,Math.min(100,g.progress*100)):g.progress===1?100:0}%`;
    row.details.hidden=!expanded;row.buttons.more.setAttribute("aria-expanded",String(expanded));
    row.element.querySelector(".row-name")!.setAttribute("aria-expanded",String(expanded));
    row.buttons.line.disabled=locked||fixed||!g.count;row.buttons.line.classList.toggle("needs-line",!fixed&&!hasRoute);
    label(row.buttons.line,`${hasRoute?"วาด LINE ใหม่":"สร้าง LINE"} — ${d.name}`);
    row.fields.speed.disabled=locked||fixed;row.fields.speed.setAttribute("aria-label",`ความเร็ว — ${d.name}`);row.fields.speed.title="ช่องต่อวินาที · ปรับแล้วบันทึกอัตโนมัติ";
    if(document.activeElement!==row.fields.speed&&row.fields.speed.value!==String(d.settings.speed))row.fields.speed.value=String(d.settings.speed);
    for(const key of ["loop","flip"] as const){row.buttons[key].disabled=locked||(fixed&&key==="flip");row.buttons[key].setAttribute("aria-pressed",String(key==="loop"?d.settings.mode==="patrol":d.settings.flip));}
    label(row.buttons.loop,`${fixed?(d.settings.mode==="patrol"?"วนซ้ำ (Loop)":"ครั้งเดียว · จบแล้วกลับเป็น Play"):`วนไปกลับ${d.settings.mode==="patrol"?" เปิด":" ปิด"}`} — ${d.name}`);label(row.buttons.flip,`Flip ตามทิศเดิน${d.settings.flip?" เปิด":" ปิด"} — ${d.name}`);
    row.buttons.play.disabled=unavailable||picking||!ready||!g.count;
    row.buttons.play.classList.toggle("is-stop",g.running);
    const playKind=g.running?"stop":"play";if(row.buttons.play.dataset.icon!==playKind){row.buttons.play.dataset.icon=playKind;row.buttons.play.innerHTML=icon(playKind);}
    label(row.buttons.play,`${g.running?"หยุด":fixed?"เริ่มเอฟเฟกต์":g.progress>0&&g.progress<1?"เดินต่อ":"เริ่มเดิน"} — ${d.name}`);
    row.buttons.more.disabled=unavailable||picking;label(row.buttons.more,`ตั้งค่าเพิ่มเติม — ${d.name}`);
    row.fields.name.disabled=locked;row.fields.name.setAttribute("aria-label",`ชื่อกลุ่ม — ${g.name}`);if(document.activeElement!==row.fields.name)row.fields.name.value=d.name;
    (row.fields.smooth as HTMLInputElement).checked=d.settings.smooth;row.fields.smooth.disabled=locked||fixed;row.fields.smooth.setAttribute("aria-label",`ค่อย ๆ ออกตัว — ${d.name}`);
    row.fields.facing.value=d.settings.facing;row.fields.facing.disabled=locked||fixed||!d.settings.flip;row.fields.facing.setAttribute("aria-label",`ภาพต้นฉบับหัน — ${d.name}`);
    for(const key of ["movement","effect","shakeDistance","wiggleAngle","effectSpeed"] as const){
      const field=row.fields[key];field.disabled=locked;field.setAttribute("aria-label",`${{movement:"การเคลื่อนที่",effect:"เอฟเฟกต์",shakeDistance:"ระยะสั่น (ช่อง)",wiggleAngle:"องศาดุ๊กดิ๊ก",effectSpeed:"จังหวะเอฟเฟกต์"}[key]} — ${d.name}`);
      if(document.activeElement!==field)field.value=String(s[key]);
    }
    (row.fields.effect as HTMLSelectElement).options[0].disabled=fixed;
    row.element.querySelector<HTMLElement>(".repeat-control")!.hidden=!fixed;
    row.fields.repeat.disabled=locked;row.fields.repeat.value=s.mode;row.fields.repeat.setAttribute("aria-label",`การเล่นเอฟเฟกต์ — ${d.name}`);
    text(row.element.querySelector(".effect-cycle")!,Number.isFinite(s.effectSpeed)&&s.effectSpeed>=.25&&s.effectSpeed<=3?`หนึ่งรอบ ≈ ${(effectCycleMs(s)/1000).toLocaleString("th-TH",{maximumFractionDigits:2})} วินาที · ปรับได้ที่จังหวะเอฟเฟกต์ใน ⋯`:"ตรวจจังหวะเอฟเฟกต์ 0.25–3 เท่า");
    for(const key of ["shakeDistance","wiggleAngle","effectSpeed"] as const){const active=key==="effectSpeed"?(s.effect!=="none"||s.waypointEffects?.some(e=>e==="wiggle"||e==="shake")===true):key==="shakeDistance"?(s.effect==="shake"||s.waypointEffects?.includes("shake")===true):(s.effect==="wiggle"||s.waypointEffects?.includes("wiggle")===true);row.element.querySelector<HTMLElement>(`[data-option="${key}"]`)!.hidden=!active;row.fields[key].disabled=locked||!active;}
    row.element.querySelector<HTMLElement>(".effect-options")!.hidden=s.effect==="none"&&!s.waypointEffects?.some(e=>e==="wiggle"||e==="shake");
    row.buttons.pickStart.disabled=locked||fixed||!hasRoute;row.buttons.capture.disabled=locked;
    row.buttons.reset.disabled=unavailable||picking||(!fixed&&!hasRoute)||!g.count;text(row.buttons.reset,fixed?"ปิดเอฟเฟกต์":"กลับจุดเริ่ม");row.buttons.remove.disabled=unavailable||picking;
    row.buttons.showRoute.disabled=unavailable||picking||fixed||!hasRoute;
    const visible=state.selectedId===g.id&&state.routeVisible!==false;
    text(row.buttons.showRoute.querySelector("span")!,visible?"ซ่อนเส้นทาง":"แสดงเส้นทาง");row.buttons.showRoute.setAttribute("aria-pressed",String(visible));
    const runtimeError=!g.running&&g.message.startsWith("หยุดเพราะเกิดข้อผิดพลาด");
    row.warning.hidden=!runtimeError&&(ready||!!state.pickingId); text(row.warning,runtimeError?g.message:!g.count?"เลือก Token แล้วกดเปลี่ยน Token ใน ⋯":fixed?"เลือกเอฟเฟกต์สั่นหรือดุ๊กดิ๊ก":"กดปุ่ม LINE เพื่อเลือกช่องเริ่มและทางเดิน");
    row.pointToggle.hidden=fixed||!hasRoute;
    if(expanded){const key=JSON.stringify(g.route);if(key!==row.pointsKey){row.pointsKey=key;row.points.replaceChildren(...(g.route??[]).map((p,i)=>{
      const id=g.id;const li=document.createElement("li"),label=document.createElement("label"),name=document.createElement("span"),input=document.createElement("input"),unit=document.createElement("span");
      name.textContent=`จุด ${i+1}${i===0?" · เริ่ม (พักตอนกลับ)":i===g.route!.length-1?" · สุดท้าย":""}`;name.title=`พิกัด ${Math.round(p.x)}, ${Math.round(p.y)}`;
      input.type="number";input.min="0";input.max="3600";input.step="0.1";input.inputMode="decimal";input.dataset.pause=String(i);unit.textContent="วินาที";
      const timing=document.createElement("small");timing.className="leg-time";timing.dataset.leg=String(i);
      const effect=document.createElement("select");effect.dataset.pauseEffect=String(i);
      for(const [value,title]of [["inherit","ตามเอฟเฟกต์กลุ่ม"],["none","หยุดนิ่ง"],["wiggle","ดุ๊กดิ๊กตอนพัก"],["shake","สั่นตอนพัก"]]){const o=document.createElement("option");o.value=value;o.textContent=title;effect.append(o);}
      effect.addEventListener("change",()=>{const g=group(id);if(!g||g.running)return;const effects=[...(editing(g).settings.waypointEffects??[])];while(effects.length<(g.route?.length??0))effects.push("inherit");effects[i]=effect.value as PauseEffect;changed(id,{},{waypointEffects:effects});saveLater(id);});
      input.addEventListener("input",()=>{const g=group(id);if(!g||g.running)return;const pauses=[...(editing(g).settings.waypointPauses??[])];while(pauses.length<(g.route?.length??0))pauses.push(0);pauses[i]=input.valueAsNumber;changed(id,{},{waypointPauses:pauses});});
      input.addEventListener("change",()=>{if(input.reportValidity())saveLater(id);});input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();if(input.reportValidity())saveLater(id);}});
      label.append(name,input,unit);li.append(timing,label,effect);return li;
    }));}
    for(const timing of Array.from(row.points.querySelectorAll<HTMLElement>("[data-leg]"))){const i=Number(timing.dataset.leg);text(timing,i===0?"เริ่มที่จุด 1 · ออกเดินทันที":state.gridDpi&&g.route&&Number.isFinite(s.speed)&&s.speed>=.1&&s.speed<=20?`${i} → ${i+1} · เดิน ${(durationMs(g.route[i-1],g.route[i],state.gridDpi,s.speed)/1000).toLocaleString("th-TH",{maximumFractionDigits:2})} วินาที`:"ตรวจความเร็ว 0.1–20 ช่อง/วิ หรือรออ่านกริด");}
    for(const effect of Array.from(row.points.querySelectorAll<HTMLSelectElement>("select[data-pause-effect]"))){const i=Number(effect.dataset.pauseEffect);effect.disabled=locked;effect.setAttribute("aria-label",`เอฟเฟกต์ตอนพักจุด ${i+1} — ${d.name}`);effect.value=s.waypointEffects?.[i]??"inherit";}
    for(const input of Array.from(row.points.querySelectorAll<HTMLInputElement>("input[data-pause]"))){input.disabled=locked;input.setAttribute("aria-label",`เวลาพักจุด ${Number(input.dataset.pause)+1} (วินาที) — ${d.name}`);if(document.activeElement!==input)input.value=String(s.waypointPauses?.[Number(input.dataset.pause)]??0);}}

  }
  const running=state.groups.filter(g=>g.running).length;
  text(el("group-count"),`${state.groups.length} กลุ่ม`);text(el("running-count"),running?`${running} กำลังทำงาน`:"เลือกโหมดแล้วกด ▶");
  button("create").disabled=unavailable||picking;
  button("start-all").disabled=unavailable||picking||!state.groups.some(g=>{const s=normalizedSettings(editing(g).settings);return (s.movement==="stationary"?s.effect!=="none":g.route)&&g.count&&!g.running;});button("stop-all").disabled=unavailable||!running;
  el("empty").hidden=state.groups.length>0;el("column-headings").hidden=!state.groups.length;
  const selected=group(state.pickingId??"");el("picking").hidden=!selected;
  if(selected){const drawing=state.pickMode==="line",count=state.draft?.length??0;
    text(el("picking-title"),drawing?`LINE · ${selected.name} · ${count} จุด`:`เลือกจุดเริ่ม · ${selected.name}`);
    text(el("picking-message"),drawing?(count?"คลิกช่องถัดไป · คลิกช่องล่าสุดซ้ำหรือ Enter เพื่อบันทึก":"คลิกช่องเริ่มที่ต้องการ แล้วเลือกช่องถัดไป"):"คลิกช่องเริ่มใหม่บนแผนที่ จุดถัดไปยังอยู่ที่เดิม");
    button("finish-line").hidden=!drawing;button("finish-line").disabled=unavailable||count<2;button("undo-line").hidden=!drawing;button("undo-line").disabled=unavailable||!count;button("cancel-pick").disabled=unavailable;
  }
  const error=localError||state.error||"";el("error").hidden=!error;text(el("error"),error);
  text(el("status"),pending?"กำลังบันทึก…":unavailable?(state.message||"กำลังเชื่อมต่อ…"):drafts.size?"มีการแก้ไข · Enter หรือกดเริ่มเพื่อบันทึก":"บันทึกอัตโนมัติ");
  text(el("connection"),`${online?(state.gm?"GM":"ผู้เล่น"):"ตัวอย่าง"} · ${VERSION}`);
}

button("create").onclick=()=>enqueue({kind:"create",run:async()=>{await send({type:"create"});}});
button("start-all").onclick=()=>enqueue({kind:"startAll",run:async()=>{for(const id of drafts.keys())if(!await saveDraft(id))return;await send({type:"startAll"});}});
button("stop-all").onclick=()=>enqueue({kind:"stopAll",run:async()=>{await send({type:"stopAll"});}},true);
button("help").onclick=()=>{const panel=el("help-panel");panel.hidden=!panel.hidden;button("help").setAttribute("aria-expanded",String(!panel.hidden));};
for(const [id,type]of [["finish-line","finishLine"],["undo-line","undoLine"],["cancel-pick","cancelPick"]] as const)button(id).onclick=()=>{if(state.pickingId)action(state.pickingId,type);};

if(OBR.isAvailable){
  render();OBR.onReady(async()=>{
    online=true;const connectionId=await OBR.player.getConnectionId();
    const transfers=new Map<string,{parts:Map<number,string>;total:number;created:number}>();
    OBR.broadcast.onMessage(STATE,event=>{
      if(event.connectionId!==connectionId)return;const p=event.data as StatePacket;
      if(!p||typeof p.transfer!=="string"||typeof p.data!=="string"||!Number.isInteger(p.total)||p.total<1||p.total>10000||!Number.isInteger(p.index)||p.index<0||p.index>=p.total)return;
      for(const [id,t]of transfers)if(Date.now()-t.created>15000)transfers.delete(id);
      let t=transfers.get(p.transfer);if(!t){t={parts:new Map(),total:p.total,created:Date.now()};transfers.set(p.transfer,t);}if(t.total!==p.total)return;t.parts.set(p.index,p.data);
      if(t.parts.size===t.total){transfers.delete(p.transfer);try{state=JSON.parse(Array.from({length:p.total},(_,i)=>t!.parts.get(i)).join("")) as State;if(pending&&(pending.id===state.lastRequest||pending.command.type==="status"))finishRequest(!state.error);render();}catch(error){console.error(error);}}
    });
    enqueue({kind:"status",run:async()=>{await send({type:"status"});}});
    setTimeout(()=>{if(!state.ready&&!pending)enqueue({kind:"status",run:async()=>{await send({type:"status"});}});},1500);
  });
}else{
  el("demo-banner").hidden=false;
  if(new URLSearchParams(location.search).has("preview"))state={...state,groups:[
    {id:"one",name:"ยามหน้าประตู",count:2,names:["Guard","Scout"],route:[{x:150,y:150},{x:350,y:150},{x:350,y:350}],settings:{...defaultSettings,speed:1},running:false,progress:0,direction:"outbound",message:"พร้อม"},
    {id:"two",name:"ลาดตระเวนริมฝั่ง",count:1,names:["Monster"],route:[{x:450,y:150},{x:450,y:350},{x:650,y:350}],settings:{...defaultSettings},running:true,progress:.42,direction:"return",message:"กำลังเดิน"},
    {id:"three",name:"ขบวนเสบียง",count:3,names:["Cart","Horse","Scout"],route:[{x:150,y:450},{x:650,y:450}],settings:{...defaultSettings,speed:.5,flip:false},running:false,progress:0,direction:"outbound",message:"พร้อม"}
  ],selectedId:"one"};render();
}
