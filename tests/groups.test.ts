import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {Groups} from "../src/groups";
import {defaultSettings, initialState, statePackets, validateConfig} from "../src/shared";
import type {MotionAdapter} from "../src/motion";
function fixture(){
  const scene=new Map<string,Item>(["one","two","three"].map((id,i)=>[id,{id,name:id,type:"IMAGE",position:{x:0,y:i*100},scale:{x:2,y:3},rotation:25,locked:false} as Item]));
  const active=new Map<string,Item>();let writes=0;
  const adapter:MotionAdapter={read:async ids=>structuredClone([...scene.values()].filter(i=>ids.includes(i.id)).reverse()),
    commit:async items=>{writes++;for(const i of items)if(scene.has(i.id))scene.set(i.id,structuredClone(i));},
    interact:async items=>{let current=structuredClone(items);return [recipe=>{current=structuredClone(current);recipe(current);for(const i of current)active.set(i.id,structuredClone(i));return structuredClone(current);},()=>{}];}};
  return {g:new Groups(adapter),adapter,scene,active,writes:()=>writes,items:(ids:string[])=>ids.map(id=>structuredClone(scene.get(id)!))};
}
function near(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-7,`${actual} ≈ ${expected}`);}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

test("independent groups use their own chosen starts, speeds and member offsets",async()=>{
  const f=fixture(),g=f.g;
  g.create("a",f.items(["one","two"]));g.setPath("a",[{x:500,y:600},{x:900,y:600}]);
  g.create("b",f.items(["three"]));g.setPath("b",[{x:1000,y:200},{x:1400,y:200}]);g.update("b","slow",{...defaultSettings,speed:1});
  assert.equal(f.writes(),0);await g.startAll(100,0);
  assert.deepEqual(f.scene.get("one")!.position,{x:500,y:600});assert.deepEqual(f.scene.get("two")!.position,{x:500,y:700});
  await g.tick(500);near(f.active.get("one")!.position.x,600);near(f.active.get("three")!.position.x,1050);
  await g.stop("a");await g.tick(1000);near(f.scene.get("one")!.position.x,600);near(f.active.get("three")!.position.x,1100);
});
test("changing the start preserves later cells and does not move tokens before Start",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one","two"]));
  g.setPath("a",[{x:150,y:150},{x:250,y:150},{x:250,y:250}]);g.setStart("a",{x:50,y:150});
  assert.deepEqual(g.views()[0].route,[{x:50,y:150},{x:250,y:150},{x:250,y:250}]);assert.equal(f.writes(),0);
  await g.start("a",100,0);assert.deepEqual(f.active.get("one")!.position,{x:50,y:150});
  assert.deepEqual(f.active.get("two")!.position,{x:50,y:250});
});
test("a LINE needs a start plus another cell; invalid edits preserve the previous path",()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));
  assert.throws(()=>g.setPath("a",[{x:1,y:1}]));assert.throws(()=>g.setPath("a",[{x:1,y:1},{x:1,y:1}]));
  g.setPath("a",[{x:0,y:0},{x:100,y:0}]);assert.throws(()=>g.setStart("a",{x:100,y:0}));assert.throws(()=>g.setPath("a",[{x:NaN,y:0},{x:100,y:0}]));
  assert.deepEqual(g.views()[0].route,[{x:0,y:0},{x:100,y:0}]);
});
test("overlapping groups cannot drive or reset the same token at the same time",async()=>{
  const f=fixture(),g=f.g;for(const id of ["a","b"]){g.create(id,f.items(["one"]));g.setPath(id,[{x:50,y:50},{x:250,y:50}]);}
  await g.start("a",100,0);await assert.rejects(g.start("b",100,0),/Token ซ้ำ/);await assert.rejects(g.reset("b"),/หยุดกลุ่มอื่น/);
  assert.equal((await g.startAll(100,0)).length,1);assert.equal(g.views().filter(v=>v.running).length,1);
});
test("reset uses the chosen LINE start and restores flip and rotation",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:500,y:500},{x:600,y:500}]);
  g.update("a","guard",{...defaultSettings,speed:1});await g.start("a",100,0);await g.tick(1000);await g.stop("a");assert.equal(f.scene.get("one")!.scale.x,-2);
  await g.reset("a");assert.deepEqual(f.scene.get("one")!.position,{x:500,y:500});assert.deepEqual(f.scene.get("one")!.scale,{x:2,y:3});assert.equal(f.scene.get("one")!.rotation,25);
});
test("pause and resume continue from the paused segment instead of teleporting to start",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:500,y:500},{x:900,y:500}]);g.update("a","guard",{...defaultSettings,speed:1});
  await g.start("a",100,0);await g.tick(500);await g.stop("a");const writes=f.writes();
  await g.start("a",100,1000);assert.equal(f.writes(),writes);near(f.active.get("one")!.position.x,550);
  await g.tick(1500);near(f.active.get("one")!.position.x,600);
});
test("a completed one-way LINE can begin a new round from its chosen start",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:250,y:250},{x:350,y:250}]);g.update("a","guard",{...defaultSettings,speed:1,mode:"once"});
  await g.start("a",100,0);await g.tick(1000);assert.equal(g.running,false);assert.equal(f.scene.get("one")!.position.x,350);
  await g.start("a",100,2000);assert.equal(f.active.get("one")!.position.x,250);await g.tick(3000);assert.equal(f.scene.get("one")!.position.x,350);
});
test("changing members preserves the LINE and gives the new members their selected spacing",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));const path=[{x:500,y:500},{x:700,y:500}];g.setPath("a",path);g.capture("a",f.items(["two","three"]));
  assert.deepEqual(g.views()[0].route,path);await g.start("a",100,0);assert.deepEqual(f.active.get("two")!.position,{x:500,y:500});assert.deepEqual(f.active.get("three")!.position,{x:500,y:600});
});
test("new saved routes preserve their chosen origin and load without auto-starting",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one","two"]));g.setPath("a",[{x:500,y:600},{x:800,y:600}]);g.update("a","ยาม 🦉",{...defaultSettings,facing:"left"});await g.start("a",100,0);
  const configs=g.export();assert.equal(validateConfig(configs[0]),true);const restored=new Groups(f.adapter);restored.hydrate([...configs,{id:"bad"},configs[0]]);
  assert.equal(restored.size,1);assert.equal(restored.running,false);assert.deepEqual(restored.views()[0].route,configs[0].route);configs[0].route![0].x=999;assert.equal(restored.views()[0].route![0].x,500);
});
test("legacy direct routes and LINE routes migrate into a single full LINE format",()=>{
  const f=fixture();const anchors=f.items(["one"]).map(({id,name,type,position,scale})=>({id,name,type,position,scale}));
  f.g.hydrate([{id:"direct",name:"direct",anchors,b:{x:100,y:0},settings:defaultSettings},{id:"line",name:"line",anchors,b:{x:100,y:100},route:[{x:100,y:0},{x:100,y:100}],settings:defaultSettings}],2);
  assert.deepEqual(f.g.views().map(g=>g.route),[[{x:0,y:0},{x:100,y:0}],[{x:0,y:0},{x:100,y:0},{x:100,y:100}]]);
  assert.equal("b" in f.g.export()[0],false);f.g.setStart("direct",{x:50,y:50});assert.equal(f.g.running,false);
});
test("legacy same-cell endpoints keep members but need a fresh LINE; corrupt paths are ignored",()=>{
  const f=fixture(),anchors=f.items(["one"]);f.g.hydrate([{id:"same",name:"same",anchors,b:{x:0,y:0},settings:defaultSettings},{id:"bad",name:"bad",anchors,b:{x:200,y:0},route:[{x:100,y:0}],settings:defaultSettings}],2);
  assert.equal(f.g.size,1);assert.equal(f.g.views()[0].count,1);assert.equal(f.g.views()[0].route,undefined);
});
test("locking or deleting tokens stops only the affected group",async()=>{
  const f=fixture(),g=f.g;for(const [id,token,y]of [["a","one",0],["b","two",100]] as const){g.create(id,f.items([token]));g.setPath(id,[{x:0,y},{x:200,y}]);}
  await g.startAll(100,0);f.scene.get("one")!.locked=true;await g.checkItems([...f.scene.values()]);assert.equal(g.views()[0].running,false);assert.equal(g.views()[1].running,true);
  f.scene.delete("two");await g.checkItems([...f.scene.values()]);assert.equal(g.running,false);
});
test("attached children follow their selected parent and locked roots are rejected",()=>{
  const f=fixture();f.scene.get("two")!.attachedTo="one";f.g.create("a",f.items(["one","two"]));assert.equal(f.g.views()[0].count,1);
  assert.throws(()=>f.g.create("b",f.items(["two"])),/วัตถุหลัก/);f.scene.get("three")!.locked=true;assert.throws(()=>f.g.create("c",f.items(["three"])),/ปลดล็อก/);assert.equal(f.g.size,1);
});
test("running groups reject route edits while unrelated groups may be added and removed",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:0,y:0},{x:200,y:0}]);await g.start("a",100,0);
  assert.throws(()=>g.setStart("a",{x:100,y:0}),/หยุดกลุ่ม/);assert.throws(()=>g.capture("a",f.items(["two"])),/หยุดกลุ่ม/);assert.throws(()=>g.update("a","bad",defaultSettings),/หยุดกลุ่ม/);
  g.create("b",f.items(["two"]));await g.remove("b");assert.equal(g.running,true);assert.equal(f.scene.size,3);
});
test("hundreds of groups fit bounded state packets without losing Thai names",()=>{
  const f=fixture();for(let i=0;i<400;i++){f.g.create(`g${i}`);f.g.update(`g${i}`,"กลุ่มเดินลาดตระเวน 🦉 "+i,defaultSettings);}
  const state={...initialState,groups:f.g.views()},packets=statePackets(state);assert.ok(packets.length>1);for(const p of packets)assert.ok(new TextEncoder().encode(JSON.stringify(p)).length<16384);
  assert.equal(packets.map(p=>p.data).join(""),JSON.stringify(state));
});
test("a slow final commit in one group does not stall or rewind another group",{timeout:2000},async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:0,y:0},{x:200,y:0}]);g.update("a","once",{...defaultSettings,mode:"once"});
  g.create("b",f.items(["three"]));g.setPath("b",[{x:0,y:200},{x:400,y:200}]);g.update("b","slow",{...defaultSettings,speed:1});await g.startAll(100,0);
  const blocked=gate(),started=gate(),commit=f.adapter.commit;
  f.adapter.commit=async items=>{if(items.some(i=>i.id==="one")){started.release();await blocked.promise;}await commit(items);};
  const frame=g.tick(1000);await started.promise;assert.equal(g.views()[0].running,false);near(f.active.get("three")!.position.x,100);
  await g.tick(1100);near(f.active.get("three")!.position.x,110);blocked.release();await frame;near(f.active.get("three")!.position.x,110);
});
test("scene cancellation during initial placement cannot start a stale LINE",{timeout:2000},async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:500,y:500},{x:700,y:500}]);
  const blocked=gate(),started=gate(),commit=f.adapter.commit;f.adapter.commit=async items=>{started.release();await blocked.promise;await commit(items);};
  const starting=g.start("a",100,0);await started.promise;await g.stopAll(false);blocked.release();await assert.rejects(starting,/ยกเลิก/);assert.equal(g.running,false);
});

