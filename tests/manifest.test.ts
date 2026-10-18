import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

test("the shipped manifest meets Owlbear's loading contract",()=>{
  const publicRoot=new URL("../public/",import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL("manifest.json",publicRoot),"utf8"));
  // Owlbear rejects manifests exceeding these limits even if hosting/build succeeds.
  // https://docs.owlbear.rodeo/extensions/reference/manifest/
  assert.equal(manifest.manifest_version,1);
  assert.equal(typeof manifest.name,"string");assert.ok(manifest.name.length>0&&manifest.name.length<=45,"name must be 1–45 characters");
  assert.equal(typeof manifest.description,"string");assert.ok(manifest.description.length<=128,"description must be at most 128 characters");
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  for(const path of [manifest.icon,manifest.background_url,manifest.action.icon,manifest.action.popover]){
    assert.equal(typeof path,"string");assert.ok(path.startsWith("/")&&!path.startsWith("//"),"manifest URLs must resolve at this site's root");
    const file=path.slice(1);const base=file.endsWith(".html")?new URL("../",import.meta.url):publicRoot;
    assert.ok(existsSync(new URL(file,base)),`missing manifest target: ${path}`);
  }
});
