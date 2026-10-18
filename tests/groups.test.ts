import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {Groups} from "../src/groups";
import {defaultSettings, initialState, statePackets, validateConfig, type GroupView} from "../src/shared";
import type {MotionAdapter} from "../src/motion";

function fixture() {
  const scene=new Map<string,Item>(["one","two","three"].map((id,i)=>[id,{id,name:id,type:"IMAGE",position:{x:0,y:i*100},scale:{x:2,y:3},rotation:25,locked:false,attachedTo:undefined} as Item]));
  const active=new Map<string,Item>();
  const adapter:MotionAdapter={
    read:async ids=>structuredClone([...scene.values()].filter(i=>ids.includes(i.id)).reverse()),
    commit:async items=>{for(const i of items)if(scene.has(i.id))scene.set(i.id,structuredClone(i));},
    interact:async items=>{
      let current=structuredClone(items);
      return [recipe=>{current=structuredClone(current);recipe(current);for(const i of current)active.set(i.id,structuredClone(i));return structuredClone(current);},()=>{}];
    }
  };
  return {groups:new Groups(adapter),adapter,scene,active,items:(ids:string[])=>ids.map(id=>structuredClone(scene.get(id)!))};
}
test("two groups move at independent speeds and stopping one leaves the other running",async()=>{
  const f=fixture();const g=f.groups;
  g.create("alpha",f.items(["one","two"]));g.setB("alpha",{x:200,y:0});
  g.create("beta",f.items(["three"]));g.setB("beta",{x:200,y:200});
  g.update("beta","ช้า",{...defaultSettings,speed:1});
  await g.startAll(100,0);await g.tick(500);
  assert.equal(f.active.get("one")!.position.x,100);assert.equal(f.active.get("two")!.position.y,100);
  assert.equal(f.active.get("three")!.position.x,50);
  await g.stop("alpha");await g.tick(1000);
  assert.equal(g.views().find(v=>v.id==="alpha")!.running,false);
  assert.equal(g.views().find(v=>v.id==="beta")!.running,true);
  assert.equal(f.scene.get("one")!.position.x,100);assert.equal(f.active.get("three")!.position.x,100);
});
test("a token cannot be driven simultaneously by overlapping groups",async()=>{
  const f=fixture();const g=f.groups;for(const id of ["a","b"]){g.create(id,f.items(["one"]));g.setB(id,{x:200,y:0});}
  await g.start("a",100,0);await assert.rejects(g.start("b",100,0),/Token ซ้ำ/);
  await assert.rejects(g.reset("b"),/หยุดกลุ่มอื่น/);
  const errors=await g.startAll(100,0);assert.equal(errors.length,1);
  assert.equal(g.views().filter(v=>v.running).length,1);
});
test("reset restores A and original flip without altering rotation",async()=>{
  const f=fixture();const g=f.groups;g.create("a",f.items(["one"]));g.setB("a",{x:100,y:0});
  g.update("a","Guard",{...defaultSettings,speed:1});await g.start("a",100,0);await g.tick(1000);await g.stop("a");
  assert.equal(f.scene.get("one")!.scale.x,-2);
  await g.reset("a");assert.deepEqual(f.scene.get("one")!.position,{x:0,y:0});assert.deepEqual(f.scene.get("one")!.scale,{x:2,y:3});assert.equal(f.scene.get("one")!.rotation,25);
});
test("adding or removing groups does not delete tokens or stop unrelated groups",async()=>{
  const f=fixture();const g=f.groups;g.create("a",f.items(["one"]));g.setB("a",{x:200,y:0});await g.start("a",100,0);
  g.create("b",f.items(["two"]));await g.remove("b");assert.equal(g.running,true);assert.equal(f.scene.size,3);assert.equal(g.size,1);
});
test("saved groups survive hydration without auto-starting and corrupt entries are ignored",async()=>{
  const f=fixture();f.groups.create("a",f.items(["one","two"]));f.groups.setB("a",{x:200,y:0});f.groups.update("a","ยาม 🦉",{...defaultSettings,facing:"left"});await f.groups.start("a",100,0);
  const configs=f.groups.export();assert.equal(validateConfig(configs[0]),true);
  const restored=new Groups(f.adapter);restored.hydrate([...configs,{id:"bad"},configs[0]]);
  assert.equal(restored.size,1);assert.equal(restored.running,false);assert.equal(restored.views()[0].count,2);assert.equal(restored.views()[0].settings.facing,"left");assert.equal(restored.views()[0].name,"ยาม 🦉");
  configs[0].name="changed";assert.equal(restored.views()[0].name,"ยาม 🦉");
});
test("locking or deleting a token stops only its group",async()=>{
  const f=fixture();const g=f.groups;for(const [id,token,y] of [["a","one",0],["b","two",100]] as const){g.create(id,f.items([token]));g.setB(id,{x:200,y});}
  await g.startAll(100,0);f.scene.get("one")!.locked=true;await g.checkItems([...f.scene.values()]);
  assert.equal(g.views()[0].running,false);assert.equal(g.views()[1].running,true);
  f.scene.delete("two");await g.checkItems([...f.scene.values()]);assert.equal(g.running,false);
});
test("attached children are excluded from group membership and locked roots are rejected",()=>{
  const f=fixture();f.scene.get("two")!.attachedTo="one";f.groups.create("a",f.items(["one","two"]));assert.equal(f.groups.views()[0].count,1);
  assert.throws(()=>f.groups.create("b",f.items(["two"])),/วัตถุหลัก/);
  f.scene.get("three")!.locked=true;assert.throws(()=>f.groups.create("c",f.items(["three"])),/ปลดล็อก/);assert.equal(f.groups.size,1);
});
test("group configuration cannot change while it runs and zero-distance routes are rejected",async()=>{
  const f=fixture();f.groups.create("a",f.items(["one"]));assert.throws(()=>f.groups.setB("a",{x:0,y:0}),/ต่างจาก A/);
  f.groups.setB("a",{x:200,y:0});await f.groups.start("a",100,0);
  assert.throws(()=>f.groups.capture("a",f.items(["two"])),/หยุดกลุ่ม/);assert.throws(()=>f.groups.update("a","bad",defaultSettings),/หยุดกลุ่ม/);
});
test("hundreds of groups can be added, transmitted in bounded packets, and reassembled",()=>{
  const f=fixture();for(let i=0;i<400;i++){f.groups.create(`g${i}`);f.groups.update(`g${i}`,"กลุ่มเดินลาดตระเวน 🦉 "+i,defaultSettings);}
  assert.equal(f.groups.size,400);
  const state={...initialState,groups:f.groups.views()};const packets=statePackets(state);assert.ok(packets.length>1);
  for(const p of packets)assert.ok(new TextEncoder().encode(JSON.stringify(p)).length<16384);
  assert.equal(packets.map(p=>p.data).join(""),JSON.stringify(state));
});

