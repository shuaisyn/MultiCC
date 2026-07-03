// Test script for realtime voice functionality
// Tests: TTS service, WebSocket connections, audio playback

const WebSocket = require('ws');
const fs = require('fs');

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';

console.log('=== Realtime Voice Test ===');
console.log('Server:', SERVER_URL);

// Test 1: TTS WebSocket connection
function testTtsWebSocket() {
  console.log('\n[Test 1] TTS WebSocket Connection');
  
  const ws = new WebSocket(`${SERVER_URL}/ws/tts`);
  let audioChunks = [];
  
  ws.on('open', () => {
    console.log('[TTS] Connected');
    ws.send(JSON.stringify({
      type: 'start',
      text: '你好，这是一个测试。',
      provider: 'edge',
      voice: 'zh-CN-XiaoxiaoNeural'
    }));
  });
  
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      audioChunks.push(data);
      console.log('[TTS] Received audio chunk:', data.length, 'bytes');
    } else {
      const msg = JSON.parse(data.toString());
      console.log('[TTS] Message:', msg.type, msg);
      
      if (msg.type === 'done') {
        const totalSize = audioChunks.reduce((sum, c) => sum + c.length, 0);
        console.log('[TTS] Done! Total audio:', totalSize, 'bytes');
        
        // Save audio for analysis
        const audioBuffer = Buffer.concat(audioChunks);
        fs.writeFileSync('test-tts-output.raw', audioBuffer);
        console.log('[TTS] Saved to test-tts-output.raw (PCM16 format)');
        
        ws.close();
      }
    }
  });
  
  ws.on('error', (err) => {
    console.error('[TTS] Error:', err.message);
  });
  
  ws.on('close', () => {
    console.log('[TTS] Closed');
  });
}

// Test 2: ASR WebSocket connection
function testAsrWebSocket() {
  console.log('\n[Test 2] ASR WebSocket Connection');
  
  const ws = new WebSocket(`${SERVER_URL}/ws/voice`);
  
  ws.on('open', () => {
    console.log('[ASR] Connected');
    ws.send(JSON.stringify({
      type: 'start',
      provider: 'openai',
      lang: 'zh'
    }));
  });
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[ASR] Message:', msg.type, msg);
  });
  
  ws.on('error', (err) => {
    console.error('[ASR] Error:', err.message);
  });
  
  ws.on('close', () => {
    console.log('[ASR] Closed');
  });
  
  // Close after 5 seconds (no actual audio sent)
  setTimeout(() => ws.close(), 5000);
}

// Test 3: Provider status check
function testProviderStatus() {
  console.log('\n[Test 3] Provider Status');
  
  const http = require('http');
  const baseUrl = SERVER_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  
  http.get(`${baseUrl}/api/settings/voice`, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      const config = JSON.parse(data);
      console.log('[Voice] ASR providers:', config.asr?.status);
      console.log('[Voice] TTS providers:', config.tts?.status);
    });
  }).on('error', (err) => {
    console.error('[Voice] Error:', err.message);
  });
}

// Run tests
async function runTests() {
  testProviderStatus();
  
  // Wait a bit before WebSocket tests
  await new Promise(r => setTimeout(r, 1000));
  
  testTtsWebSocket();
  testAsrWebSocket();
}

runTests();
