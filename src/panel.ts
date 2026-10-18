import OBR from "@owlbear-rodeo/sdk";
import {COMMAND, STATE, VERSION, initialState, defaultSettings, type Command, type GroupView, type State, type StatePacket, type Settings} from "./shared";
import "./style.css";

document.querySelector("#app")!.innerHTML=`
<header><div class="brand" aria-hidden="true">↗</div><div><h1>Token Move <span>LINE</span></h1><p>เลือกช่องเริ่ม แล้ววางเส้นทางของคุณ</p></div><span id="connection" class="connection">เชื่อมต่อ…</span></header>
<div id="demo-banner" hidden>ตัวอย่างหน้าควบคุม · เปิดผ่าน Owlbear เพื่อใช้งาน</div>
<section class="fleet"><div class="section-heading"><h2>กลุ่มของคุณ <span id="group-count">0</span></h2><span id="running-count"></span></div>
<button id="create" class="primary full add">＋ เพิ่มกลุ่มจาก Token ที่เลือก</button>
<div id="group-list" class="group-list" aria-label="เลือกกลุ่ม"></div>
<div id="fleet-actions" class="fleet-actions" hidden><button id="start-all" class="quiet">▶ เริ่มทั้งหมด</button><button id="stop-all" class="quiet stop">■ หยุดทั้งหมด</button></div></section>
<section id="empty" class="empty"><div aria-hidden="true">⌁</div><h2>สร้าง LINE แรก</h2><p>เลือก Token บนแผนที่ แล้วกดเพิ่มกลุ่ม<br>ช่องเริ่มต้นเลือกเองได้ตอนวาด LINE</p><ol><li>เลือก Token</li><li>วาด LINE</li><li>เริ่มเดิน</li></ol></section>
<section id="editor" hidden>
<div class="editor-heading"><label class="sr-only" for="group-name">ชื่อกลุ่ม</label><input id="group-name" maxlength="80" placeholder="ตั้งชื่อกลุ่ม"><span id="group-status" class="badge"></span></div>
<p id="selection" class="muted members"></p>
<section class="route-card"><div class="section-heading"><h2>เส้นทาง LINE <span id="point-count"></span></h2><button id="show-route" class="quiet small">ซ่อนเส้นทาง</button></div>
<p id="route-hint" class="route-hint"></p><div class="route-actions"><button id="pick-line" class="secondary">✎ วาด LINE</button><button id="pick-start" class="secondary">⌖ เปลี่ยนจุดเริ่ม</button></div>
<p id="draft-count" class="draft-count" hidden></p></section>
<section id="settings" class="settings"><div class="speed-row"><label for="speed">ความเร็ว<small>ช่อง / วินาที</small></label><div class="stepper"><button id="slower" aria-label="ลดความเร็ว">−</button><input id="speed" type="number" min="0.1" max="20" step="0.1" value="2"><button id="faster" aria-label="เพิ่มความเร็ว">＋</button></div></div>
<fieldset><legend>รูปแบบการเดิน</legend><input type="hidden" id="mode" value="patrol"><div class="segmented"><button id="mode-once" aria-pressed="false">เดินครั้งเดียว</button><button id="mode-patrol" aria-pressed="true">↔ วนไปกลับ</button></div></fieldset>
<label class="toggle-row" for="flip"><span>หันหน้าตามทางเดิน<small>Flip ภาพเมื่อเดินกลับ</small></span><input id="flip" type="checkbox" checked></label>
<div id="dirty-note" class="dirty-note" hidden><span>มีการตั้งค่าใหม่ · กดเริ่มเพื่อใช้ค่า</span><button id="save" class="quiet small">บันทึก</button></div>
</section>
<details id="more"><summary>ตัวเลือกเพิ่มเติม</summary><div class="more-content">
<label class="toggle-row" for="smooth"><span>ค่อย ๆ ออกตัวและหยุด<small>ในแต่ละช่วงของ LINE</small></span><input id="smooth" type="checkbox"></label>
<label class="select-row" for="facing">ภาพต้นฉบับหันไปทาง<select id="facing"><option value="right">ขวา →</option><option value="left">ซ้าย ←</option></select></label>
<details id="route-details"><summary id="route-summary">ลำดับช่องเดิน</summary><ol id="route-nodes"></ol></details>
<div class="extra-actions"><button id="capture" class="secondary">เปลี่ยน Token ของกลุ่ม</button><button id="reset" class="secondary">กลับจุดเริ่มของ LINE</button><button id="remove" class="quiet danger">ลบกลุ่ม</button></div>
</div></details>
</section>
<p id="status" class="status" role="status" aria-live="polite"></p>
<footer>Token Move ${VERSION} · GM controls</footer>
<section id="dock" class="dock" hidden aria-label="ควบคุมการเดิน"><div id="walk-controls"><div class="progress-heading"><span id="direction"></span><span id="percent"></span></div><progress id="progress" value="0" max="1" aria-label="ความคืบหน้า LINE"></progress><div class="controls"><button id="start" class="primary">▶ เริ่มเดิน</button><button id="stop" class="stop-button">■ หยุด</button></div><p id="placement-note" class="placement-note"></p></div>
<div id="draft-controls" hidden><button id="finish-line" class="primary full">✓ บันทึก LINE</button><div class="draft-actions"><button id="undo-line" class="secondary">↶ ย้อน 1 จุด</button><button id="cancel-pick" class="quiet">ยกเลิก</button></div></div></section>`;

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(id:string)=>el<HTMLButtonElement>(id);
let state:State={...initialState},online=false,editorId:string|undefined,dirty=false,editingGroup:GroupView|undefined;
let pending:{id:string;type:Command["type"];timer:ReturnType<typeof setTimeout>;resolve:(ok:boolean)=>void}|undefined;
let cardIds="",routeNodesKey="";
const format=(p:{x:number;y:number})=>`${Math.round(p.x)}, ${Math.round(p.y)}`;
function setFields(g:GroupView){
  el<HTMLInputElement>("group-name").value=g.name;el<HTMLInputElement>("speed").value=String(g.settings.speed);
  el<HTMLInputElement>("mode").value=g.settings.mode;el<HTMLInputElement>("flip").checked=g.settings.flip;
  el<HTMLInputElement>("smooth").checked=g.settings.smooth;el<HTMLSelectElement>("facing").value=g.settings.facing;
}
function settings():Settings{return {speed:el<HTMLInputElement>("speed").valueAsNumber,mode:el<HTMLInputElement>("mode").value==="once"?"once":"patrol",flip:el<HTMLInputElement>("flip").checked,smooth:el<HTMLInputElement>("smooth").checked,facing:el<HTMLSelectElement>("facing").value==="left"?"left":"right"};}
function render(next:State){
  state=next;const g=state.groups.find(g=>g.id===state.selectedId)??state.groups[0];editingGroup=g;
  if(editorId!==g?.id){editorId=g?.id;dirty=false;if(g)setFields(g);}else if(g&&!dirty)setFields(g);
  const unavailable=!online||!state.gm||!state.ready||!!pending,picking=!!state.pickingId;
  el("connection").textContent=online?(state.gm?"● GM":"ผู้เล่น"):"ตัวอย่าง";
  el("group-count").textContent=String(state.groups.length);
  const running=state.groups.filter(g=>g.running).length;el("running-count").textContent=running?`${running} กลุ่มกำลังเดิน`:"";
  button("create").disabled=unavailable||picking;
  el("fleet-actions").hidden=state.groups.length<2;
  button("start-all").disabled=unavailable||picking||!state.groups.some(g=>g.route&&g.count&&!g.running);
  button("stop-all").disabled=unavailable||!running;
  const list=el("group-list"),ids=JSON.stringify(state.groups.map(g=>g.id));
  if(ids!==cardIds){const scroll=list.scrollTop;cardIds=ids;list.replaceChildren(...state.groups.map(group=>{
    const row=document.createElement("button");row.dataset.groupId=group.id;
    row.innerHTML='<span class="dot"></span><span class="group-card-body"><strong></strong><small></small></span><span class="card-state"></span>';return row;
  }));list.scrollTop=scroll;}
  state.groups.forEach((group,i)=>{
    const row=list.children[i] as HTMLButtonElement;row.className=`group-card ${group.id===g?.id?"selected":""}`;
    row.setAttribute("aria-pressed",String(group.id===g?.id));row.children[0].className=`dot ${group.running?"live":""}`;
    const values:[Element,string][]=[[row.children[1].children[0],group.name],[row.children[1].children[1],`${group.count} Token · ${group.route?`${group.route.length} จุด`:"ยังไม่มี LINE"}`],[row.children[2],group.running?"กำลังเดิน":group.route?"พร้อม":"สร้าง LINE"]];
    for(const [node,value]of values)if(node.textContent!==value)node.textContent=value;
    row.disabled=unavailable||picking;
  });
  el("empty").hidden=!!g;el("editor").hidden=!g;el("dock").hidden=!g;
  const message=pending?"กำลังทำรายการ…":state.error??state.message;
  el("status").textContent=message;el("status").classList.toggle("error",!!state.error);el("status").hidden=!message;
  if(!g)return;
  const drawing=state.pickingId===g.id&&state.pickMode==="line",pickingStart=state.pickingId===g.id&&state.pickMode==="start";
  const route=drawing?(state.draft??[]):g.route??[],locked=unavailable||g.running||picking;
  el("group-status").textContent=g.running?"กำลังเดิน":picking?"เลือกช่อง":"หยุด";
  el("selection").textContent=g.count?`${g.count} Token · ${g.names.join(", ")}${g.count>g.names.length?" …":""}`:"ยังไม่มี Token · เลือก Token แล้วเปลี่ยนสมาชิกในตัวเลือกเพิ่มเติม";
  el("point-count").textContent=route.length?`${route.length} จุด`:"";
  el("route-hint").textContent=pickingStart?"คลิกช่องเริ่มใหม่บนแผนที่ จุดถัดไปยังอยู่ที่เดิม":drawing?(route.length?"คลิกช่องถัดไป หรือคลิกช่องล่าสุดซ้ำเพื่อบันทึก":"คลิกช่องเริ่มต้นที่ต้องการบนแผนที่"):(g.route?"จุดแรกคือช่องเริ่มที่คุณเลือก เปลี่ยนได้ทุกเมื่อที่หยุด":"คลิกช่องเริ่ม → เลือกช่องต่อไป → คลิกช่องล่าสุดซ้ำเพื่อเสร็จ");
  button("pick-line").textContent=g.route?"✎ วาด LINE ใหม่":"✎ สร้าง LINE";
  button("pick-line").className=g.route?"secondary":"primary";
  button("pick-line").disabled=locked||!g.count;button("pick-start").disabled=locked||!g.route;
  button("pick-start").hidden=!g.route;
  button("show-route").textContent=state.routeVisible===false?"แสดงเส้นทาง":"ซ่อนเส้นทาง";
  button("show-route").disabled=unavailable||!route.length;
  el("draft-count").hidden=!drawing;el("draft-count").textContent=`เลือกแล้ว ${route.length} จุด · ต้องมีอย่างน้อย 2 จุด`;
  el("settings").hidden=picking;el("more").hidden=picking;
  el("walk-controls").hidden=picking;el("draft-controls").hidden=!picking;
  button("finish-line").hidden=!drawing;button("finish-line").disabled=unavailable||route.length<2;
  button("undo-line").hidden=!drawing;button("undo-line").disabled=unavailable||!route.length;
  button("cancel-pick").disabled=unavailable;
  for(const id of ["group-name","speed","smooth","flip","facing"]) (el(id) as HTMLInputElement).disabled=locked;
  el<HTMLSelectElement>("facing").disabled=locked||!el<HTMLInputElement>("flip").checked;
  button("slower").disabled=locked||settings().speed<=.1;button("faster").disabled=locked||settings().speed>=20;
  for(const mode of ["once","patrol"]){button(`mode-${mode}`).disabled=locked;button(`mode-${mode}`).setAttribute("aria-pressed",String(settings().mode===mode));}
  el("dirty-note").hidden=!dirty;button("save").disabled=locked;
  button("capture").disabled=locked;button("reset").disabled=unavailable||!g.route||!g.count;
  button("remove").disabled=unavailable;
  const complete=!g.running&&g.settings.mode==="once"&&g.progress>=1;
  button("start").textContent=g.running?"▶ กำลังเดิน":complete?"↻ เริ่มรอบใหม่":g.progress>0?"▶ เดินต่อ":"▶ เริ่มเดิน";
  button("start").disabled=locked||!g.route||!g.count;button("stop").disabled=unavailable||!g.running;
  el("direction").textContent=g.running?`${g.direction==="return"?"ขากลับ":"ขาไป"} · จุด ${Math.min((g.waypointIndex??1)+1,g.route?.length??0)}/${g.route?.length??0}`:g.message;
  el("percent").textContent=g.route?`${Math.round(g.progress*100)}%`:"";
  el<HTMLProgressElement>("progress").value=g.progress;
  el("placement-note").textContent=g.running?"ปิดแผงได้ · เปิดห้องค้างไว้ขณะเดิน":g.route?(complete||g.progress===0?"เมื่อเริ่มรอบใหม่ Token จะวางที่ช่องเริ่มของ LINE":"เดินต่อจากตำแหน่งที่หยุดไว้"):"สร้าง LINE ก่อนเริ่มเดิน";
  el("route-summary").textContent=`ลำดับช่องเดิน${g.route?` · ${g.route.length} จุด`:""}`;
  const key=JSON.stringify([g.id,g.route]);if(key!==routeNodesKey){routeNodesKey=key;el("route-nodes").replaceChildren(...(g.route??[]).map((p,i)=>{const li=document.createElement("li");li.textContent=`${format(p)}${i===0?" · เริ่ม":i===g.route!.length-1?" · สุดท้าย":""}`;return li;}));}
}
function finishRequest(ok:boolean){if(pending){clearTimeout(pending.timer);const resolve=pending.resolve;pending=undefined;resolve(ok);}}
async function send(command:Command):Promise<boolean>{
  if(pending||!online)return false;
  const id=crypto.randomUUID();const done=new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{if(pending?.id!==id)return;finishRequest(false);state.error="ไม่ได้รับคำตอบ กรุณาลองใหม่หรือรีโหลดห้อง";render(state);},10000);pending={id,type:command.type,timer,resolve};});
  render(state);
  try{await OBR.broadcast.sendMessage(COMMAND,{request:id,command},{destination:"LOCAL"});}
  catch{finishRequest(false);state.error="ส่งคำสั่งไม่สำเร็จ กรุณาลองใหม่";render(state);}
  return done;
}
function receive(next:State){
  if(pending&&(next.lastRequest===pending.id||pending.type==="status")){if(pending.type==="update"&&!next.error)dirty=false;finishRequest(!next.error);}
  render(next);
}
async function saveDraft(){
  if(!dirty)return true;if(!editingGroup||!el<HTMLInputElement>("speed").reportValidity())return false;
  return send({type:"update",id:editingGroup.id,name:el<HTMLInputElement>("group-name").value.trim()||"กลุ่มไม่มีชื่อ",settings:settings()});
}
async function perform(command:Command){
  if(command.type==="remove")dirty=false;
  else if(dirty&&!await saveDraft())return;
  await send(command);
}
function changed(){dirty=true;render(state);}
button("create").onclick=()=>void perform({type:"create"});
button("start-all").onclick=()=>void perform({type:"startAll"});button("stop-all").onclick=()=>void send({type:"stopAll"});
el("group-list").onclick=event=>{const row=(event.target as HTMLElement).closest<HTMLButtonElement>("[data-group-id]");if(row?.dataset.groupId)void perform({type:"select",id:row.dataset.groupId});};
const actions={"pick-line":"pickLine","pick-start":"pickStart","show-route":"showRoute","finish-line":"finishLine","undo-line":"undoLine","cancel-pick":"cancelPick",capture:"capture",reset:"reset",remove:"remove",start:"start",stop:"stop"} as const;
for(const [id,type]of Object.entries(actions))button(id).onclick=()=>{if(editingGroup)void perform({type,id:editingGroup.id});};
for(const id of ["group-name","speed","flip","smooth","facing"])el(id).addEventListener("input",changed);
for(const mode of ["once","patrol"])button(`mode-${mode}`).onclick=()=>{el<HTMLInputElement>("mode").value=mode;changed();};
for(const [id,delta]of [["slower",-.1],["faster",.1]] as const)button(id).onclick=()=>{const speed=el<HTMLInputElement>("speed"),current=Number.isFinite(speed.valueAsNumber)?speed.valueAsNumber:defaultSettings.speed;speed.value=String(Math.min(20,Math.max(.1,Math.round((current+delta)*10)/10)));changed();};
button("save").onclick=()=>void saveDraft();

