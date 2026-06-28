// TTS Performance Benchmark - Simulates real usage scenario

const WebSocket = require('ws');
const { spawn } = require('child_process');

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';

// Test sentences of varying lengths
const TEST_SENTENCES = [
  '你好。',
  '这是一个测试。',
  '欢迎使用实时语音交互功能，这个功能可以让您像打电话一样与 AI 进行对话。',
  '延迟是实时语音交互的关键指标。我们的目标是让首次响应时间小于两秒，这样用户就能获得流畅自然的对话体验。',
];

async function measureTtsLatency(text, provider = 'edge') {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const ws = new WebSocket(`${SERVER_URL}/ws/tts`);
    let firstChunkTime = null;
    let totalChunks = 0;
    let totalBytes = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'start', text, provider }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!firstChunkTime) {
          firstChunkTime = Date.now() - startTime;
        }
        totalChunks++;
        totalBytes += data.length;
      } else {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'done') {
          ws.close();
          resolve({
            connectTime: firstChunkTime ? firstChunkTime : null,
            totalTime: Date.now() - startTime,
            chunks: totalChunks,
            bytes: totalBytes,
            textLength: text.length,
          });
        } else if (msg.type === 'error') {
          ws.close();
          reject(new Error(msg.message));
        }
      }
    });

    ws.on('error', (err) => reject(err));

    // Timeout after 30s
    setTimeout(() => {
      ws.close();
      reject(new Error('Timeout'));
    }, 30000);
  });
}

async function checkEdgeTtsAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('which', ['edge-tts']);
    proc.on('close', (code) => resolve(code === 0));
  });
}

async function runBenchmark() {
  console.log('=== TTS Performance Benchmark ===\n');

  // Check if edge-tts is available
  const edgeTtsAvailable = await checkEdgeTtsAvailable();
  if (!edgeTtsAvailable) {
    console.log('⚠️  edge-tts not found. Install with: pip install edge-tts');
    console.log('   Skipping actual TTS tests.\n');
  }

  console.log('Server:', SERVER_URL);
  console.log('Provider: edge (default)\n');

  const results = [];

  for (const sentence of TEST_SENTENCES) {
    console.log(`Testing: "${sentence.slice(0, 30)}..." (${sentence.length} chars)`);
    
    if (edgeTtsAvailable) {
      try {
        const result = await measureTtsLatency(sentence);
        results.push(result);
        
        console.log(`  First chunk: ${result.connectTime}ms`);
        console.log(`  Total time:  ${result.totalTime}ms`);
        console.log(`  Chunks:      ${result.chunks}`);
        console.log(`  Bytes:       ${result.bytes}`);
        console.log(`  Throughput:  ${(result.bytes / result.totalTime * 1000 / 1024).toFixed(1)} KB/s`);
        
        // Check against targets
        if (result.connectTime <= 300) {
          console.log(`  ✅ First chunk within target (≤300ms)`);
        } else {
          console.log(`  ❌ First chunk exceeds target (>${result.connectTime}ms)`);
        }
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
      }
    } else {
      console.log('  ⏭️  Skipped (edge-tts not available)');
    }
    console.log('');
  }

  // Summary
  if (results.length > 0) {
    console.log('=== Summary ===');
    const avgFirstChunk = results.reduce((s, r) => s + r.connectTime, 0) / results.length;
    const avgTotal = results.reduce((s, r) => s + r.totalTime, 0) / results.length;
    
    console.log(`Average first chunk: ${avgFirstChunk.toFixed(0)}ms`);
    console.log(`Average total time:  ${avgTotal.toFixed(0)}ms`);
    
    if (avgFirstChunk <= 300) {
      console.log('✅ Target achieved: first chunk ≤ 300ms');
    } else {
      console.log('⚠️  Target not met: first chunk > 300ms');
    }
    
    // Estimate end-to-end latency
    const asrLatency = 300;
    const aiLatency = 200;
    const ttsLatency = avgFirstChunk;
    const totalLatency = asrLatency + aiLatency + ttsLatency;
    
    console.log(`\nEstimated end-to-end latency: ${totalLatency}ms`);
    if (totalLatency <= 2000) {
      console.log('✅ End-to-end target achieved: ≤ 2s');
    } else {
      console.log('⚠️  End-to-end target not met');
    }
  }

  console.log('\n=== Benchmark Complete ===');
}

runBenchmark().catch(console.error);
