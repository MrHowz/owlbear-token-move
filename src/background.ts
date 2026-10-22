import OBR, {buildCurve, buildText, type Item} from "@owlbear-rodeo/sdk";
import {selectionRoots,followAttachments} from "./attachments";
import {Groups} from "./groups";
import {OrderedPublisher} from "./publisher";
import {COMMAND, STATE, ID, VERSION, initialState, statePackets, type Command, type CommandMessage, type State, type Point, type StatePacket} from "./shared";

let state: State = {...initialState};
let previousTool = "";
let storageKey = "";
let epoch = 0;
let queue = Promise.resolve();
let routeItems:string[]=[];
let routeSignature="";
let pickNotice:string|undefined;
let previewPending=false,previewRunning=false;
const publisher=new OrderedPublisher<StatePacket[]>(async packets=>{
  for(const packet of packets)await OBR.broadcast.sendMessage(STATE,packet,{destination:"LOCAL"});
});
const groups = new Groups({
  read: async ids => {
    const requestedEpoch=epoch; const items=await OBR.scene.items.getItems(ids);
    if (requestedEpoch!==epoch) throw new Error("Scene เปลี่ยนแล้ว กรุณาลองใหม่");
    return items;
  },
  interact: async items => {
    const requestedEpoch=epoch,ids=new Set(items.map(i=>i.id));
    const all=await OBR.scene.items.getItemAttachments([...ids]);
    if(requestedEpoch!==epoch)throw new Error("Scene เปลี่ยนแล้ว");
    const before=structuredClone(all),byId=new Map(items.map(i=>[i.id,i]));
    const expanded=all.map(i=>byId.get(i.id)??i);
    followAttachments(expanded,before,ids);
    const live=await OBR.interaction.startItemInteraction(expanded);
    if(requestedEpoch!==epoch){live[1]();throw new Error("Scene เปลี่ยนแล้ว");}
    return [(recipe:(draft:Item[])=>void)=>{const updated=live[0](draft=>{
      const before=draft.map(i=>({...i,position:{...i.position},scale:{...i.scale}}));
      recipe(items.map(root=>draft.find(i=>i.id===root.id)!));
      followAttachments(draft,before,ids);
    });return items.map(root=>updated.find(i=>i.id===root.id)!);},live[1]];
  },
  edit: async (ids,recipe)=>{
    const requestedEpoch=epoch;
    await OBR.scene.items.updateItems(ids,draft=>{if(requestedEpoch===epoch)recipe(draft);});
  },
  commit: items => {
    const byId=new Map(items.map(i=>[i.id,i]));
    return OBR.scene.items.updateItems(items.map(i=>i.id),draft=>draft.forEach(item=>{
      const value=byId.get(item.id);
      if (value&&!item.locked&&!item.attachedTo) {item.position={...value.position}; item.scale={...value.scale};if(Number.isFinite(value.rotation))item.rotation=value.rotation;}
    }));
  }
},()=>performance.now());
function requestPreview() {
  previewPending=true;
  if(previewRunning)return;
  previewRunning=true;
  void (async()=>{
    try {while(previewPending){previewPending=false;await drawRoute();}}
    catch(error){console.warn("LINE preview",error);}
    finally{previewRunning=false;}
  })();
}
function publish(updatePreview=true) {
  state.groups=groups.views();
  const packets=statePackets(state);
  if(updatePreview)requestPreview();
  return publisher.publish(packets);
}
async function cell(point:Point):Promise<Point> {
  const requestedEpoch=epoch;
  // Fully snap to cell centres, never grid corners or the user's partial-snap preference.
  const result=await OBR.scene.grid.snapPosition(point,1,false,true);
  if(requestedEpoch!==epoch)throw new Error("Scene เปลี่ยนแล้ว กรุณาเลือกช่องใหม่");
  return result;
}
async function drawRoute() {
  const drawingEpoch=epoch;
  const g=groups.views().find(g=>g.id===state.selectedId);
  const points=state.gm&&state.ready&&state.routeVisible!==false&&g?(state.pickingId===g.id&&state.pickMode==="line"?(state.draft??[]):g.settings.movement==="stationary"?[]:g.route??[]):[];
  const signature=JSON.stringify([epoch,state.selectedId,points]);
  if(signature===routeSignature)return;
  routeSignature="";
  if(routeItems.length){const old=routeItems;routeItems=[];await OBR.scene.local.deleteItems(old);}
  if(drawingEpoch!==epoch)return;
  if(points.length) {
    const dpi=await OBR.scene.grid.getDpi();
    if(drawingEpoch!==epoch)return;
    const preview:Item[]=[];
    if(points.length>1)preview.push(buildCurve().points(points).tension(0).strokeColor("#8be6c8").strokeWidth(Math.max(2,dpi*.035)).fillOpacity(0).layer("POINTER").locked(true).disableHit(true).metadata({[`${ID}/preview`]:storageKey}).name("Token Move LINE — preview").build());
    for(const [index,p] of points.entries()) {
      const radius=dpi*.13;
      const ring=Array.from({length:12},(_,i)=>({x:p.x+Math.cos(i*Math.PI/6)*radius,y:p.y+Math.sin(i*Math.PI/6)*radius}));
      preview.push(buildCurve().points(ring).closed(true).tension(0).strokeColor(index===0?"#b9e7ff":"#8be6c8").strokeWidth(Math.max(1,dpi*.02)).fillColor(index===0?"#b9e7ff":"#8be6c8").fillOpacity(.35).layer("POINTER").locked(true).disableHit(true).metadata({[`${ID}/preview`]:storageKey}).name(`LINE ${index===0?"เริ่ม":index+1}`).build());
    }
    const badge=(value:string,p:Point,size:number,name:string)=>buildText().plainText(value).textType("PLAIN").position(p).fontSize(size).fontWeight(700).fillColor("#ffffff").strokeColor("#101820").strokeWidth(Math.max(1,dpi*.018)).width("AUTO").height("AUTO").padding(0).layer("POINTER").zIndex(Date.now()+1000).locked(true).disableHit(true).metadata({[`${ID}/preview`]:storageKey}).name(name).build();
    for(const [index,p]of points.entries()){
      const repeated=points.slice(0,index).filter(other=>Math.hypot(other.x-p.x,other.y-p.y)<.01).length;
      preview.push(badge(String(index+1),{x:p.x+dpi*.18,y:p.y-dpi*(.40+repeated*.34)},dpi*.28,`LINE จุด ${index+1}${index===0?" เริ่ม":""}`));
    }
    await OBR.scene.local.addItems(preview);
    if(drawingEpoch!==epoch){await OBR.scene.local.deleteItems(preview.map(i=>i.id));return;}
    routeItems=preview.map(i=>i.id);
  }
  routeSignature=signature;
}
function enqueue(action:()=>Promise<void>, expectedEpoch=epoch) {
  queue=queue.then(async()=>{if(expectedEpoch===epoch) await action();}).catch(async error=>{
    state.message=error instanceof Error?error.message:"เกิดข้อผิดพลาด กรุณาลองใหม่";
    state.error=state.message;
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
  return selectionRoots(await OBR.scene.items.getItems(ids),await OBR.scene.items.getItems());
}
async function save() {
  try {await OBR.scene.setMetadata({[storageKey]:{version:3,gridVersion:1,groups:groups.export()}});}
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
  await cancelPick();state.message=`บันทึก LINE ${count} จุดแล้ว • พร้อมเริ่มเดิน`;
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
  state={...initialState,routeVisible:true,ready,gm:await OBR.player.getRole()==="GM",message:ready?"เลือก Token แล้วเพิ่มกลุ่มเพื่อสร้าง LINE":"กรุณาเปิด Scene ก่อน"};
  if(ready&&state.gm) {
    state.gridDpi=await OBR.scene.grid.getDpi();
    const metadata=await OBR.scene.getMetadata();
    const saved=metadata[storageKey] as {version?:number;gridVersion?:number;groups?:unknown}|undefined;
    if(saved?.version===2||saved?.version===3)groups.hydrate(saved.groups,saved.version);
    if(saved?.version===2&&saved.gridVersion!==1)for(const g of groups.views())if(g.route){
      const points:Point[]=[];for(const p of g.route)points.push(await cell(p));
      try{groups.setPath(g.id,points);}catch{groups.clearRoute(g.id);}
    }
    state.selectedId=groups.views()[0]?.id;
    if(groups.size) state.message=`โหลด ${groups.size} กลุ่มแล้ว • กดเริ่มเมื่อพร้อม`;
    if(saved?.version===2){state.message="แปลงกลุ่มเดิมเป็น LINE แล้ว • เปลี่ยนช่องเริ่มได้เลย";await save();}
  }
  await publish();
}
async function handle(command:Command) {
  state.gm=await OBR.player.getRole()==="GM"; state.ready=await OBR.scene.isReady();
  if(command.type==="status") {await publish(); return;}
  await requireGM();
  if(command.type==="create") {
    const items=await selectedItems();
    const id=crypto.randomUUID(); groups.create(id,items); state.selectedId=id;
    state.message="เพิ่มกลุ่มใหม่แล้ว"; await save();
  } else if(command.type==="stopAll") {
    await groups.stopAll(); await cancelPick(); state.message="หยุดทุกกลุ่มแล้ว";
  } else if(command.type==="startAll") {
    if(state.pickingId) await cancelPick();
    const errors=await groups.startAll(await OBR.scene.grid.getDpi(),performance.now());
    state.message=errors.length?errors.join(" • "):"เริ่มทุกกลุ่มที่พร้อมแล้ว";
  } else if("id" in command) {
    if(!groups.has(command.id)) throw new Error("ไม่พบกลุ่มนี้");
    state.selectedId=command.id;
    if(command.type==="select") {if(state.pickingId&&state.pickingId!==command.id)await cancelPick();await publish(); return;}
    if(command.type==="capture") {
      const items=await selectedItems(); await cancelPick(); groups.capture(command.id,items); state.message="เปลี่ยน Token แล้ว • LINE เดิมยังอยู่"; await save();
    } else if(command.type==="update") {
      groups.update(command.id,command.name,command.settings); state.message="บันทึกการตั้งค่ากลุ่มแล้ว"; await save();
    } else if(command.type==="pickStart"||command.type==="pickLine") {
      const g=groups.views().find(g=>g.id===command.id)!;
      if(!g.count)throw new Error("เลือก Token ให้กลุ่มนี้ก่อน");
      if(command.type==="pickStart"&&!g.route)throw new Error("สร้าง LINE ก่อนเปลี่ยนช่องเริ่ม");
      if(g.running) throw new Error("หยุดกลุ่มนี้ก่อนเลือกช่องเดิน");
      if(state.pickingId)await cancelPick();
      const active=await OBR.tool.getActiveTool(); if(active!==ID) previousTool=active;
      state.pickingId=command.id;state.pickMode=command.type==="pickLine"?"line":"start";state.draft=[];state.routeVisible=true;
      state.message=state.pickMode==="line"?"คลิกช่องเริ่ม → ช่องถัดไป • คลิกช่องล่าสุดซ้ำหรือ Enter เพื่อบันทึก • Esc ยกเลิก":"คลิกช่องเริ่มใหม่ของ LINE • จุดอื่นคงเดิม • Esc ยกเลิก";
      try {await OBR.tool.activateTool(ID); await OBR.tool.activateMode(ID,`${ID}/line`);}
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
    } else if(command.type==="start") {
      if(state.pickingId) await cancelPick();
      await groups.start(command.id,await OBR.scene.grid.getDpi(),performance.now()); state.message="เริ่มกลุ่มนี้แล้ว";
    } else if(command.type==="stop") {
      await groups.stop(command.id); if(state.pickingId===command.id) await cancelPick(); state.message="หยุดกลุ่มนี้แล้ว";
    } else if(command.type==="reset") {
      if(state.pickingId===command.id) await cancelPick(); await groups.reset(command.id); state.message="คืนตำแหน่ง/ท่าเริ่มแล้ว";
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
    await OBR.tool.create({id:ID,icons:[{icon,label:"Token Move • LINE",filter:{roles:["GM"]}}],defaultMode:`${ID}/line`});
    await OBR.tool.createMode({
      id:`${ID}/line`,icons:[{icon,label:"เลือกช่อง LINE",filter:{activeTools:[ID],roles:["GM"]}}],cursors:[{cursor:"crosshair"}],
      onToolClick:(_,event)=>{
        const point={...event.pointerPosition}; const picking=state.pickingId;
        enqueue(async()=>{
          await requireGM();
          if(!picking||state.pickingId!==picking) {await OBR.action.open(); return;}
          const destination=await cell(point);
          if(state.pickMode==="line") {
            const draft=state.draft??[],last=draft.at(-1);
            if(last&&Math.hypot(last.x-destination.x,last.y-destination.y)<.01){if(draft.length>=2)await finishLine();return;}
            if(draft.length>=501)throw new Error("LINE นี้มี 501 จุดแล้ว กด Enter เพื่อบันทึก");
            state.draft=[...draft,destination];state.message=draft.length?`LINE ${state.draft.length} จุด • คลิกจุดล่าสุดซ้ำเพื่อบันทึก` : "เลือกช่องเริ่มแล้ว • คลิกช่องถัดไป";
            await publish();return;
          }
          groups.setStart(picking,destination);await cancelPick();
          state.message="เปลี่ยนช่องเริ่มของ LINE แล้ว"; await save(); await publish(); await OBR.action.open();
        });
      },
      onKeyDown:(_,event)=>{
        if(event.key==="Escape")enqueue(async()=>{await cancelPick();state.message="ยกเลิกแล้ว • เส้นทางเดิมยังอยู่";await publish();await OBR.action.open();});
        else if(event.key==="Enter"&&state.pickMode==="line")enqueue(finishLine);
        else if(event.key==="Backspace"&&state.pickMode==="line")enqueue(async()=>{state.draft?.pop();state.message=`LINE ${state.draft?.length??0} จุด • Enter บันทึก`;await publish();});
      },
      onDeactivate:()=>enqueue(async()=>{if(state.pickingId){await cancelPick();state.message="ยกเลิกแล้ว • เส้นทางเดิมยังอยู่";await publish();}})
    });
    const types=["status","create","select","capture","update","pickStart","pickLine","finishLine","undoLine","cancelPick","showRoute","start","stop","reset","remove","startAll","stopAll"];
    OBR.broadcast.onMessage(COMMAND,event=>{
      if(event.connectionId!==connectionId) return;
      const data=event.data as CommandMessage;
      const command=data?.command;
      if(typeof data?.request==="string"&&command&&types.includes(command.type)) enqueue(async()=>{state.lastRequest=data.request;state.error=undefined;await handle(command);});
    });
    OBR.scene.onReadyChange(ready=>{
      const nextEpoch=++epoch;
      state.ready=false;
      // Scene cancellation must also bypass slow commands or status acknowledgements.
      void groups.stopAll(false).catch(console.error);
      enqueue(()=>loadScene(ready),nextEpoch);
    });
    OBR.player.onChange(player=>{
      const gm=player.role==="GM";
      if(gm===state.gm)return;
      state.gm=gm;
      if(!gm)void groups.stopAll(false).catch(console.error);
      enqueue(async()=>{
        if(state.gm!==gm)return;
        if(!gm) {await cancelPick();state.message="เฉพาะ GM เท่านั้นที่ควบคุมได้";}
        else {await loadScene(await OBR.scene.isReady());return;}
        await publish();
      });
    });
    OBR.scene.grid.onChange(grid=>enqueue(async()=>{state.gridDpi=grid.dpi;await publish();}));
    OBR.scene.items.onChange(items=>{if(groups.running) enqueue(async()=>{await groups.checkItems(items);});});
    let lastPublish=0;
    setInterval(()=>{
      if(!groups.running||!state.ready||!state.gm)return;
      const now=performance.now();
      // Position updates execute immediately. Network checkpoints/status never own this clock.
      const frame=groups.tick(now);void frame.catch(console.error);
      if(now-lastPublish>300&&!publisher.busy){
        lastPublish=now;
        enqueue(async()=>{if(!publisher.busy)void publish(false).catch(console.error);});
      }
      if(!groups.running)void frame.then(()=>enqueue(async()=>{void publish(false).catch(console.error);})).catch(console.error);
    },1000/60);
    console.info(`Token Move ${VERSION}`);
    await loadScene(await OBR.scene.isReady());
  } catch(error){console.error(error);state.message="เริ่มระบบไม่สำเร็จ กรุณารีโหลดห้อง";await publish().catch(console.error);}
});
