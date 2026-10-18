import OBR, {type Item} from "@owlbear-rodeo/sdk";
import {COMMAND, STATE, ID, initialState, type Command, type State} from "./shared";
import {Motion} from "./motion";

let state: State = {...initialState};
let originals: Item[] = [];
let previousTool = "";
let queue = Promise.resolve();
const motor = new Motion({
  read: ids => OBR.scene.items.getItems(ids),
  interact: items => OBR.interaction.startItemInteraction(items),
  commit: items => {
    const positions = new Map(items.map(i => [i.id, i.position]));
    return OBR.scene.items.updateItems(items.map(i => i.id), draft => draft.forEach(i => {
      const p = positions.get(i.id); if (p && !i.locked) i.position = {...p};
    }));
  }
});
async function publish() {
  state.running = motor.running; state.progress = motor.progress;
  await OBR.broadcast.sendMessage(STATE, state, {destination: "LOCAL"});
}
function enqueue(action: () => Promise<void>) {
  queue = queue.then(action).catch(async error => {
    await motor.stop(false);
    state.message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";
    await publish().catch(console.error);
  });
}
async function requireGM() {
  if (await OBR.player.getRole() !== "GM") throw new Error("เฉพาะ GM เท่านั้นที่ควบคุมการเคลื่อนที่ได้");
  if (!await OBR.scene.isReady()) throw new Error("กรุณาเปิด Scene ก่อน");
}
async function restoreTool() {
  if (previousTool && await OBR.tool.getActiveTool() === ID) await OBR.tool.activateTool(previousTool);
}
async function handle(command: Command) {
  state.gm = await OBR.player.getRole() === "GM";
  state.ready = await OBR.scene.isReady();
  if (command.type === "status") {await publish(); return;}
  await requireGM();
  if (command.type === "capture") {
    await motor.stop();
    const ids = await OBR.player.getSelection();
    if (!ids?.length) throw new Error("เลือก Token หรือวัตถุบนแผนที่ก่อน แล้วกดบันทึกจุด A");
    const items = await OBR.scene.items.getItems(ids);
    // Move top-level selections only; attached children follow their parent automatically.
    const selected = new Set(items.map(i => i.id));
    const roots = items.filter(i => !i.attachedTo || !selected.has(i.attachedTo));
    if (!roots.length || roots.some(i => i.locked)) throw new Error("กรุณาปลดล็อกวัตถุที่เลือกก่อน");
    if (roots.some(i => i.attachedTo)) throw new Error("กรุณาเลือกวัตถุหลัก แทนวัตถุที่แนบกับวัตถุอื่น");
    originals = structuredClone(roots);
    state.names = roots.map(i => i.name || i.type); state.a = {...roots[0].position}; state.b = undefined;
    state.progress = 0; motor.progress = 0;
    state.message = "บันทึก A แล้ว • กดเลือกจุด B จากนั้นคลิกบนแผนที่";
  } else if (command.type === "pick") {
    if (!originals.length) throw new Error("กรุณาบันทึกจุด A ก่อน");
    await motor.stop();
    const active = await OBR.tool.getActiveTool();
    if (active !== ID) previousTool = active;
    state.picking = true; state.message = "คลิกจุด B บนแผนที่ • กด Esc เพื่อยกเลิก";
    await OBR.tool.activateMode(ID, `${ID}/destination`);
    await publish();
    await OBR.action.close();
    return;
  } else if (command.type === "start") {
    if (!state.b || !originals.length) throw new Error("กรุณากำหนดจุด A และ B ก่อน");
    if (command.mode !== "once" && command.mode !== "patrol") throw new Error("โหมดการเคลื่อนที่ไม่ถูกต้อง");
    await motor.start(originals, state.b, await OBR.scene.grid.getDpi(), command.speed, command.mode === "patrol", command.smooth, performance.now());
    state.message = command.mode === "patrol" ? "กำลังเคลื่อนที่วน A ↔ B" : "กำลังเคลื่อนที่ไปยัง B";
  } else if (command.type === "stop") {
    await motor.stop(); state.picking = false; await restoreTool(); state.message = "หยุด ณ ตำแหน่งปัจจุบันแล้ว";
  } else if (command.type === "reset") {
    await motor.stop(); state.picking = false; await restoreTool();
    const current = await OBR.scene.items.getItems(originals.map(i => i.id));
    if (current.length !== originals.length || current.some(i => i.locked)) throw new Error("วัตถุถูกลบหรือล็อก กรุณาเลือกจุด A ใหม่");
    await OBR.scene.items.updateItems(current, draft => draft.forEach(i => {i.position = {...originals.find(o => o.id === i.id)!.position};}));
    motor.progress = 0; state.message = "กลับสู่จุด A แล้ว";
  }
  await publish();
}

