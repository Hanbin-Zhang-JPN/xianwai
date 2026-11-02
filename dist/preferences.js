import {safeStorage} from './pairing.js';

const preferencesKey='xianwai-preferences-v1';
export function readPersistencePreference(){
 const raw=safeStorage.read('localStorage',preferencesKey);if(raw===null)return true;
 try{const value=JSON.parse(raw);return value?.persist===true;}catch{return false;}
}
export function writePersistencePreference(persist){return safeStorage.write('localStorage',preferencesKey,JSON.stringify({persist:persist===true}));}
