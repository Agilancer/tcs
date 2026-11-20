// builds data/factions.js from data/*.json
const fs=require('fs'),path=require('path');const dir=path.join(__dirname,'..','data');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort();
const out=files.map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
fs.writeFileSync(path.join(__dirname,'..','factions.js'),'window.TC=window.TC||{};TC.FACTIONS='+JSON.stringify(out)+';\n');
console.log('factions',out.length,'lists',out.reduce((a,f)=>a+f.lists.length,0));
