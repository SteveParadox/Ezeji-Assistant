import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptToken, decryptToken } from '../server/whatsappConnections.js';

test('WhatsApp tokens use authenticated encryption and reject tampering', () => {
  const before=process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY='e'.repeat(64);
  try {
    const plaintext='test_token_not_public_abcdefghijklmnopqrstuvwxyz';
    const encrypted=encryptToken(plaintext);
    assert.match(encrypted,/^enc-v1:/);
    assert.equal(encrypted.includes(plaintext),false);
    assert.equal(decryptToken(encrypted),plaintext);
    const modified=encrypted.slice(0,-1)+(encrypted.endsWith('0')?'1':'0');
    assert.throws(()=>decryptToken(modified));
    assert.throws(()=>decryptToken(plaintext),/reconnection/);
  }finally{
    if(before===undefined)delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
    else process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY=before;
  }
});

test('WhatsApp encryption rejects a missing production key',()=>{
  const original=process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  try{assert.throws(()=>encryptToken('example'),/key missing/i);}
  finally{if(original!==undefined)process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY=original;}
});