test("stationary effects need no LINE and start from the current pose rather than captured positions",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one","two"]));g.update("a","idle",{...defaultSettings,movement:"stationary",effect:"wiggle"});
  f.scene.get("one")!.position={x:700,y:800};f.scene.get("one")!.rotation=41;
  await g.start("a",100,0);await g.tick(1000/6);near(f.active.get("one")!.rotation,49);assert.deepEqual(f.active.get("one")!.position,{x:700,y:800});assert.equal(g.views()[0].route,undefined);
  await g.stop("a");assert.equal(f.scene.get("one")!.rotation,41);assert.deepEqual(f.scene.get("one")!.position,{x:700,y:800});
});

test("stationary and LINE groups run independently and stopAll restores effect poses",async()=>{
  const f=fixture(),g=f.g;g.create("idle",f.items(["one"]));g.update("idle","shake",{...defaultSettings,movement:"stationary",effect:"shake"});
  g.create("walk",f.items(["two"]));g.setPath("walk",[{x:0,y:100},{x:500,y:100}]);g.update("walk","walk",{...defaultSettings,speed:1,effect:"wiggle"});
  assert.deepEqual(await g.startAll(100,0),[]);await g.tick(333);assert.equal(g.views().filter(g=>g.running).length,2);
  await g.stop("idle");await g.tick(500);assert.equal(g.views()[1].running,true);near(f.active.get("two")!.position.x,50);
  await g.stopAll();assert.deepEqual(f.scene.get("one")!.position,{x:0,y:0});assert.equal(f.scene.get("two")!.rotation,25);near(f.scene.get("two")!.position.x,50);
});

