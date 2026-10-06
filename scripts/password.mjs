import {hashPassword} from '../server.mjs';
import readline from 'node:readline';
if(!process.stdin.isTTY){console.error('Execute em um terminal interativo.');process.exit(1);}
process.stdout.write('Nova senha administrativa (mínimo 12 caracteres): ');
readline.emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);let value='';
process.stdin.on('keypress',(str,key)=>{if(key.ctrl&&key.name==='c')process.exit(1);if(key.name==='return'){process.stdin.setRawMode(false);if(value.length<12){console.error('\nUse pelo menos 12 caracteres.');process.exit(1);}console.log('\nADMIN_PASSWORD_HASH='+hashPassword(value));process.exit(0);}if(key.name==='backspace')value=value.slice(0,-1);else if(str&&!key.ctrl)value+=str;});
