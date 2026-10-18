import {test} from "node:test";
import assert from "node:assert/strict";
import {OrderedPublisher} from "../src/publisher";

test("a slow status delivery preserves command reply order without blocking the caller",async()=>{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  const delivered:string[]=[];
  const publisher=new OrderedPublisher<string>(async value=>{if(value==="old")await blocked;delivered.push(value);});
  const first=publisher.publish("old"),second=publisher.publish("new command");
  assert.equal(publisher.busy,true);assert.deepEqual(delivered,[]);
  release();await Promise.all([first,second]);
  assert.deepEqual(delivered,["old","new command"]);assert.equal(publisher.busy,false);
});

test("a failed status does not prevent a subsequent command reply",async()=>{
  const delivered:number[]=[];
  const publisher=new OrderedPublisher<number>(async value=>{if(value===1)throw new Error("disconnected");delivered.push(value);});
  const first=publisher.publish(1),second=publisher.publish(2);
  await assert.rejects(first,/disconnected/);await second;
  assert.deepEqual(delivered,[2]);assert.equal(publisher.busy,false);
});
