import OBR from "@owlbear-rodeo/sdk";
import {COMMAND, STATE, initialState, type Command, type State} from "./shared";
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header><div class="brand-icon">↗</div><div><h1>Token Move</h1><p>ให้ฉากของคุณเคลื่อนไหว</p></div><span id="connection" class="badge">เชื่อมต่อ…</span></header>
  <div class="route" aria-hidden="true"><span class="node">A</span><span class="track"><i id="traveler"></i></span><span class="node end">B</span></div>
  <section><div class="section-title"><span class="step">01</span><h2>กำหนดเส้นทาง</h2></div>
    <p class="hint">เลือก Token หรือวัตถุในฉาก แล้วบันทึกตำแหน่งเริ่มต้น</p>
    <button id="capture" class="secondary full">＋ บันทึกจุด A จากวัตถุที่เลือก</button>
    <p id="selection" class="selection">ยังไม่ได้เลือกวัตถุ</p>
    <div class="points"><div><span>จุดเริ่มต้น A</span><strong id="point-a">—</strong></div><div><span>จุดปลายทาง B</span><strong id="point-b">—</strong></div></div>
    <button id="pick" class="secondary full">⌖ เลือกจุด B บนแผนที่</button>
  </section>
  <section><div class="section-title"><span class="step">02</span><h2>ตั้งค่าการเคลื่อนที่</h2></div>
    <label class="row" for="speed">ความเร็ว <span><input id="speed" type="number" min="0.1" max="20" step="0.1" value="2" aria-label="ความเร็ว"> ช่อง/วินาที</span></label>
    <label class="row" for="mode">รูปแบบ <select id="mode"><option value="once">เที่ยวเดียว A → B</option><option value="patrol">วนไปกลับ A ↔ B</option></select></label>
    <label class="row check" for="smooth"><span>ค่อย ๆ ออกตัวและหยุด</span><input type="checkbox" id="smooth"></label>
  </section>
  <div class="controls"><button id="start" class="primary">▶ เริ่มเคลื่อนที่</button><button id="stop" class="secondary">■ หยุด</button><button id="reset" class="text-button">↶ กลับจุด A</button></div>
  <div class="status-box"><div class="status-line"><span id="status" role="status" aria-live="polite"></span><span id="percent">0%</span></div><progress id="progress" max="1" value="0" aria-label="ความคืบหน้าการเคลื่อนที่"></progress></div>
  <footer>GM controls · เคลื่อนที่ต่อได้เมื่อปิดแผงนี้<br>เส้นทางตรง • ไม่ตรวจสิ่งกีดขวาง</footer>`;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
let state = {...initialState};
let online = false;
let sending = false;
function render(next: State) {
  state = next;
  el("connection").textContent = online ? (state.gm ? "GM" : "ผู้เล่น") : "ตัวอย่าง";
  el("selection").textContent = state.names.length ? `${state.names.length} วัตถุ • ${state.names.join(", ")}` : "ยังไม่ได้เลือกวัตถุ";
  for (const key of ["a", "b"] as const) {
    const point = state[key]; el(`point-${key}`).textContent = point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : "—";
  }
  el("status").textContent = state.message;
  el("percent").textContent = `${Math.round(state.progress * 100)}%`;
  el<HTMLProgressElement>("progress").value = state.progress;
  el("traveler").style.left = `${state.progress * 100}%`;
  const disabled = !online || !state.gm || !state.ready || sending;
  button("capture").disabled = disabled || state.running;
  button("pick").disabled = disabled || !state.a || state.running;
  button("start").disabled = disabled || !state.b || state.running || state.picking;
  button("stop").disabled = disabled || (!state.running && !state.picking);
  button("reset").disabled = disabled || !state.a;
  for (const id of ["speed", "mode", "smooth"]) (el(id) as HTMLInputElement).disabled = disabled || state.running;
}
async function send(command: Command) {
  sending = true; render(state);
  try {await OBR.broadcast.sendMessage(COMMAND, command, {destination: "LOCAL"});}
  catch {state.message = "ส่งคำสั่งไม่สำเร็จ กรุณาเปิด Extension ใหม่";}
  finally {sending = false; render(state);}
}
for (const type of ["capture", "pick", "stop", "reset"] as const) button(type).onclick = () => void send({type});
button("start").onclick = () => {
  const speed = el<HTMLInputElement>("speed");
  if (!speed.reportValidity()) return;
  void send({type: "start", speed: speed.valueAsNumber, mode: el<HTMLSelectElement>("mode").value === "patrol" ? "patrol" : "once", smooth: el<HTMLInputElement>("smooth").checked});
};
if (OBR.isAvailable) {
  render(state);
  OBR.onReady(async () => {
    online = true;
    const connectionId = await OBR.player.getConnectionId();
    OBR.broadcast.onMessage(STATE, event => {if (event.connectionId === connectionId) render(event.data as State);});
    await send({type: "status"});
    // Background can still be registering its tool when the panel first opens.
    setTimeout(() => void send({type: "status"}), 1000);
  });
} else {
  render({...state, message: "เปิดผ่าน Owlbear Rodeo เพื่อใช้งาน • ดูวิธีติดตั้งใน README-TH.md"});
}