OBR.onReady(async () => {
  try {
    const connectionId = await OBR.player.getConnectionId();
    previousTool = await OBR.tool.getActiveTool();
    OBR.tool.onToolChange(id => {if (id !== ID) previousTool = id;});
    const icon = new URL("icon.svg", location.href).href;
    await OBR.tool.create({id: ID, icons: [{icon, label: "Token Move • เลือกจุด B", filter: {roles: ["GM"]}}], defaultMode: `${ID}/destination`});
    await OBR.tool.createMode({
      id: `${ID}/destination`, icons: [{icon, label: "เลือกปลายทาง B", filter: {activeTools: [ID], roles: ["GM"]}}],
      cursors: [{cursor: "crosshair"}],
      onToolClick: (_, event) => {
        const point = {...event.pointerPosition};
        enqueue(async () => {
          await requireGM();
          if (!originals.length) {await OBR.action.open(); throw new Error("กรุณาบันทึกจุด A ในแผง Token Move ก่อน");}
          if (motor.running) throw new Error("กรุณาหยุดการเคลื่อนที่ก่อนเปลี่ยนจุด B");
          state.b = point; state.picking = false; state.message = "กำหนด B แล้ว • พร้อมเริ่มเคลื่อนที่";
          await restoreTool(); await publish(); await OBR.action.open();
        });
      },
      onKeyDown: (_, event) => {if (event.key === "Escape") enqueue(async () => {
        state.picking = false; state.message = "ยกเลิกการเลือกจุด B"; await restoreTool(); await publish(); await OBR.action.open();
      });},
      onDeactivate: () => enqueue(async () => {if (state.picking) {state.picking = false; state.message = "ยกเลิกการเลือกจุด B"; await publish();}})
    });
    OBR.broadcast.onMessage(COMMAND, event => {
      if (event.connectionId !== connectionId) return;
      const command = event.data as Command;
      if (command && ["status", "capture", "pick", "start", "stop", "reset"].includes(command.type)) enqueue(() => handle(command));
    });
    OBR.scene.onReadyChange(ready => enqueue(async () => {
      await motor.stop(false); originals = []; state = {...initialState, ready, gm: await OBR.player.getRole() === "GM", message: ready ? "เลือกวัตถุ แล้วบันทึกจุด A" : "กรุณาเปิด Scene ก่อน"}; await publish();
    }));
    OBR.player.onChange(player => enqueue(async () => {
      state.gm = player.role === "GM";
      if (!state.gm) {await motor.stop(false); state.picking = false; state.message = "เฉพาะ GM เท่านั้นที่ควบคุมได้";}
      await publish();
    }));
    OBR.scene.items.onChange(items => {
      if (!motor.running) return;
      const byId = new Map(items.map(i => [i.id, i]));
      if (originals.some(i => !byId.has(i.id) || byId.get(i.id)!.locked)) enqueue(async () => {
        await motor.stop(false); state.message = "หยุดแล้ว: วัตถุถูกลบหรือล็อก"; await publish();
      });
    });
    let pendingTick = false; let lastPublish = 0;
    setInterval(() => {
      if (!motor.running || pendingTick) return;
      pendingTick = true;
      enqueue(async () => {
        try {
          await motor.tick(performance.now());
          if (!motor.running) state.message = "ถึงจุด B แล้ว";
          if (performance.now() - lastPublish > 250 || !motor.running) {lastPublish = performance.now(); await publish();}
        } finally {pendingTick = false;}
      });
    }, 33);
    state.message = "เลือกวัตถุ แล้วบันทึกจุด A";
    await handle({type: "status"});
  } catch (error) {console.error(error);}
});
