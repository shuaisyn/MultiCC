/* Voice Activity Detection (VAD) monitor.
 * Uses AudioWorklet to analyze audio levels and detect:
 *   - User speaking (voice activity)
 *   - Silence (user stopped speaking)
 * 
 * Triggers:
 *   - onSpeechStart(): when user starts speaking
 *   - onSilence(duration): when silence detected, reports duration in ms
 *   - onVolume(level): continuous volume level (0-1)
 *
 * Usage:
 *   const vad = new VadMonitor({
 *     stream: mediaStream,
 *     silenceThreshold: 0.02,   // volume below this = silence
 *     silenceTimeout: 1000,     // ms of silence to trigger onSilence
 *     onSpeechStart, onSilence, onVolume
 *   });
 *   vad.start();
 *   vad.stop();
 */

class VadMonitor {
  constructor(opts) {
    this.opts = opts || {};
    this.ac = null;
    this.source = null;
    this.analyser = null;
    this.worklet = null;
    this.running = false;
    
    // Detection state
    this.isSpeaking = false;
    this.silenceStart = null;
    this.lastVolume = 0;
    
    // Configurable thresholds
    this.silenceThreshold = opts.silenceThreshold || 0.02; // Volume threshold for silence
    this.speechThreshold = opts.speechThreshold || 0.03;   // Volume threshold for speech
    this.silenceTimeout = opts.silenceTimeout || 1000;     // Ms of silence to trigger
    this.speechTimeout = opts.speechTimeout || 300;        // Ms of speech to trigger speech start
    this.speechStart = null;
  }

  async start(stream) {
    if (this.running) return;
    
    this.running = true;
    this.isSpeaking = false;
    this.silenceStart = null;
    this.speechStart = null;

    // Create AudioContext
    this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') {
      await this.ac.resume();
    }

    // Create AnalyserNode for volume measurement
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;

    // Connect stream to analyser
    this.source = this.ac.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    // Start monitoring loop
    this._monitorLoop();
  }

  _monitorLoop() {
    if (!this.running || !this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // Calculate average volume (0-1)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const volume = sum / dataArray.length / 255;
    this.lastVolume = volume;

    // Report volume
    if (this.opts.onVolume) {
      this.opts.onVolume(volume);
    }

    const now = Date.now();

    // Speech detection logic
    if (volume > this.speechThreshold) {
      // User is speaking
      if (!this.isSpeaking) {
        // Potential speech start
        if (!this.speechStart) {
          this.speechStart = now;
        } else if (now - this.speechStart >= this.speechTimeout) {
          // Confirmed speech start
          this.isSpeaking = true;
          this.speechStart = null;
          this.silenceStart = null;
          if (this.opts.onSpeechStart) {
            this.opts.onSpeechStart();
          }
        }
      } else {
        // Continue speaking, reset silence timer
        this.silenceStart = null;
      }
    } else if (volume < this.silenceThreshold) {
      // Silence detected
      if (this.isSpeaking) {
        if (!this.silenceStart) {
          this.silenceStart = now;
        } else if (now - this.silenceStart >= this.silenceTimeout) {
          // Silence timeout reached - user stopped speaking
          const duration = now - this.silenceStart;
          this.isSpeaking = false;
          this.silenceStart = null;
          this.speechStart = null;
          if (this.opts.onSilence) {
            this.opts.onSilence(duration);
          }
        }
      }
    }

    // Continue monitoring
    if (this.running) {
      requestAnimationFrame(() => this._monitorLoop());
    }
  }

  stop() {
    this.running = false;
    this.isSpeaking = false;
    
    try {
      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }
    } catch (_) {}

    try {
      if (this.ac && this.ac.state !== 'closed') {
        this.ac.close();
        this.ac = null;
      }
    } catch (_) {}

    this.analyser = null;
  }

  getVolume() {
    return this.lastVolume;
  }

  isVoiceActive() {
    return this.isSpeaking;
  }
}

window.VadMonitor = VadMonitor;