test("LINE saves ordered cells, survives hydration and clears when direct B is chosen",()=>{
  const f=fixture();const g=f.groups;g.create("a",f.items(["one"]));
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:0},{x:100,y:100}];
  g.setPath("a",points);points[3].x=999;
  assert.deepEqual(g.views()[0].route,[{x:100,y:0},{x:100,y:100}]);assert.deepEqual(g.views()[0].b,{x:100,y:100});
  const restored=new Groups(f.adapter);restored.hydrate(JSON.parse(JSON.stringify(g.export())));
  assert.deepEqual(restored.views()[0].route,g.views()[0].route);assert.equal(restored.running,false);
  restored.setB("a",{x:300,y:0});assert.equal(restored.views()[0].route,undefined);
});

test("invalid or running LINE edits leave the previous route intact",async()=>{
  const f=fixture();const g=f.groups;g.create("a",f.items(["one"]));g.setPath("a",[{x:100,y:0}]);
  assert.throws(()=>g.setPath("a",[]));assert.throws(()=>g.setPath("a",[{x:NaN,y:0}]));
  assert.deepEqual(g.views()[0].route,[{x:100,y:0}]);await g.start("a",100,0);
  assert.throws(()=>g.setPath("a",[{x:200,y:0}]),/หยุดกลุ่ม/);
  assert.deepEqual(g.views()[0].route,[{x:100,y:0}]);
});

test("LINE configurations reject mismatched final B and keep v2 routes compatible",()=>{
  const f=fixture();f.groups.create("a",f.items(["one"]));f.groups.setB("a",{x:100,y:0});
  const old=f.groups.export()[0];assert.equal(validateConfig(old),true);
  assert.equal(validateConfig({...old,route:[]}),false);
  assert.equal(validateConfig({...old,route:[{x:200,y:0}]}),false);
  assert.equal(validateConfig({...old,route:[{x:100,y:0}]}),true);
});

test("clearing a legacy same-cell destination keeps group members and A intact",()=>{
  const f=fixture();const g=f.groups;g.create("a",f.items(["one","two"]));g.setB("a",{x:100,y:0});
  const anchors=g.export()[0].anchors;g.clearDestination("a");
  assert.deepEqual(g.export()[0].anchors,anchors);assert.equal(g.views()[0].b,undefined);assert.equal(g.views()[0].route,undefined);assert.equal(g.views()[0].count,2);
});
