import OBR from "@owlbear-rodeo/sdk";
import {COMMAND, STATE, VERSION, initialState, defaultSettings, type Command, type GroupView, type State, type StatePacket, type Settings} from "./shared";
import "./style.css";

document.querySelector("#app")!.innerHTML=`
<header><div class="brand">↗</div><div><h1>Token Move <span>2</span></h1><p>หลายกลุ่ม · หลายเส้นทาง · เดินพร้อมกัน</p></div><span id="connection" class="badge">เชื่อมต่อ…</span></header>
<div id="demo-banner" hidden>ตัวอย่างหน้าควบคุม • ใช้งานจริงผ่าน Owlbear Rodeo</div>
<section class="fleet"><div class="section-heading"><h2>กลุ่มการเคลื่อนที่ <span id="group-count">0</span></h2><span id="running-count">0 กำลังเดิน</span></div>
<div class="add-row"><button id="create-selected" class="primary">＋ เพิ่มกลุ่มจาก Token ที่เลือก</button><button id="create-empty" class="secondary" title="เพิ่มกลุ่มว่าง" aria-label="เพิ่มกลุ่มว่าง">＋</button></div>
<div id="group-list" class="group-list" aria-label="เลือกกลุ่ม"></div>
<div class="all-controls"><button id="start-all" class="text-button">▶ เริ่มทุกกลุ่ม</button><button id="stop-all" class="text-button stop">■ หยุดทุกกลุ่ม</button></div></section>
<div id="empty" class="empty"><span>↗</span><h2>เริ่มเส้นทางแรกของคุณ</h2><p>เลือก Token หนึ่งตัวหรือหลายตัวในฉาก<br>แล้วกด “เพิ่มกลุ่มจาก Token ที่เลือก” ด้านบน</p></div>
<section id="editor" hidden>
<div class="editor-heading"><label for="group-name">ชื่อกลุ่ม</label><input id="group-name" maxlength="80" placeholder="เช่น ยามหน้าประตู"><span id="group-status" class="badge">พร้อม</span></div>
<p id="selection" class="hint"></p>
<div class="route"><div class="point"><span>A · เริ่มต้น</span><strong id="a">—</strong></div><span class="route-arrow">⇄</span><div class="point end"><span>B · ปลายทาง</span><strong id="b">—</strong></div></div>
<div class="route-buttons"><button id="capture" class="secondary">บันทึก A / เปลี่ยน Token</button><button id="pick" class="secondary accent">⌖ คลิกเลือก B</button></div>
<button id="from-selection" class="text-button full small">ใช้ตำแหน่งวัตถุที่เลือก 1 ชิ้นเป็น B</button>
<div class="settings"><label class="row" for="speed">ความเร็ว<span><input id="speed" type="number" min="0.1" max="20" step="0.1" value="2"> ช่อง/วินาที</span></label>
<label class="row" for="mode">รูปแบบ<select id="mode"><option value="patrol">Loop ไปกลับ A ↔ B</option><option value="once">เที่ยวเดียว → B</option></select></label>
<label class="row" for="smooth">ค่อย ๆ ออกตัวและหยุด<input type="checkbox" id="smooth"></label>
<label class="row" for="flip"><span>Flip Token ตามทิศเดิน <small>เฉพาะรูปภาพ</small></span><input type="checkbox" id="flip" checked></label>
<label class="row" for="facing">ภาพต้นฉบับหันไปทาง<select id="facing"><option value="right">ขวา →</option><option value="left">ซ้าย ←</option></select></label>
<button id="save" class="secondary full save">บันทึกการตั้งค่า</button><p id="dirty-note" class="dirty-note" hidden>มีการแก้ไข • บันทึกการตั้งค่าก่อนเริ่มเดิน</p></div>
<div class="controls"><button id="start" class="primary">▶ เริ่มกลุ่มนี้</button><button id="stop" class="secondary">■ หยุด</button></div>
<div class="progress-heading"><span id="direction">A → B</span><span id="percent">0%</span></div><progress id="progress" value="0" max="1" aria-label="ความคืบหน้ากลุ่ม"></progress>
<p id="group-message" class="group-message"></p><div class="bottom-actions"><button id="reset" class="text-button">↶ กลับ A + คืน Flip</button><button id="remove" class="text-button danger">ลบกลุ่ม</button></div>
</section>
<p id="status" role="status" aria-live="polite" class="status"></p>
<details><summary>วิธีใช้และการหันหน้า</summary><p>1. เลือก Token → เพิ่มกลุ่ม<br>2. กดคลิกเลือก B → คลิกแผนที่<br>3. ตั้ง Loop / Flip แล้วบันทึก → เริ่มกลุ่มนี้<br>4. เลือก Token ชุดอื่นแล้วเพิ่มกลุ่มใหม่ได้เลย</p><p>“ภาพต้นฉบับ” หมายถึงภาพก่อน Flip หากหันผิดให้หยุดกลุ่ม เปลี่ยนซ้าย/ขวา บันทึก แล้วเริ่มต่อ เส้นทางแนวตั้งจะสลับ Flip ตอนกลับ A</p><p>เส้นทางบันทึกใน Scene แยกตามผู้ควบคุม หลังรีโหลดต้องกดเริ่มใหม่ กลุ่มที่ใช้ Token ซ้ำกันจะเดินพร้อมกันไม่ได้ ลบกลุ่มจะไม่ลบ Token</p></details>
<footer>GM controls · ปิดแผงได้ แต่เปิดห้องไว้ขณะเดิน<br>v${VERSION} · เส้นทางตรง ไม่ตรวจสิ่งกีดขวาง</footer>`;

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(id:string)=>el<HTMLButtonElement>(id);
let state:State={...initialState}; let online=false, editorId:string|undefined, dirty=false;
let pending:{id:string;type:Command["type"];timer:ReturnType<typeof setTimeout>;resolve:()=>void}|undefined;
let editingGroup:GroupView|undefined;
const format=(point?:{x:number;y:number})=>point?`${Math.round(point.x)}, ${Math.round(point.y)}`:"—";
function setFields(g:GroupView) {
  el<HTMLInputElement>("group-name").value=g.name; el<HTMLInputElement>("speed").value=String(g.settings.speed);
  el<HTMLSelectElement>("mode").value=g.settings.mode; el<HTMLInputElement>("smooth").checked=g.settings.smooth;
  el<HTMLInputElement>("flip").checked=g.settings.flip; el<HTMLSelectElement>("facing").value=g.settings.facing;
}
function render(next:State) {
  state=next;
  const g=state.groups.find(g=>g.id===state.selectedId)??state.groups[0]; editingGroup=g;
  if(editorId!==g?.id){editorId=g?.id;dirty=false;if(g)setFields(g);}
  else if(g&&!dirty) setFields(g);
  el("connection").textContent=online?(state.gm?"GM":"ผู้เล่น"):"ตัวอย่าง";
  el("group-count").textContent=String(state.groups.length);
  el("running-count").textContent=`${state.groups.filter(g=>g.running).length} กำลังเดิน`;
  const list=el("group-list");
  // Preserve list scroll while progress updates arrive.
  const scroll=list.scrollTop;
  list.replaceChildren(...state.groups.map(group=>{
    const row=document.createElement("button");row.className=`group-card ${group.id===g?.id?"selected":""}`;row.dataset.groupId=group.id;
    row.setAttribute("aria-pressed",String(group.id===g?.id));
    const dot=document.createElement("span");dot.className=`dot ${group.running?"live":""}`;
    const body=document.createElement("span");body.className="group-card-body";
    const name=document.createElement("strong");name.textContent=group.name;
    const info=document.createElement("small");info.textContent=`${group.count} Token · ${group.settings.mode==="patrol"?"Loop ↔":"เที่ยวเดียว →"}${group.settings.flip?" · Flip":""}`;
    body.append(name,info);
    const tag=document.createElement("span");tag.className="card-state";tag.textContent=group.running?(group.direction==="return"?"B → A":"A → B"):(group.b?"พร้อม":"ตั้งเส้นทาง");
    row.append(dot,body,tag);row.disabled=!online||!!pending;return row;
  })); list.scrollTop=scroll;
  el("empty").hidden=!!g;el("editor").hidden=!g;
  const unavailable=!online||!state.ready||!state.gm||!!pending;
  for(const id of ["create-selected","create-empty"]) button(id).disabled=unavailable||!!state.pickingId;
  button("start-all").disabled=unavailable||dirty||!state.groups.some(g=>g.b&&!g.running);
  button("stop-all").disabled=unavailable||(!state.groups.some(g=>g.running)&&!state.pickingId);
  el("status").textContent=pending?"กำลังส่งคำสั่ง…":state.message;
  if(!g)return;
  el("selection").textContent=g.count?`${g.count} วัตถุ · ${g.names.join(", ")}${g.count>g.names.length?" …":""}`:"ยังไม่ได้บันทึก Token ในกลุ่มนี้";
  el("a").textContent=format(g.a);el("b").textContent=format(g.b);
  el("group-status").textContent=g.running?"กำลังเดิน":(state.pickingId===g.id?"เลือก B":"หยุด");
  const locked=unavailable||g.running;
  for(const id of ["group-name","speed","mode","smooth","flip","facing"]) (el(id) as HTMLInputElement).disabled=locked;
  el<HTMLSelectElement>("facing").disabled=locked||!el<HTMLInputElement>("flip").checked;
  button("save").disabled=locked||!dirty;
  el("dirty-note").hidden=!dirty;
  button("capture").disabled=locked||!!state.pickingId;
  button("pick").disabled=locked||!g.a;
  button("from-selection").disabled=locked||!g.a;
  button("start").disabled=locked||!g.b||dirty||!!state.pickingId;
  button("stop").disabled=unavailable||(!g.running&&state.pickingId!==g.id);
  button("reset").disabled=unavailable||!g.a;
  button("remove").disabled=unavailable;
  el("direction").textContent=g.direction==="return"?"B → A":"A → B";
  el("percent").textContent=`${Math.round(g.progress*100)}%`;
  el<HTMLProgressElement>("progress").value=g.progress;
  el("group-message").textContent=g.message;
}
async function send(command:Command):Promise<void> {
  if(pending||!online)return;
  const id=crypto.randomUUID();
  const done=new Promise<void>(resolve=>{
    const timer=setTimeout(()=>{
      if(pending?.id!==id)return;
      pending=undefined;state.message="ไม่ได้รับคำตอบจาก background กรุณารีโหลดห้อง";render(state);resolve();
    },10000);
    pending={id,type:command.type,timer,resolve};
  });
  render(state);
  try {await OBR.broadcast.sendMessage(COMMAND,{request:id,command},{destination:"LOCAL"});}
  catch {finishRequest(id);state.message="ส่งคำสั่งไม่สำเร็จ กรุณาลองใหม่";render(state);}
  return done;
}
function finishRequest(id:string) {if(pending?.id===id){clearTimeout(pending.timer);pending.resolve();pending=undefined;}}
function receive(next:State) {
  if(pending&&(next.lastRequest===pending.id||pending.type==="status")){
    if(pending.type==="update"){
      const saved=next.groups.find(g=>g.id===editorId);
      if(saved&&saved.name===el<HTMLInputElement>("group-name").value.trim()&&JSON.stringify(saved.settings)===JSON.stringify(settings()))dirty=false;
    }
    clearTimeout(pending.timer);pending.resolve();pending=undefined;
  }
  render(next);
}
function settings():Settings {return {speed:el<HTMLInputElement>("speed").valueAsNumber,mode:el<HTMLSelectElement>("mode").value==="once"?"once":"patrol",smooth:el<HTMLInputElement>("smooth").checked,flip:el<HTMLInputElement>("flip").checked,facing:el<HTMLSelectElement>("facing").value==="left"?"left":"right"};}
button("create-selected").onclick=()=>void send({type:"create",capture:true});
button("create-empty").onclick=()=>void send({type:"create",capture:false});
button("start-all").onclick=()=>void send({type:"startAll"});
button("stop-all").onclick=()=>void send({type:"stopAll"});
el("group-list").onclick=event=>{const row=(event.target as HTMLElement).closest<HTMLButtonElement>("[data-group-id]");if(row?.dataset.groupId)void send({type:"select",id:row.dataset.groupId});};
const actions={capture:"capture",pick:"pick","from-selection":"destinationFromSelection",start:"start",stop:"stop",reset:"reset",remove:"remove"} as const;
for(const [id,type] of Object.entries(actions)) button(id).onclick=()=>{if(editingGroup)void send({type,id:editingGroup.id});};
for(const id of ["group-name","speed","mode","smooth","flip","facing"]) el(id).addEventListener("input",()=>{dirty=true;render(state);});
button("save").onclick=()=>{
  if(!editingGroup||!el<HTMLInputElement>("speed").reportValidity())return;
  const name=el<HTMLInputElement>("group-name");name.value=name.value.trim()||"กลุ่มไม่มีชื่อ";
  void send({type:"update",id:editingGroup.id,name:name.value,settings:settings()});
};