test("switching between stationary and LINE preserves the saved path and restarts it cleanly",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));const route=[{x:500,y:500},{x:700,y:500}];g.setPath("a",route);await g.start("a",100,0);await g.tick(250);await g.stop("a");
  g.update("a","idle",{...defaultSettings,movement:"stationary",effect:"wiggle"});await g.start("a",100,1000);await g.tick(1200);await g.stop("a");assert.deepEqual(g.views()[0].route,route);
  g.update("a","walk",{...defaultSettings,effect:"wiggle"});await g.start("a",100,2000);assert.deepEqual(f.active.get("one")!.position,route[0]);assert.equal(f.active.get("one")!.rotation,25);
});

test("effect settings persist, old groups default to plain LINE, and reload never auto-starts",()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.update("a","idle",{...defaultSettings,movement:"stationary",effect:"wiggle",wiggleAngle:20,effectSpeed:2});
  const old={...g.export()[0],id:"old",settings:{speed:1,mode:"once",smooth:false,flip:false,facing:"left"}};
  const restored=new Groups(f.adapter);restored.hydrate([...g.export(),old]);assert.equal(restored.size,2);assert.equal(restored.running,false);assert.equal(restored.views()[0].settings.wiggleAngle,20);assert.equal(restored.views()[1].settings.effect,"none");assert.equal(restored.views()[1].settings.movement,"line");
});

