// Read-only classroom pseudocode interpreter. This contains NO answer keys.
// The authoritative marking takes place in the private Supabase Edge Function.
class PseudoError extends Error {
  constructor(message,line){super(line ? `Line ${line}: ${message}` : message);this.line=line;this.name='PseudoError';}
}
function tidySource(source){
  return String(source).replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[←⟵]/g,'<-').replace(/\r/g,'');
}
function stripComment(source){
  let quote=null,escaped=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(escaped){escaped=false;continue;}
    if(ch==='\\' && quote){escaped=true;continue;}
    if(quote){if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='/'&&source[i+1]==='/')return source.slice(0,i);
  }
  return source;
}
function tokensFor(expr){
  const s=tidySource(expr),out=[];
  let i=0;
  while(i<s.length){
    if(/\s/.test(s[i])){i++;continue;}
    const sub=s.slice(i);
    let m;
    if((m=/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(sub))){
      let value=m[0].slice(1,-1).replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\(["'\\])/g,'$1');
      out.push({type:'string',value});i+=m[0].length;continue;
    }
    if((m=/^(?:\d+(?:\.\d+)?|\.\d+)/.exec(sub))){out.push({type:'number',value:Number(m[0])});i+=m[0].length;continue;}
    if((m=/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(sub))){out.push({type:'id',value:m[0]});i+=m[0].length;continue;}
    if((m=/^(?:<=|>=|==|!=|<>|&&|\|\||[+\-*/%()[\],.<>!=])/.exec(sub))){out.push({type:'symbol',value:m[0]});i+=m[0].length;continue;}
    throw new PseudoError(`Unsupported character “${s[i]}” in an expression`);
  }
  return out;
}
function truth(v){return Boolean(v);}
function expression(expr,env){
  const ts=tokensFor(expr);let pos=0;
  const peek=()=>ts[pos];
  const is=(...vals)=>peek()&&vals.some(v=>String(peek().value).toUpperCase()===v.toUpperCase());
  const eat=(...vals)=>{if(is(...vals)){return ts[pos++];}return null;};
  function requireToken(token){if(!eat(token))throw new PseudoError(`Expected “${token}” in expression`);}
  function parseOr(){let v=parseAnd();while(eat('OR','||')){const w=parseAnd();v=truth(v)||truth(w);}return v;}
  function parseAnd(){let v=parseCmp();while(eat('AND','&&')){const w=parseCmp();v=truth(v)&&truth(w);}return v;}
  function parseCmp(){let v=parseAdd();while(is('<','>','<=','>=','=','==','<>','!=')){
    const op=ts[pos++].value,w=parseAdd();
    if(op==='<'||op==='>'||op==='<='||op==='>='){
      if(op==='<')v=v<w;else if(op==='>')v=v>w;else if(op==='<=')v=v<=w;else v=v>=w;
    }else if(op==='='||op==='==')v=v===w;else v=v!==w;
  }return v;}
  function parseAdd(){let v=parseMult();while(is('+','-')){const op=ts[pos++].value,w=parseMult();if(op==='+')v=(typeof v==='string'||typeof w==='string')?String(v)+String(w):Number(v)+Number(w);else v=Number(v)-Number(w);}return v;}
  function parseMult(){let v=parseUnary();while(is('*','/','DIV','MOD','REM','%')){
    const op=String(ts[pos++].value).toUpperCase(),w=parseUnary(),a=Number(v),b=Number(w);
    if(!Number.isFinite(a)||!Number.isFinite(b))throw new PseudoError('Arithmetic requires numbers');
    if(b===0&&(op==='/'||op==='DIV'||op==='MOD'||op==='REM'||op==='%'))throw new PseudoError('Division by zero');
    if(op==='*')v=a*b;else if(op==='/')v=a/b;else if(op==='DIV')v=Math.trunc(a/b);else v=a%b;
  }return v;}
  function parseUnary(){if(eat('-'))return -Number(parseUnary());if(eat('+'))return Number(parseUnary());if(eat('NOT','!'))return !truth(parseUnary());return parsePrimary();}
  function parsePrimary(){
    let token=peek();if(!token)throw new PseudoError('Incomplete expression');
    if(eat('(')){const value=parseOr();requireToken(')');return value;}
    if(eat('[')){const arr=[];if(!is(']')){do{arr.push(parseOr());}while(eat(','));}requireToken(']');return arr;}
    if(token.type==='number'||token.type==='string'){pos++;return token.value;}
    if(token.type==='id'){
      pos++;const word=token.value;if(word.toUpperCase()==='TRUE')return true;if(word.toUpperCase()==='FALSE')return false;
      if(!Object.prototype.hasOwnProperty.call(env,word))throw new PseudoError(`Variable “${word}” has no value. READ or SET it first`);
      let v=env[word];
      while(is('[','.')){
        if(eat('[')){const index=parseOr();requireToken(']');if(!Array.isArray(v))throw new PseudoError(`${word} is not an array`);if(!Number.isInteger(index)||index<0||index>=v.length)throw new PseudoError(`Array index ${index} out of bounds (0–${v.length-1})`);v=v[index];}
        else{eat('.');const field=peek();if(!field||field.type!=='id')throw new PseudoError('Expected a field name after the dot');pos++;if(v===null||typeof v!=='object'||!Object.prototype.hasOwnProperty.call(v,field.value))throw new PseudoError(`Record field “${word}.${field.value}” has no value`);v=v[field.value];}
      }
      if(v===null||v===undefined)throw new PseudoError(`Value for “${word}” has not been set`);
      return v;
    }
    throw new PseudoError(`Unexpected “${token.value}” in expression`);
  }
  const result=parseOr();
  if(pos!==ts.length)throw new PseudoError(`Unexpected “${ts[pos].value}” after expression`);
  return result;
}
function resolveTarget(raw,env){
  const text=tidySource(raw).trim();
  const m=/^([A-Za-z_$][\w$]*)(.*)$/.exec(text);
  if(!m)throw new PseudoError(`Invalid target “${text}”`);
  let key=m[1],remain=m[2].trim();
  if(!remain)return {root:key,steps:[]};
  const steps=[];
  while(remain){
    if(remain.startsWith('.')){
      const p=/^\.([A-Za-z_$][\w$]*)/.exec(remain);if(!p)throw new PseudoError('Invalid record field');steps.push(p[1]);remain=remain.slice(p[0].length).trim();continue;
    }
    if(remain[0]==='['){let level=0,end=-1;for(let i=0;i<remain.length;i++){if(remain[i]==='[')level++;if(remain[i]===']'){level--;if(level===0){end=i;break;}}}
      if(end<0)throw new PseudoError('Missing ] in array target');
      const idx=expression(remain.slice(1,end),env);steps.push(idx);remain=remain.slice(end+1).trim();continue;
    }
    throw new PseudoError(`Invalid assignment target near “${remain}”`);
  }
  return {root:key,steps};
}
function put(env,name,value){
  const {root,steps}=resolveTarget(name,env);
  if(!steps.length){env[root]=value;return;}
  if(!Object.prototype.hasOwnProperty.call(env,root)){
    if(typeof steps[0]==='string')env[root]=Object.create(null);
    else throw new PseudoError(`Declare array “${root}” first`);
  }
  let parent=env[root];
  for(let j=0;j<steps.length;j++){
    const key=steps[j],last=j===steps.length-1;
    if(parent===null||typeof parent!=='object')throw new PseudoError(`Cannot assign a field/index on non-composite variable “${root}”`);
    if(Array.isArray(parent)){
      if(!Number.isInteger(key)||key<0||key>=parent.length)throw new PseudoError(`Array index ${key} out of bounds (0–${parent.length-1})`);
    }else if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))throw new PseudoError('Invalid record field');
    if(last){parent[key]=value;return;}
    if(!Object.prototype.hasOwnProperty.call(parent,key)||parent[key]===null)parent[key]=Object.create(null);
    parent=parent[key];
  }
}
function compile(source){
  const lines=tidySource(source).split('\n'),instructions=[],stack=[];
  const push=(op,data={},line)=>{instructions.push({op,...data,line});return instructions.length-1;};
  const err=(message,line)=>{throw new PseudoError(message,line);};
  const top=()=>stack[stack.length-1];
  lines.forEach((original,ind)=>{
    const n=ind+1,s=stripComment(original).trim(),u=s.toUpperCase();
    if(!s)return;
    let m;
    if((m=/^IF\s+(.+?)(?:\s+THEN)?$/i.exec(s))){push('ifFalse',{expr:m[1],jump:null},n);stack.push({type:'if',pending:instructions.length-1,exits:[],elseUsed:false,line:n});return;}
    if((m=/^(?:ELSE\s+IF|ELSEIF)\s+(.+?)(?:\s+THEN)?$/i.exec(s))){const f=top();if(!f||f.type!=='if'||f.elseUsed)err('ELSE IF without matching IF',n);f.exits.push(push('jump',{jump:null},n));instructions[f.pending].jump=instructions.length;f.pending=push('ifFalse',{expr:m[1],jump:null},n);return;}
    if(u==='ELSE'){const f=top();if(!f||f.type!=='if'||f.elseUsed)err('ELSE without matching IF',n);f.exits.push(push('jump',{jump:null},n));instructions[f.pending].jump=instructions.length;f.pending=null;f.elseUsed=true;return;}
    if(/^(?:END\s*IF|ENDIF)$/i.test(s)){const f=stack.pop();if(!f||f.type!=='if')err('END IF without matching IF',n);if(f.pending!==null)instructions[f.pending].jump=instructions.length;f.exits.forEach(i=>{instructions[i].jump=instructions.length;});return;}
    if((m=/^WHILE\s+(.+)$/i.exec(s))){const start=push('ifFalse',{expr:m[1],jump:null},n);stack.push({type:'while',start,line:n});return;}
    if(/^(?:END\s*WHILE|ENDWHILE)$/i.test(s)){const f=stack.pop();if(!f||f.type!=='while')err('END WHILE without matching WHILE',n);push('jump',{jump:f.start},n);instructions[f.start].jump=instructions.length;return;}
    if((m=/^(?:LOOP|FOR)\s+([A-Za-z_$][\w$]*)\s+(?:FROM|<-|=)\s+(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i.exec(s))){
      const v=m[1],step=m[4]||'1';push('set',{target:v,expr:m[2]},n);const guard=push('loopGuard',{name:v,endExpr:m[3],stepExpr:step,jump:null},n);stack.push({type:'loop',guard,name:v,step,line:n});return;
    }
    if(/^(?:END\s*LOOP|ENDLOOP|NEXT(?:\s+[A-Za-z_$][\w$]*)?)$/i.test(s)){const f=stack.pop();if(!f||f.type!=='loop')err('END LOOP / NEXT without matching LOOP / FOR',n);push('set',{target:f.name,expr:`${f.name} + (${f.step})`},n);push('jump',{jump:f.guard},n);instructions[f.guard].jump=instructions.length;return;}
    if(u==='REPEAT'){stack.push({type:'repeat',start:instructions.length,line:n});return;}
    if((m=/^UNTIL\s+(.+)$/i.exec(s))){const f=stack.pop();if(!f||f.type!=='repeat')err('UNTIL without REPEAT',n);push('ifFalse',{expr:m[1],jump:f.start},n);return;}
    if((m=/^(?:READ|INPUT|GET)\s+(.+)$/i.exec(s))){push('read',{target:m[1].trim()},n);return;}
    if((m=/^(?:WRITE|PRINT|DISPLAY)\s+(.+)$/i.exec(s))){push('write',{expr:m[1]},n);return;}
    if((m=/^SET\s+(.+?)\s+TO\s+(.+)$/i.exec(s))){push('set',{target:m[1].trim(),expr:m[2]},n);return;}
    if((m=/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)\s*(?:<-|:=)\s*(.+)$/.exec(s))){push('set',{target:m[1],expr:m[2]},n);return;}
    if((m=/^(?:DECLARE\s+)?([A-Za-z_$][\w$]*)\s*\[\s*(.+)\s*\]$/i.exec(s))){push('array',{target:m[1],sizeExpr:m[2]},n);return;}
    if((m=/^DECLARE\s+([A-Za-z_$][\w$]*)$/i.exec(s))){push('set',{target:m[1],expr:'0'},n);return;}
    err(`Unknown instruction “${s.length>65?s.slice(0,65)+'…':s}”. Check the syntax guide`,n);
  });
  if(stack.length)err(`Missing END for ${top().type.toUpperCase()} block opened on line ${top().line}`,top().line);
  if(!instructions.length)throw new PseudoError('Your program has no executable instructions');
  return {lines,instructions};
}
function displayValue(v){if(Array.isArray(v))return `[${v.map(displayValue).join(', ')}]`;if(v===null)return 'unset';if(v===undefined)return 'undefined';if(v&&typeof v==='object')return `{ ${Object.entries(v).map(([a,b])=>a+': '+displayValue(b)).join(', ')} }`;return String(v);}
function inputValue(raw){const s=String(raw).trim();if((s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'")))return s.slice(1,-1);if(s!==''&&Number.isFinite(Number(s)))return Number(s);if(/^TRUE$/i.test(s))return true;if(/^FALSE$/i.test(s))return false;return s;}
function writeParts(raw){
  // Support both WRITE "Total: " + total and WRITE "Total: ", total.
  const parts=[];let quote=null,escaped=false,depth=0,start=0;
  for(let i=0;i<raw.length;i++){
    const ch=raw[i];
    if(escaped){escaped=false;continue;}
    if(quote){if(ch==='\\'){escaped=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='['||ch==='('){depth++;continue;}
    if(ch===']'||ch===')'){depth--;continue;}
    if(ch===','&&depth===0){parts.push(raw.slice(start,i).trim());start=i+1;}
  }
  parts.push(raw.slice(start).trim());
  if(parts.some(x=>!x))throw new PseudoError('WRITE has an empty value');
  return parts;
}
function newMachine(source,inputs){
  const compiled=compile(source);
  return {compiled,pc:0,env:Object.create(null),outputs:[],inputs:inputs.map(inputValue),inputIndex:0,steps:0,activeLine:0,done:false,error:null};
}
function advance(m){
  if(m.done||m.error)return;
  if(m.steps>=2400){m.error=new PseudoError('Execution limit (2,400 steps) reached. Possible infinite loop',m.activeLine);return;}
  if(m.pc>=m.compiled.instructions.length){m.done=true;return;}
  const ins=m.compiled.instructions[m.pc],env=m.env;
  m.activeLine=ins.line;m.steps++;
  try{
    if(ins.op==='set'){put(env,ins.target,expression(ins.expr,env));m.pc++;}
    else if(ins.op==='array'){
      const size=expression(ins.sizeExpr,env);
      if(!Number.isInteger(size)||size<0||size>1000)throw new PseudoError('Array length must be an integer between 0 and 1000');
      put(env,ins.target,Array(size).fill(null));m.pc++;
    }
    else if(ins.op==='read'){
      if(m.inputIndex>=m.inputs.length)throw new PseudoError(`READ needs another input value. Enter more lines in Input desk`);
      put(env,ins.target,m.inputs[m.inputIndex++]);m.pc++;
    }
    else if(ins.op==='write'){m.outputs.push(writeParts(ins.expr).map(part=>displayValue(expression(part,env))).join(' '));m.pc++;}
    else if(ins.op==='jump'){m.pc=ins.jump;}
    else if(ins.op==='ifFalse'){m.pc=truth(expression(ins.expr,env))?m.pc+1:ins.jump;}
    else if(ins.op==='loopGuard'){
      const current=env[ins.name],stop=expression(ins.endExpr,env),by=expression(ins.stepExpr,env);
      if(!Number.isFinite(Number(by))||Number(by)===0)throw new PseudoError('LOOP STEP must be a nonzero number');
      m.pc=(Number(by)>0?current<=stop:current>=stop)?m.pc+1:ins.jump;
    }
    if(m.pc>=m.compiled.instructions.length)m.done=true;
  }catch(e){m.error=new PseudoError(e.message.replace(/^Line \d+: /,''),ins.line);}
}
function runMachine(source,inputs){const m=newMachine(source,inputs);while(!m.done&&!m.error)advance(m);return m;}


if (typeof window !== "undefined") window.PseudoEngine = { newMachine, advance, runMachine, compile };