if(OBR.isAvailable){
  render(state);OBR.onReady(async()=>{
    online=true;const connectionId=await OBR.player.getConnectionId();
    const transfers=new Map<string,{parts:Map<number,string>;total:number;created:number}>();
    OBR.broadcast.onMessage(STATE,event=>{
      if(event.connectionId!==connectionId)return;const p=event.data as StatePacket;
      if(!p||typeof p.transfer!=="string"||typeof p.data!=="string"||!Number.isInteger(p.total)||p.total<1||p.total>10000||!Number.isInteger(p.index)||p.index<0||p.index>=p.total)return;
      for(const [id,t]of transfers)if(Date.now()-t.created>15000)transfers.delete(id);
      let t=transfers.get(p.transfer);if(!t){t={parts:new Map(),total:p.total,created:Date.now()};transfers.set(p.transfer,t);}
      if(t.total!==p.total)return;t.parts.set(p.index,p.data);
      if(t.parts.size===t.total){transfers.delete(p.transfer);try{receive(JSON.parse(Array.from({length:p.total},(_,i)=>t!.parts.get(i)).join("")) as State);}catch(error){console.error(error);}}
    });
    await send({type:"status"});setTimeout(()=>{if(!state.ready&&!pending)void send({type:"status"});},1500);
  });
}else{
  el("demo-banner").hidden=false;
  const samples:GroupView[]=new URLSearchParams(location.search).has("preview")?[
    {id:"guards",name:"ยามหน้าประตู",count:2,names:["Guard","Scout"],route:[{x:150,y:250},{x:250,y:250},{x:250,y:350},{x:350,y:350}],settings:{...defaultSettings},running:false,progress:0,direction:"outbound",message:"LINE พร้อมแล้ว"},
    {id:"patrol",name:"ลาดตระเวนริมฝั่ง",count:1,names:["Monster"],route:[{x:450,y:150},{x:450,y:350},{x:650,y:350}],settings:{...defaultSettings,speed:1},running:true,progress:.42,direction:"return",message:"กำลังเดิน"}
  ]:[];
  render({...state,groups:samples,selectedId:samples[0]?.id,message:"เปิดผ่าน Owlbear Rodeo เพื่อควบคุม Token"});
}
