import OBR, {buildCurve, type Item} from "@owlbear-rodeo/sdk";
import {Groups} from "./groups";
import {COMMAND, STATE, ID, VERSION, initialState, statePackets, type Command, type CommandMessage, type State, type Point} from "./shared";

let state: State = {...initialState};
let previousTool = "";
let storageKey = "";
let epoch = 0;
let queue = Promise.resolve();
let routeItems:string[]=[];
let routeSignature="";
let pickNotice:string|undefined;
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
  await drawRoute().catch(error=>console.warn("LINE preview",error));
  for (const packet of statePackets(state)) await OBR.broadcast.sendMessage(STATE,packet,{destination:"LOCAL"});
}
async function cell(point:Point):Promise<Point> {
  const requestedEpoch=epoch;
  // Fully snap to cell centres, never grid corners or the user's partial-snap preference.
  const result=await OBR.scene.grid.snapPosition(point,1,false,true);
  if(requestedEpoch!==epoch)throw new Error("Scene เปลี่ยนแล้ว กรุณาเลือกช่องใหม่");
  return result;
}
async function drawRoute() {
  const g=groups.views().find(g=>g.id===state.selectedId);
  const points=state.gm&&state.ready&&state.routeVisible!==false&&g?.a?[g.a,...(state.pickingId===g.id&&state.pickMode==="line"?(state.draft??[]):g.route??(g.b?[g.b]:[]))]:[];
  const signature=JSON.stringify([epoch,state.selectedId,points]);
  if(signature===routeSignature)return;
  routeSignature="";
  if(routeItems.length){const old=routeItems;routeItems=[];await OBR.scene.local.deleteItems(old);}
  if(points.length) {
    const dpi=await OBR.scene.grid.getDpi();
    const preview:Item[]=[];
    if(points.length>1)preview.push(buildCurve().points(points).tension(0).strokeColor("#8be6c8").strokeWidth(Math.max(2,dpi*.035)).fillOpacity(0).layer("POINTER").locked(true).disableHit(true).metadata({[`${ID}/preview`]:storageKey}).name("Token Move LINE — preview").build());
    for(const [index,p] of points.entries()) {
      const radius=dpi*.11;
      const ring=Array.from({length:12},(_,i)=>({x:p.x+Math.cos(i*Math.PI/6)*radius,y:p.y+Math.sin(i*Math.PI/6)*radius}));
      preview.push(buildCurve().points(ring).closed(true).tension(0).strokeColor(index===0?"#c6deff":"#8be6c8").strokeWidth(Math.max(1,dpi*.02)).fillColor("#8be6c8").fillOpacity(.35).layer("POINTER").locked(true).disableHit(true).metadata({[`${ID}/preview`]:storageKey}).name(`LINE ${index===0?"A":index}`).build());
    }
    await OBR.scene.local.addItems(preview);routeItems=preview.map(i=>i.id);
  }
  routeSignature=signature;
}
function enqueue(action:()=>Promise<void>, expectedEpoch=epoch) {
  queue=queue.then(async()=>{if(expectedEpoch===epoch) await action();}).catch(async error=>{
    state.message=error instanceof Error?error.message:"เกิดข้อผิดพลาด กรุณาลองใหม่";
    if(state.pickingId)await OBR.notification.show(state.message,"ERROR").catch(console.error);
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
  try {await OBR.scene.setMetadata({[storageKey]:{version:2,gridVersion:1,groups:groups.export()}});}
  catch {state.message="กลุ่มยังอยู่ในรอบนี้ แต่บันทึกลง Scene ไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง";}
}
async function restoreTool() {
  if(previousTool&&await OBR.tool.getActiveTool()===ID) await OBR.tool.activateTool(previousTool);
}
async function cancelPick() {
  state.pickingId=undefined;state.pickMode=undefined;state.draft=undefined;
  if(pickNotice){const notice=pickNotice;pickNotice=undefined;await OBR.notification.close(notice).catch(console.error);}
  await restoreTool();
}
async function finishLine() {
  await requireGM();
  if(!state.pickingId||state.pickMode!=="line")throw new Error("ยังไม่ได้เริ่มเลือกช่อง LINE");
  const id=state.pickingId;
  groups.setPath(id,state.draft??[]);
  const count=state.draft?.length??0;
  await cancelPick();state.message=`บันทึก LINE ${count} จุดแล้ว • Loop จะย้อนตามเส้นเดิม`;
  await save();await publish();await OBR.action.open();
}
async function loadScene(ready:boolean) {
  state.pickingId=undefined;state.pickMode=undefined;state.draft=undefined;
  if(pickNotice){await OBR.notification.close(pickNotice).catch(console.error);pickNotice=undefined;}
  if(routeItems.length){await OBR.scene.local.deleteItems(routeItems).catch(console.error);routeItems=[];}
  if(ready) {
    // Local preview drawings may outlive an extension-frame reload. Remove only ours.
    const old=await OBR.scene.local.getItems(i=>i.metadata[`${ID}/preview`]===storageKey);
    if(old.length)await OBR.scene.local.deleteItems(old.map(i=>i.id));
  }
  routeSignature="";
  await groups.clear();
  state={...initialState,routeVisible:true,ready,gm:await OBR.player.getRole()==="GM",message:ready?"เพิ่มกลุ่ม แล้วเลือกช่อง B หรือสร้าง LINE":"กรุณาเปิด Scene ก่อน"};
  if(ready&&state.gm) {
    const metadata=await OBR.scene.getMetadata();
    const saved=metadata[storageKey] as {version?:number;gridVersion?:number;groups?:unknown}|undefined;
    if(saved?.version===2) groups.hydrate(saved.groups);
    let migrated=false,needsB=false;
    // Upgrade the user's existing 2.0 destinations once; keep A and group membership.
    if(saved?.version===2&&saved.gridVersion!==1) {
      for(const g of groups.views())if(g.b&&!g.route&&g.a) {
        const destination=await cell(g.b);
        if(Math.hypot(destination.x-g.a.x,destination.y-g.a.y)<.01){groups.clearDestination(g.id);needsB=true;}
        else groups.setB(g.id,destination);
        migrated=true;
      }
    }
    state.selectedId=groups.views()[0]?.id;
    if(groups.size) state.message=`โหลด ${groups.size} กลุ่มแล้ว • กดเริ่มเมื่อพร้อม`;
    if(migrated){state.message=needsB?"ปรับ B เดิมเข้าช่องแล้ว • กลุ่มที่ A/B ช่องเดียวกันต้องเลือก B ใหม่":"ปรับ B เดิมทุกกลุ่มเข้ากึ่งกลางช่องแล้ว";await save();}
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
    if(command.type==="select") {if(state.pickingId&&state.pickingId!==command.id)await cancelPick();await publish(); return;}
    if(command.type==="capture") {
      const items=await selectedItems(); await cancelPick(); groups.capture(command.id,items); state.message="บันทึก A ของกลุ่มนี้แล้ว"; await save();
    } else if(command.type==="update") {
      groups.update(command.id,command.name,command.settings); state.message="บันทึกการตั้งค่ากลุ่มแล้ว"; await save();
    } else if(command.type==="pick"||command.type==="pickLine") {
      const g=groups.views().find(g=>g.id===command.id)!;
      if(!g.a) throw new Error("บันทึก A ให้กลุ่มนี้ก่อน");
      if(g.running) throw new Error("หยุดกลุ่มนี้ก่อนเลือกช่องเดิน");
      if(state.pickingId)await cancelPick();
      const active=await OBR.tool.getActiveTool(); if(active!==ID) previousTool=active;
      state.pickingId=command.id;state.pickMode=command.type==="pickLine"?"line":"destination";state.draft=[];state.routeVisible=true;
      state.message=state.pickMode==="line"?"LINE: คลิกช่องตามลำดับ • Enter บันทึก • Backspace ย้อน 1 จุด • Esc ยกเลิก":"คลิกช่อง B • ระบบเลือกกึ่งกลางช่อง • Esc ยกเลิก";
      try {await OBR.tool.activateTool(ID); await OBR.tool.activateMode(ID,`${ID}/destination`);}
      catch(error) {await cancelPick();throw error;}
      pickNotice=await OBR.notification.show(state.message,"INFO");
      await publish(); await OBR.action.close(); return;
    } else if(command.type==="finishLine") {
      await finishLine();return;
    } else if(command.type==="undoLine") {
      if(state.pickingId!==command.id||state.pickMode!=="line")throw new Error("ยังไม่ได้เลือก LINE ของกลุ่มนี้");
      state.draft?.pop();state.message=`LINE ${state.draft?.length??0} จุด • คลิกเพิ่ม หรือ Enter บันทึก`;
    } else if(command.type==="cancelPick") {
      await cancelPick();state.message="ยกเลิกแล้ว • เส้นทางเดิมยังอยู่";
    } else if(command.type==="showRoute") {
      state.routeVisible=state.routeVisible===false;state.message=state.routeVisible?"แสดงเส้นทางเฉพาะคุณ":"ซ่อนเส้นทางแล้ว";
    } else if(command.type==="destinationFromSelection") {
      const items=await selectedItems();
      if(items.length!==1) throw new Error("เลือกวัตถุอ้างอิงปลายทางเพียง 1 ชิ้น");
      const destination=await cell(items[0].position);
      await cancelPick(); groups.setB(command.id,destination); state.message="ล็อค B ที่กึ่งกลางช่องของวัตถุที่เลือกแล้ว"; await save();
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
    await OBR.tool.create({id:ID,icons:[{icon,label:"Token Move • เลือกช่อง / LINE",filter:{roles:["GM"]}}],defaultMode:`${ID}/destination`});
    await OBR.tool.createMode({
      id:`${ID}/destination`,icons:[{icon,label:"คลิกปลายทาง B",filter:{activeTools:[ID],roles:["GM"]}}],cursors:[{cursor:"crosshair"}],
      onToolClick:(_,event)=>{
        const point={...event.pointerPosition}; const picking=state.pickingId;
        enqueue(async()=>{
          await requireGM();
          if(!picking||state.pickingId!==picking) {await OBR.action.open(); return;}
          const destination=await cell(point);
          if(state.pickMode==="line") {
            const draft=state.draft??[];const last=draft[draft.length-1]??groups.views().find(g=>g.id===picking)?.a;
            if(last&&Math.hypot(last.x-destination.x,last.y-destination.y)<.01)return;
            if(draft.length>=500)throw new Error("LINE นี้มี 500 จุดแล้ว กด Enter เพื่อบันทึก");
            state.draft=[...draft,destination];state.message=`LINE ${state.draft.length} จุด • คลิกช่องต่อไป • Enter บันทึก`;
            await publish();return;
          }
          groups.setB(picking,destination);await cancelPick();
          state.message="ล็อค B ที่กึ่งกลางช่องแล้ว • พร้อมเดิน"; await save(); await publish(); await OBR.action.open();
        });
      },
      onKeyDown:(_,event)=>{
        if(event.key==="Escape")enqueue(async()=>{await cancelPick();state.message="ยกเลิกแล้ว • เส้นทางเดิมยังอยู่";await publish();await OBR.action.open();});
        else if(event.key==="Enter"&&state.pickMode==="line")enqueue(finishLine);
        else if(event.key==="Backspace"&&state.pickMode==="line")enqueue(async()=>{state.draft?.pop();state.message=`LINE ${state.draft?.length??0} จุด • Enter บันทึก`;await publish();});
      },
      onDeactivate:()=>enqueue(async()=>{if(state.pickingId){await cancelPick();state.message="ยกเลิกแล้ว • เส้นทางเดิมยังอยู่";await publish();}})
    });
    const types=["status","create","select","capture","update","pick","pickLine","finishLine","undoLine","cancelPick","showRoute","destinationFromSelection","start","stop","reset","remove","startAll","stopAll"];
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
        if(!gm) {await groups.stopAll(false);await cancelPick();state.message="เฉพาะ GM เท่านั้นที่ควบคุมได้";}
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