if(OBR.isAvailable){
  render(state);
  OBR.onReady(async()=>{
    online=true;const connectionId=await OBR.player.getConnectionId();
    const transfers=new Map<string,{parts:Map<number,string>;total:number;created:number}>();
    OBR.broadcast.onMessage(STATE,event=>{
      if(event.connectionId!==connectionId)return;
      const p=event.data as StatePacket;
      if(!p||typeof p.transfer!=="string"||typeof p.data!=="string"||!Number.isInteger(p.total)||p.total<1||p.total>10000||!Number.isInteger(p.index)||p.index<0||p.index>=p.total)return;
      for(const [id,value] of transfers)if(Date.now()-value.created>15000)transfers.delete(id);
      let transfer=transfers.get(p.transfer);
      if(!transfer){transfer={parts:new Map(),total:p.total,created:Date.now()};transfers.set(p.transfer,transfer);}
      if(transfer.total!==p.total)return;
      transfer.parts.set(p.index,p.data);
      if(transfer.parts.size===transfer.total){
        transfers.delete(p.transfer);
        try {receive(JSON.parse(Array.from({length:p.total},(_,i)=>transfer!.parts.get(i)).join("")) as State);}catch(error){console.error(error);}
      }
    });
    await send({type:"status"});
    setTimeout(()=>{if(!state.ready&&!pending)void send({type:"status"});},1500);
  });
}else{
  el("demo-banner").hidden=false;
  const preview=new URLSearchParams(location.search).has("preview");
  const samples:GroupView[]=preview?[
    {id:"one",name:"ยามหน้าประตู",count:2,names:["Guard A","Guard B"],a:{x:150,y:300},b:{x:1050,y:300},settings:{...defaultSettings},running:true,progress:.42,direction:"outbound",message:"กำลังวนไปกลับ A ↔ B"},
    {id:"two",name:"ขบวนเกวียน",count:4,names:["Cart","Horse","Scout"],a:{x:300,y:900},b:{x:1500,y:600},settings:{...defaultSettings,speed:.5,flip:false},running:true,progress:.75,direction:"return",message:"กำลังวนไปกลับ"},
    {id:"three",name:"ลาดตระเวนริมฝั่ง",count:1,names:["Ranger"],a:{x:600,y:750},b:{x:1200,y:450},settings:{...defaultSettings,speed:1},running:false,progress:0,direction:"outbound",message:"พร้อมเริ่ม"}
  ]:[];
  render({...state,groups:samples,selectedId:samples[0]?.id,message:"เปิดผ่าน Owlbear Rodeo เพื่อควบคุม Token"});
}