test("stationary groups cannot overlap active LINE groups and need an actual effect",async()=>{
  const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:0,y:0},{x:500,y:0}]);g.create("b",f.items(["one"]));g.update("b","idle",{...defaultSettings,movement:"stationary",effect:"shake"});
  await g.start("a",100,0);await assert.rejects(g.start("b",100,0),/Token ซ้ำ/);await g.stopAll();g.update("b","none",{...defaultSettings,movement:"stationary",effect:"none"});await assert.rejects(g.start("b",100,1000),/เลือกเอฟเฟกต์/);
});


test("wait settings persist and invalid waits are rejected without losing the route",()=>{
 const groups=new Groups({read:async()=>[],commit:async()=>{},interact:async()=>{throw new Error("unused");}});
 groups.create("wait");groups.setPath("wait",[{x:0,y:0},{x:100,y:0}]);
 const settings={...groups.export()[0].settings,waypointPauses:[1,3]};groups.update("wait","พัก",settings);
 const copy=new Groups({read:async()=>[],commit:async()=>{},interact:async()=>{throw new Error("unused");}});copy.hydrate(groups.export());assert.deepEqual(copy.export()[0].settings.waypointPauses,[1,3]);
 for(const pauses of [[-1],[Infinity],[NaN],[3601]])assert.throws(()=>groups.update("wait","พัก",{...settings,waypointPauses:pauses}));
 groups.setStart("wait",{x:50,y:0});assert.deepEqual(groups.export()[0].settings.waypointPauses,[1,3]);
 groups.setPath("wait",[{x:0,y:0},{x:200,y:0}]);assert.equal(groups.export()[0].settings.waypointPauses,undefined);
});

test("stopping during the final wait resumes waiting rather than teleporting to route start",async()=>{
 const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:0,y:0},{x:100,y:0}]);g.update("a","wait",{...defaultSettings,speed:1,mode:"once",waypointPauses:[0,5]});
 await g.start("a",100,0);await g.tick(2000);await g.stop("a");await g.start("a",100,10000);await g.tick(11000);assert.equal(f.active.get("one")!.position.x,100);assert.equal(g.views()[0].pauseRemaining,3);await g.tick(14000);assert.equal(g.views()[0].running,false);
});

test("per-point effects survive hydration and reject malformed values",()=>{
 const f=fixture(),g=f.g;g.create("a",f.items(["one"]));g.setPath("a",[{x:0,y:0},{x:100,y:0}]);g.update("a","effect",{...defaultSettings,waypointPauses:[0,4],waypointEffects:["inherit","wiggle"]});
 const copy=new Groups(f.adapter);copy.hydrate(g.export());assert.deepEqual(copy.export()[0].settings.waypointEffects,["inherit","wiggle"]);
 assert.throws(()=>g.update("a","bad",{...defaultSettings,waypointEffects:["invalid"] as any}));
 g.setStart("a",{x:20,y:0});assert.deepEqual(g.export()[0].settings.waypointEffects,["inherit","wiggle"]);
 g.setPath("a",[{x:0,y:0},{x:200,y:0}]);assert.equal(g.export()[0].settings.waypointEffects,undefined);
});
