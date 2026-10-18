import OBR, {type Item} from "@owlbear-rodeo/sdk";
import {Groups} from "./groups";
import {COMMAND, STATE, ID, VERSION, initialState, statePackets, type Command, type CommandMessage, type State} from "./shared";

let state: State = {...initialState};
let previousTool = "";
let storageKey = "";
let epoch = 0;
let queue = Promise.resolve();
const groups = new Groups({
  read: async ids => {
    const requestedEpoch=epoch; const items=await OBR.scene.items.getItems(ids);
    if (requestedEpoch!==epoch) throw new Error("Scene เปลี่ยนแล้ว กรุณาลองใหม่");
    return items;
  },
  interact: items => OBR.interaction.startItemInteraction(items),
  commit: items => {
    const byId=new Map(items.map(i=>[i.id,i]));
    return OBR.scene.items.updateItems(items.map(i=>i.id),draft=>draft.forEach(item=>{
      const value=byId.get(item.id);
      if (value&&!item.locked&&!item.attachedTo) {item.position={...value.position}; item.scale={...value.scale};}
    }));
  }
});
async function publish() {
  state.groups=groups.views();
  for (const packet of statePackets(state)) await OBR.broadcast.sendMessage(STATE,packet,{destination:"LOCAL"});
}
function enqueue(action:()=>Promise<void>, expectedEpoch=epoch) {
  queue=queue.then(async()=>{if(expectedEpoch===epoch) await action();}).catch(async error=>{
    state.message=error instanceof Error?error.message:"เกิดข้อผิดพลาด กรุณาลองใหม่";
    await publish().catch(console.error);
  });
}
async function requireGM() {
  if(await OBR.player.getRole()!=="GM") throw new Error("เฉพาะ GM เท่านั้นที่ควบคุมได้");
  if(!await OBR.scene.isReady()) throw new Error("กรุณาเปิด Scene ก่อน");
}
async function selectedItems() {
  const ids=await OBR.player.getSelection();
  if(!ids?.length) throw new Error("เลือก Token หรือวัตถุบนแผนที่ก่อน");
  return OBR.scene.items.getItems(ids);
}
async function save() {
  try {await OBR.scene.setMetadata({[storageKey]:{version:2,groups:groups.export()}});}
  catch {state.message="กลุ่มยังอยู่ในรอบนี้ แต่บันทึกลง Scene ไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง";}
}
async function restoreTool() {
  if(previousTool&&await OBR.tool.getActiveTool()===ID) await OBR.tool.activateTool(previousTool);
}
async function cancelPick() {state.pickingId=undefined; await restoreTool();}
async function loadScene(ready:boolean) {
  await groups.clear();
  state={...initialState,ready,gm:await OBR.player.getRole()==="GM",message:ready?"เพิ่มกลุ่มจาก Token ที่เลือก แล้วกำหนด B":"กรุณาเปิด Scene ก่อน"};
  if(ready&&state.gm) {
    const metadata=await OBR.scene.getMetadata();
    const saved=metadata[storageKey] as {version?:number;groups?:unknown}|undefined;
    if(saved?.version===2) groups.hydrate(saved.groups);
    state.selectedId=groups.views()[0]?.id;
    if(groups.size) state.message=`โหลด ${groups.size} กลุ่มแล้ว • กดเริ่มเมื่อพร้อม`;
  }
  await publish();
}
async function handle(command:Command) {
  state.gm=await OBR.player.getRole()==="GM"; state.ready=await OBR.scene.isReady();
  if(command.type==="status") {await publish(); return;}
  await requireGM();
  if(command.type==="create") {
    const items=command.capture?await selectedItems():[];
    const id=crypto.randomUUID(); groups.create(id,items); state.selectedId=id;
    state.message="เพิ่มกลุ่มใหม่แล้ว"; await save();
  } else if(command.type==="stopAll") {
    await groups.stopAll(); await cancelPick(); state.message="หยุดทุกกลุ่มแล้ว";
  } else if(command.type==="startAll") {
    if(state.pickingId) await cancelPick();
    const errors=await groups.startAll(await OBR.scene.grid.getDpi(),performance.now());
    state.message=errors.length?errors.join(" • "):"เริ่มทุกกลุ่มที่มี A/B แล้ว";
  } else if("id" in command) {
    if(!groups.has(command.id)) throw new Error("ไม่พบกลุ่มนี้");
    state.selectedId=command.id;
    if(command.type==="select") {await publish(); return;}
    if(command.type==="capture") {
      const items=await selectedItems(); await cancelPick(); groups.capture(command.id,items); state.message="บันทึก A ของกลุ่มนี้แล้ว"; await save();
    } else if(command.type==="update") {
      groups.update(command.id,command.name,command.settings); state.message="บันทึกการตั้งค่ากลุ่มแล้ว"; await save();
    } else if(command.type==="pick") {
      const g=groups.views().find(g=>g.id===command.id)!;
      if(!g.a) throw new Error("บันทึก A ให้กลุ่มนี้ก่อน");
      if(g.running) throw new Error("หยุดกลุ่มนี้ก่อนเลือก B");
      const active=await OBR.tool.getActiveTool(); if(active!==ID) previousTool=active;
      state.pickingId=command.id; state.message=`คลิกจุด B ของ ${g.name} บนแผนที่ • Esc ยกเลิก`;
      try {await OBR.tool.activateTool(ID); await OBR.tool.activateMode(ID,`${ID}/destination`);}
      catch(error) {state.pickingId=undefined; throw error;}
      await publish(); await OBR.action.close(); return;
    } else if(command.type==="destinationFromSelection") {
      const items=await selectedItems();
      if(items.length!==1) throw new Error("เลือกวัตถุอ้างอิงปลายทางเพียง 1 ชิ้น");
      await cancelPick(); groups.setB(command.id,items[0].position); state.message="ใช้ตำแหน่งวัตถุที่เลือกเป็น B แล้ว"; await save();
    } else if(command.type==="start") {
      if(state.pickingId) await cancelPick();
      await groups.start(command.id,await OBR.scene.grid.getDpi(),performance.now()); state.message="เริ่มเดินกลุ่มนี้แล้ว";
    } else if(command.type==="stop") {
      await groups.stop(command.id); if(state.pickingId===command.id) await cancelPick(); state.message="หยุดกลุ่มนี้แล้ว";
    } else if(command.type==="reset") {
      if(state.pickingId===command.id) await cancelPick(); await groups.reset(command.id); state.message="กลับ A แล้ว";
    } else if(command.type==="remove") {
      if(state.pickingId===command.id) await cancelPick(); await groups.remove(command.id);
      state.selectedId=groups.views()[0]?.id; state.message="ลบกลุ่มแล้ว • Token ยังอยู่บนแผนที่"; await save();
    }
  }
  await publish();
}

