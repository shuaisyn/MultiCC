// Latency measurement for realtime voice pipeline
// Measures: ASR latency, TTS latency, end-to-end latency

const WebSocket = require('ws');
const fs = require('fs');

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';

console.log('=== Voice Latency Test ===');
console.log('Server:', SERVER_URL);
console.log('');

const results = {
  asr: { connectTime: null, readyTime: null },
  tts: { connectTime: null, readyTime: null, firstChunkTime: null, totalTime: null },
};

// Test TTS latency
function measureTtsLatency() {
  return new Promise((resolve) => {
    console.log('[TTS Latency Test]');
    const connectStart = Date.now();
    
    const ws = new WebSocket(`${SERVER_URL}/ws/tts`);
    let firstChunkReceived = false;
    let audioChunks = [];
    
    ws.on('open', () => {
      results.tts.connectTime = Date.now() - connectStart;
      console.log(`  WebSocket connect: ${results.tts.connectTime}ms`);
      
      const requestStart = Date.now();
      ws.send(JSON.stringify({
        type: 'start',
        text: '你好，这是一个延迟测试。请测量从发送文本到收到第一个音频块的时间。',
        provider: 'edge',
      }));
      
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            results.tts.firstChunkTime = Date.now() - requestStart;
            console.log(`  First audio chunk: ${results.tts.firstChunkTime}ms`);
          }
          audioChunks.push(data);
        } else {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ready') {
            results.tts.readyTime = Date.now() - requestStart;
            console.log(`  TTS ready: ${results.tts.readyTime}ms`);
          } else if (msg.type === 'done') {
            results.tts.totalTime = Date.now() - requestStart;
            const totalSize = audioChunks.reduce((s, c) => s + c.length, 0);
            console.log(`  Total time: ${results.tts.totalTime}ms`);
            console.log(`  Total audio: ${totalSize} bytes`);
            console.log(`  Throughput: ${(totalSize / results.tts.totalTime * 1000 / 1024).toFixed(1)} KB/s`);
            ws.close();
            resolve(results.tts);
          }
        }
      });
    });
    
    ws.on('error', (err) => {
      console.error('  Error:', err.message);
      resolve(null);
    });
  });
}

// Test ASR latency (connection only, no audio)
function measureAsrLatency() {
  return new Promise((resolve) => {
    console.log('\n[ASR Latency Test]');
    const connectStart = Date.now();
    
    const ws = new WebSocket(`${SERVER_URL}/ws/voice`);
    
    ws.on('open', () => {
      results.asr.connectTime = Date.now() - connectStart;
      console.log(`  WebSocket connect: ${results.asr.connectTime}ms`);
      
      const requestStart = Date.now();
      ws.send(JSON.stringify({
        type: 'start',
        provider: 'openai',
        lang: 'zh'
      }));
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ready') {
          results.asr.readyTime = Date.now() - requestStart;
          console.log(`  ASR ready: ${results.asr.readyTime}ms`);
          ws.close();
          resolve(results.asr);
        }
      });
    });
    
    ws.on('error', (err) => {
      console.error('  Error:', err.message);
      resolve(null);
    });
    
    // Timeout after 10s
    setTimeout(() => {
      console.log('  Timeout (no ready message)');
      ws.close();
      resolve(null);
    }, 10000);
  });
}

// Generate report
function generateReport() {
  console.log('\n=== Latency Report ===');
  console.log('');
  console.log('TTS (Text-to-Speech):');
  if (results.tts.connectTime) {
    console.log(`  WebSocket connect:    ${results.tts.connectTime}ms`);
    console.log(`  TTS ready:            ${results.tts.readyTime}ms`);
    console.log(`  First audio chunk:    ${results.tts.firstChunkTime}ms`);
    console.log(`  Total time:           ${results.tts.totalTime}ms`);
    console.log('');
    console.log(`  ✅ Target: ≤300ms first chunk`);
    console.log(`  ${results.tts.firstChunkTime <= 300 ? '✅' : '❌'} Actual: ${results.tts.firstChunkTime}ms`);
  } else {
    console.log('  ❌ Not available (check edge-tts installation)');
  }
  
  console.log('');
  console.log('ASR (Speech-to-Text):');
  if (results.asr.connectTime) {
    console.log(`  WebSocket connect:    ${results.asr.connectTime}ms`);
    console.log(`  ASR ready:            ${results.asr.readyTime || 'N/A (no API key)'}ms`);
    console.log('');
    console.log(`  ✅ Target: ≤500ms ready`);
    if (results.asr.readyTime) {
      console.log(`  ${results.asr.readyTime <= 500 ? '✅' : '❌'} Actual: ${results.asr.readyTime}ms`);
    } else {
      console.log('  ⚠️  No ASR provider configured');
    }
  } else {
    console.log('  ❌ Not available');
  }
  
  console.log('');
  console.log('End-to-End Latency Estimate:');
  const asrLatency = results.asr.readyTime || 500;
  const ttsLatency = results.tts.firstChunkTime || 300;
  const aiLatency = 500; // Estimate for AI response start
  const total = asrLatency + aiLatency + ttsLatency;
  console.log(`  ASR: ${asrLatency}ms + AI: ${aiLatency}ms + TTS: ${ttsLatency}ms = ${total}ms`);
  console.log(`  ✅ Target: ≤2000ms`);
  console.log(`  ${total <= 2000 ? '✅' : '❌'} Actual: ${total}ms`);
  console.log('');
}

// Run all tests
async function runAllTests() {
  await measureTtsLatency();
  await measureAsrLatency();
  generateReport();
}

runAllTests();