OBR.onReady(async()=>{
  try {
    const connectionId=await OBR.player.getConnectionId();
    storageKey=`${ID}/groups/${await OBR.player.getId()}`;
    previousTool=await OBR.tool.getActiveTool();
    OBR.tool.onToolChange(id=>{if(id!==ID) previousTool=id;});
    const icon=new URL("icon.svg",location.href).href;
    await OBR.tool.create({id:ID,icons:[{icon,label:"Token Move • เลือก B",filter:{roles:["GM"]}}],defaultMode:`${ID}/destination`});
    await OBR.tool.createMode({
      id:`${ID}/destination`,icons:[{icon,label:"คลิกปลายทาง B",filter:{activeTools:[ID],roles:["GM"]}}],cursors:[{cursor:"crosshair"}],
      onToolClick:(_,event)=>{
        const point={...event.pointerPosition}; const picking=state.pickingId;
        enqueue(async()=>{
          await requireGM();
          if(!picking||state.pickingId!==picking) {await OBR.action.open(); return;}
          groups.setB(picking,point); state.pickingId=undefined; await restoreTool();
          state.message="กำหนด B แล้ว • พร้อมเดิน"; await save(); await publish(); await OBR.action.open();
        });
      },
      onKeyDown:(_,event)=>{if(event.key==="Escape") enqueue(async()=>{await cancelPick();state.message="ยกเลิกการเลือก B";await publish();await OBR.action.open();});},
      onDeactivate:()=>enqueue(async()=>{if(state.pickingId){state.pickingId=undefined;state.message="ยกเลิกการเลือก B";await publish();}})
    });
    const types=["status","create","select","capture","update","pick","destinationFromSelection","start","stop","reset","remove","startAll","stopAll"];
    OBR.broadcast.onMessage(COMMAND,event=>{
      if(event.connectionId!==connectionId) return;
      const data=event.data as CommandMessage;
      const command=data?.command;
      if(typeof data?.request==="string"&&command&&types.includes(command.type)) enqueue(async()=>{state.lastRequest=data.request;await handle(command);});
    });
    OBR.scene.onReadyChange(ready=>{
      const nextEpoch=++epoch;
      enqueue(()=>loadScene(ready),nextEpoch);
    });
    OBR.player.onChange(player=>enqueue(async()=>{
      const gm=player.role==="GM";
      if(gm!==state.gm) {
        state.gm=gm;
        if(!gm) {await groups.stopAll(false);state.pickingId=undefined;state.message="เฉพาะ GM เท่านั้นที่ควบคุมได้";}
        else {await loadScene(await OBR.scene.isReady());return;}
        await publish();
      }
    }));
    OBR.scene.items.onChange(items=>{if(groups.running) enqueue(async()=>{await groups.checkItems(items);});});
    let pending=false,lastPublish=0;
    setInterval(()=>{
      if(!groups.running||pending)return;
      pending=true;
      // Always clear pending, even when a queued tick belongs to the old scene.
      const tickEpoch=epoch;
      queue=queue.then(async()=>{
        try {
          if(tickEpoch!==epoch)return;
          await groups.tick(performance.now());
          if(performance.now()-lastPublish>300||!groups.running){lastPublish=performance.now();await publish();}
        } finally {pending=false;}
      }).catch(console.error);
    },33);
    console.info(`Token Move ${VERSION}`);
    await loadScene(await OBR.scene.isReady());
  } catch(error){console.error(error);state.message="เริ่มระบบไม่สำเร็จ กรุณารีโหลดห้อง";await publish().catch(console.error);}
});
